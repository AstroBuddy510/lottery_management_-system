import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { verifyCharge, paystackConfigured } from "../paystack";
import { verifyTransfer } from "../paystack-transfers";
import { logger } from "../logger";

/**
 * Paystack's fees, as Paystack reports them.
 *
 * One row per Paystack reference, ever: the unique key on `reference` is what
 * keeps a retried webhook, a re-sync or a manual import from booking a fee
 * twice. A row whose fee Paystack did not report keeps fee = null - it is not
 * guessed at a percentage - and the Fees tab lists it until the figure from
 * the settlement report is entered. Once a fee is known it is never
 * overwritten.
 */

export type FeeKind = "collection" | "transfer";

export async function recordFee(entry: {
  reference: string;
  kind: FeeKind;
  sourceType: string;
  sourceId: string;
  grossMinor: number;
  feeMinor: number | null;
  capturedFrom: "webhook" | "verify" | "settlement" | "manual";
  occurredAt?: Date | string | null;
}): Promise<void> {
  const gross = (entry.grossMinor / 100).toFixed(2);
  const fee = entry.feeMinor === null ? null : (entry.feeMinor / 100).toFixed(2);
  const at = entry.occurredAt ? new Date(entry.occurredAt) : new Date();
  await db.execute(sql`
    INSERT INTO fin_payment_fees (reference, kind, source_type, source_id, gross, fee, captured_from, occurred_at, fee_set_at)
    VALUES (${entry.reference}, ${entry.kind}, ${entry.sourceType}, ${entry.sourceId}, ${gross}, ${fee},
            ${entry.capturedFrom}, ${at.toISOString()}::timestamptz, ${fee === null ? null : new Date().toISOString()}::timestamptz)
    ON CONFLICT (reference) DO UPDATE
       SET fee = excluded.fee, fee_set_at = now(), captured_from = excluded.captured_from
     WHERE fin_payment_fees.fee IS NULL AND excluded.fee IS NOT NULL`);
}

/** Never lets a fee problem break the payment flow that called it. */
export function recordFeeQuietly(entry: Parameters<typeof recordFee>[0]): void {
  recordFee(entry).catch((err) => logger.error({ err, reference: entry.reference }, "[FEES] could not record Paystack fee"));
}

/**
 * Every Paystack reference the company has, with whatever we know of its fee.
 * Collections: MoMo unit purchases, MoMo postpaid settlements and Paystack
 * agency payments. Transfers: POS win payouts.
 */
const KNOWN_REFERENCES = sql`
  SELECT p.paystack_reference AS reference, 'collection' AS kind, 'unit_purchase' AS source_type, p.id::text AS source_id,
         (p.amount * 100)::bigint AS gross_minor, p.paid_at AS occurred_at
    FROM writer_token_purchases p
   WHERE p.payment_method = 'momo' AND p.status IN ('paid', 'credited') AND p.paystack_reference IS NOT NULL
  UNION ALL
  SELECT p.paystack_reference, 'collection', 'agency_payment', p.id::text, (p.amount * 100)::bigint, p.created_at
    FROM payments p
   WHERE p.payment_method = 'paystack' AND p.status = 'completed' AND p.paystack_reference IS NOT NULL
  UNION ALL
  SELECT l.settlement_reference, 'collection', 'postpaid_ledger', l.id::text, (greatest(l.amount_paid, l.amount_payable) * 100)::bigint, l.settled_at
    FROM postpaid_daily_ledger l
   WHERE l.settlement_status = 'settled' AND l.settlement_method = 'momo' AND l.settlement_reference IS NOT NULL
  UNION ALL
  SELECT pr.transfer_reference, 'transfer', 'payout_request', pr.id::text, (pr.payout_amount * 100)::bigint, pr.paid_at
    FROM payout_requests pr
   WHERE pr.status = 'paid' AND pr.transfer_reference IS NOT NULL`;

/** References whose fee is not yet known (never asked, or Paystack did not say). */
export async function referencesMissingFees(limit = 500) {
  const r = await db.execute(sql`
    SELECT k.* , f.id AS fee_id
      FROM (${KNOWN_REFERENCES}) k
      LEFT JOIN fin_payment_fees f ON f.reference = k.reference
     WHERE f.id IS NULL OR f.fee IS NULL
     ORDER BY k.occurred_at DESC NULLS LAST
     LIMIT ${limit}`);
  return r.rows as Array<{ reference: string; kind: FeeKind; source_type: string; source_id: string; gross_minor: string | number; occurred_at: string | null; fee_id: string | null }>;
}

/**
 * Ask Paystack for the fee on every reference still missing one. Bounded per
 * run so a long backlog cannot hold a request open; run it again for more.
 */
export async function syncFeesFromPaystack(max = 40): Promise<{ checked: number; captured: number; stillUnknown: number; paystack: boolean }> {
  const missing = await referencesMissingFees(max);
  if (!paystackConfigured()) {
    // Still register the references, so the Fees tab can list what is owed a figure.
    for (const m of missing) {
      if (m.fee_id) continue;
      await recordFee({ reference: m.reference, kind: m.kind, sourceType: m.source_type, sourceId: m.source_id,
        grossMinor: Number(m.gross_minor), feeMinor: null, capturedFrom: "verify", occurredAt: m.occurred_at });
    }
    return { checked: 0, captured: 0, stillUnknown: missing.length, paystack: false };
  }
  let captured = 0;
  for (const m of missing) {
    let feeMinor: number | null = null;
    let at: string | null = m.occurred_at;
    try {
      if (m.kind === "collection") {
        const v = await verifyCharge(m.reference);
        if (v.ok) { feeMinor = v.feesMinor ?? null; at = v.paidAt ?? at; }
      } else {
        const v = await verifyTransfer(m.reference);
        if (v.state === "success" && "feeMinor" in v) feeMinor = v.feeMinor;
      }
    } catch (err) {
      logger.warn({ err, reference: m.reference }, "[FEES] Paystack lookup failed");
    }
    await recordFee({ reference: m.reference, kind: m.kind, sourceType: m.source_type, sourceId: m.source_id,
      grossMinor: Number(m.gross_minor), feeMinor, capturedFrom: "verify", occurredAt: at });
    if (feeMinor !== null) captured += 1;
  }
  return { checked: missing.length, captured, stillUnknown: missing.length - captured, paystack: true };
}
