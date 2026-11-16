import { db, finAuditLogTable } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { logger } from "../logger";
import { reserveLedgerTotals } from "./reserve";
import { releaseExpiredWinnings } from "./winnings";

/**
 * The company's books, generated from the records that caused them.
 *
 * Nobody types a receipt into the cash book. A cashier crediting a cash unit
 * purchase, a writer settling a postpaid bill, an expense, a salary, a
 * Paystack transfer to a winner - each already leaves a record, and the cash
 * book row is generated from that record and keyed on it: (source_type,
 * source_id, leg) is unique, so running the generation twice adds nothing and
 * a record can never be booked twice. Running it is cheap, so every finance
 * read runs it first: what the cash book shows is complete as of the moment
 * it is shown.
 *
 * When a source record is undone - a payment voided, a reserve receipt
 * deleted - the original cash book row stays and a reversing row is added
 * beside it, pointing back at it. Nothing in the books is edited or deleted;
 * the triggers in migration 0022 refuse it.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Exec = { execute: (q: SQL) => Promise<any> };

const CASH = sql`(SELECT id FROM fin_money_accounts WHERE code = 'CASH')`;
const PAYSTACK = sql`(SELECT id FROM fin_money_accounts WHERE code = 'PAYSTACK')`;
/** A bank-transfer receipt lands in the first active bank account, or cash if none is set up yet. */
const BANK = sql`coalesce((SELECT id FROM fin_money_accounts WHERE kind = 'bank' AND is_active ORDER BY created_at LIMIT 1), ${CASH})`;

const INSERT = sql`INSERT INTO fin_cash_book
  (occurred_at, direction, amount, account_id, method, category, source_type, source_id, leg,
   party_type, party_id, party_label, reference, memo, handled_by)`;
const DONE = sql`ON CONFLICT (source_type, source_id, leg) DO NOTHING`;

/**
 * Master Wallet entries that are test money or the reversal of it. Both
 * halves stay on the wallet's own ledger; neither is company money.
 */
export const MW_EXCLUDED = sql`(
  l.reverses_id IS NOT NULL
  OR EXISTS (SELECT 1 FROM master_wallet_ledger r WHERE r.reverses_id = l.id)
)`;

/** Every generator, in the order they run. Each is idempotent on its own. */
const GENERATORS: Array<{ name: string; q: SQL }> = [
  {
    // Prepaid units bought with cash at the counter. The cashier's credit is
    // the moment the money is in hand.
    name: "unit purchases (cash)",
    q: sql`${INSERT}
      SELECT p.credited_at, 'in', p.amount, ${CASH}, 'cash', 'unit_sale', 'unit_purchase', p.id::text, 'main',
             'writer', p.writer_id, w.full_code || ' · ' || w.full_name,
             'UNIT-' || upper(left(p.id::text, 8)), 'Prepaid units bought for cash', p.credited_by
        FROM writer_token_purchases p JOIN writers w ON w.id = p.writer_id
       WHERE p.payment_method = 'cash' AND p.status = 'credited' AND p.credited_at IS NOT NULL AND p.amount > 0
      ${DONE}`,
  },
  {
    // Prepaid units paid by MoMo: the money is in Paystack once it confirms
    // the charge, whether or not a cashier has issued the units yet.
    name: "unit purchases (MoMo)",
    q: sql`${INSERT}
      SELECT p.paid_at, 'in', p.amount, ${PAYSTACK}, 'momo', 'unit_sale', 'unit_purchase', p.id::text, 'main',
             'writer', p.writer_id, w.full_code || ' · ' || w.full_name,
             p.paystack_reference, 'Prepaid units bought by MoMo', NULL
        FROM writer_token_purchases p JOIN writers w ON w.id = p.writer_id
       WHERE p.payment_method = 'momo' AND p.status IN ('paid', 'credited') AND p.paid_at IS NOT NULL AND p.amount > 0
      ${DONE}`,
  },
  {
    // Postpaid takings. A bill can be collected in parts, so each row books
    // what was collected since the last one; the leg carries the running
    // total, which is what makes a part-payment bookable exactly once.
    name: "postpaid settlements",
    q: sql`${INSERT}
      SELECT CASE WHEN c.settlement_status = 'settled' THEN coalesce(c.settled_at, now()) ELSE now() END,
             'in', c.collected - c.booked,
             CASE WHEN c.method IN ('momo', 'paystack') THEN ${PAYSTACK} WHEN c.method = 'bank' THEN ${BANK} ELSE ${CASH} END,
             c.method, 'postpaid_settlement', 'postpaid_ledger', c.id::text, 'to-' || c.collected::text,
             'writer', c.writer_id, c.label, c.settlement_reference,
             'Postpaid takings for ' || to_char(c.ledger_date, 'DD Mon YYYY'), c.settled_by
        FROM (
          SELECT l.id, l.writer_id, l.ledger_date, l.settlement_status, l.settled_at, l.settled_by, l.settlement_reference,
                 coalesce(l.settlement_method, 'cash') AS method,
                 w.full_code || ' · ' || w.full_name AS label,
                 CASE WHEN l.settlement_status = 'settled' THEN greatest(l.amount_paid, l.amount_payable) ELSE l.amount_paid END AS collected,
                 coalesce((SELECT sum(b.amount) FROM fin_cash_book b
                            WHERE b.source_type = 'postpaid_ledger' AND b.source_id = l.id::text AND b.direction = 'in'), 0) AS booked
            FROM postpaid_daily_ledger l JOIN writers w ON w.id = l.writer_id
        ) c
       WHERE c.collected > c.booked
      ${DONE}`,
  },
  {
    // Money an agency handed in (pay-in) or was paid (pay-out).
    name: "agency payments",
    q: sql`${INSERT}
      SELECT p.created_at, CASE WHEN p.transaction_type = 'pay_out' THEN 'out' ELSE 'in' END, p.amount,
             CASE WHEN p.payment_method = 'paystack' THEN ${PAYSTACK} ELSE ${CASH} END,
             p.payment_method, CASE WHEN p.transaction_type = 'pay_out' THEN 'agency_payout' ELSE 'agency_receipt' END,
             'agency_payment', p.id::text, 'main',
             'agent', p.agent_id, a.full_code || coalesce(' · ' || a.agency_name, ''),
             coalesce(p.receipt_number, p.paystack_reference), p.notes, p.cashier_id
        FROM payments p JOIN agents a ON a.id = p.agent_id
       WHERE p.status = 'completed' AND p.amount > 0
      ${DONE}`,
  },
  {
    name: "agency payments voided",
    q: sql`INSERT INTO fin_cash_book
        (occurred_at, direction, amount, account_id, method, category, source_type, source_id, leg,
         party_type, party_id, party_label, reference, memo, handled_by, reverses_id)
      SELECT now(), CASE WHEN b.direction = 'in' THEN 'out' ELSE 'in' END, b.amount, b.account_id, b.method, b.category,
             b.source_type, b.source_id, 'void', b.party_type, b.party_id, b.party_label, b.reference,
             'Voided: ' || coalesce(p.voided_reason, 'no reason given'), p.voided_by, b.id
        FROM fin_cash_book b JOIN payments p ON p.id::text = b.source_id
       WHERE b.source_type = 'agency_payment' AND b.leg = 'main' AND p.is_voided
      ${DONE}`,
  },
  {
    // Reserve money an agency handed to the cashier.
    name: "reserve receipts",
    q: sql`${INSERT}
      SELECT r.marked_at, 'in', r.amount_paid, ${CASH}, 'cash', 'reserve_collection', 'reserve_receipt', r.id::text, 'main',
             'agent', r.agent_id, a.full_code || coalesce(' · ' || a.agency_name, ''),
             NULL, 'Reserve for ' || to_char(r.calc_date, 'DD Mon YYYY') || coalesce(' · ' || r.notes, ''), r.marked_by
        FROM agent_reserve_receipts r JOIN agents a ON a.id = r.agent_id
       WHERE r.amount_paid > 0
      ${DONE}`,
  },
  {
    // A reserve receipt can be deleted from its screen. The money it
    // recorded does not un-happen, so the deletion is booked as a reversal
    // that says so, and the Reconciliation tab lists it.
    name: "reserve receipts deleted",
    q: sql`INSERT INTO fin_cash_book
        (occurred_at, direction, amount, account_id, method, category, source_type, source_id, leg,
         party_type, party_id, party_label, reference, memo, handled_by, reverses_id)
      SELECT now(), 'out', b.amount, b.account_id, b.method, b.category, b.source_type, b.source_id, 'deleted',
             b.party_type, b.party_id, b.party_label, b.reference,
             'Receipt deleted after it was booked', NULL, b.id
        FROM fin_cash_book b
       WHERE b.source_type = 'reserve_receipt' AND b.leg = 'main'
         AND NOT EXISTS (SELECT 1 FROM agent_reserve_receipts r WHERE r.id::text = b.source_id)
      ${DONE}`,
  },
  {
    name: "company expenses",
    q: sql`${INSERT}
      SELECT e.created_at, 'out', e.amount, ${CASH}, 'cash', 'expense', 'company_expense', e.id::text, 'main',
             'payee', NULL, e.payee_name, NULL, e.description, e.cashier_id
        FROM company_expenses e
       WHERE e.amount > 0
      ${DONE}`,
  },
  {
    name: "salaries",
    q: sql`${INSERT}
      SELECT coalesce(s.paid_at, s.created_at), 'out', s.net_amount, ${CASH}, 'cash', 'salary', 'salary_payment', s.id::text, 'main',
             s.staff_type || '_staff', s.staff_id,
             coalesce(cs.full_name, ast.name, 'Staff member'),
             NULL, 'Salary ' || lpad(s.period_month::text, 2, '0') || '/' || s.period_year, s.paid_by
        FROM salary_payments s
        LEFT JOIN company_staff cs ON s.staff_type = 'company' AND cs.id = s.staff_id
        LEFT JOIN agency_staff ast ON s.staff_type = 'agency' AND ast.id = s.staff_id
       WHERE s.status = 'paid' AND s.net_amount > 0
      ${DONE}`,
  },
  {
    // POS wins paid out of Paystack. The Master Wallet's disburse entry is the
    // record that the transfer went through.
    name: "POS win payouts",
    q: sql`${INSERT}
      SELECT l.created_at, 'out', l.amount, ${PAYSTACK}, 'transfer', 'win_payout', 'master_wallet', l.id::text, 'main',
             'writer', pr.writer_id, w.full_code || ' · ' || w.full_name, l.reference, 'POS win paid by transfer', l.actor_user_id
        FROM master_wallet_ledger l
        LEFT JOIN payout_requests pr ON pr.id = l.payout_request_id
        LEFT JOIN writers w ON w.id = pr.writer_id
       WHERE l.entry_type = 'disburse'
      ${DONE}`,
  },
  {
    // The director putting money into Paystack for wins, or taking it out.
    // Test money and its reversal are left out - see MW_EXCLUDED.
    name: "Master Wallet funding",
    q: sql`${INSERT}
      SELECT l.created_at, CASE WHEN l.entry_type = 'fund' THEN 'in' ELSE 'out' END, l.amount, ${PAYSTACK}, 'transfer',
             CASE WHEN l.entry_type = 'fund' THEN 'director_funding' ELSE 'director_withdrawal' END,
             'master_wallet', l.id::text, 'main', 'director', l.actor_user_id, NULL, l.reference, l.note, l.actor_user_id
        FROM master_wallet_ledger l
       WHERE l.entry_type IN ('fund', 'withdraw') AND NOT ${MW_EXCLUDED}
      ${DONE}`,
  },
  {
    // Cash put up towards wins the reserve could not cover, and any refund
    // of it. Money received for a purpose - never income.
    name: "winnings shortfall contributions",
    q: sql`${INSERT}
      SELECT c.received_at, CASE WHEN c.entry_type = 'refund' THEN 'out' ELSE 'in' END, c.amount, c.account_id, c.method,
             'shortfall_contribution', 'winnings_contribution', c.id::text, 'main',
             c.contributor_type, c.contributor_id, c.contributor_name, c.reference,
             CASE WHEN c.entry_type = 'refund' THEN 'Refund of contribution: ' ELSE 'Contribution towards wins: ' END || c.purpose,
             c.received_by
        FROM winnings_contributions c
      ${DONE}`,
  },
  {
    // What Paystack kept. Booked once its actual figure is known.
    name: "payment processing fees",
    q: sql`${INSERT}
      SELECT f.occurred_at, 'out', f.fee, ${PAYSTACK}, 'fee', 'processing_fee', 'payment_fee', f.id::text, 'main',
             NULL, NULL, 'Paystack', f.reference,
             'Paystack fee on ' || CASE WHEN f.kind = 'collection' THEN 'collection' ELSE 'transfer' END || ' of GH₵' || f.gross::text, NULL
        FROM fin_payment_fees f
       WHERE f.fee IS NOT NULL AND f.fee > 0
      ${DONE}`,
  },
];

/** Salary wallet movements become movements of the Salary Provision Fund. */
const FUND_GENERATORS: SQL[] = [
  sql`INSERT INTO fin_fund_movements (fund_code, entry_type, delta, reason, source_type, source_id, authorised_by, occurred_at)
      SELECT 'SALARY',
             CASE WHEN t.type = 'fund' THEN 'allocate' ELSE 'spend' END,
             CASE WHEN t.type = 'fund' THEN t.amount ELSE -t.amount END,
             coalesce(t.notes, CASE WHEN t.type = 'fund' THEN 'Allocated to salaries' ELSE 'Salary paid' END),
             'salary_wallet_tx', t.id::text, t.performed_by, t.created_at
        FROM salary_wallet_transactions t
       WHERE t.amount > 0
      ON CONFLICT (source_type, source_id) DO NOTHING`,
];

let lastSync = 0;
let inFlight: Promise<number> | null = null;

/**
 * Bring the cash book and fund ledger up to date. Concurrent callers share
 * one run, and a run within the last two seconds is reused: a page firing
 * five finance requests at once syncs once.
 */
export async function syncBooks(force = false): Promise<number> {
  if (!force && Date.now() - lastSync < 2000) return 0;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    let added = 0;
    try {
      await db.transaction(async (tx) => {
        // One sync at a time, across every server instance.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('fin_sync_books'))`);
        // Wins past their claim window leave the liability before anything
        // reads it.
        added += await releaseExpiredWinnings(tx);
        for (const g of GENERATORS) {
          const r = await tx.execute(g.q);
          added += r.rowCount ?? 0;
        }
        for (const q of FUND_GENERATORS) {
          const r = await tx.execute(q);
          added += r.rowCount ?? 0;
        }
      });
      lastSync = Date.now();
    } catch (err) {
      logger.error({ err }, "[FINANCE] book sync failed");
      throw err;
    } finally {
      inFlight = null;
    }
    return added;
  })();
  return inFlight;
}

export function toNum(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Balance of each money account at a moment (default: now). */
export async function moneyAccountBalances(exec: Exec = db, asOf?: string) {
  const until = asOf ? sql`AND b.occurred_at < ${asOf}::timestamptz` : sql``;
  const r = await exec.execute(sql`
    SELECT a.id, a.code, a.name, a.kind, a.institution, a.account_ref, a.is_active, a.is_system,
           a.opening_balance, a.opening_date, a.notes,
           coalesce(sum(b.amount) FILTER (WHERE b.direction = 'in'), 0)  AS total_in,
           coalesce(sum(b.amount) FILTER (WHERE b.direction = 'out'), 0) AS total_out,
           count(b.id)::int AS entries
      FROM fin_money_accounts a
      LEFT JOIN fin_cash_book b ON b.account_id = a.id ${until}
     GROUP BY a.id
     ORDER BY a.is_system DESC, a.created_at`);
  return (r.rows as Array<Record<string, unknown>>).map((x) => {
    const opening = toNum(x.opening_balance);
    const tin = toNum(x.total_in);
    const tout = toNum(x.total_out);
    return {
      id: String(x.id), code: String(x.code), name: String(x.name), kind: String(x.kind),
      institution: (x.institution as string) ?? null, accountRef: (x.account_ref as string) ?? null,
      isActive: Boolean(x.is_active), isSystem: Boolean(x.is_system), notes: (x.notes as string) ?? null,
      openingBalance: opening, openingDate: (x.opening_date as string) ?? null,
      totalIn: tin, totalOut: tout, entries: Number(x.entries),
      balance: round2(opening + tin - tout),
    };
  });
}

/** The reserve, as its ledger has it. See ./reserve.ts. */
export async function reserveBalance(exec: Exec = db) {
  const t = await reserveLedgerTotals(exec);
  return { contributed: t.contributed, drawn: t.drawn, balance: t.balance };
}

/** Each fund's balance: its movements, except the reserve, which is derived. */
export async function fundBalances(exec: Exec = db) {
  const r = await exec.execute(sql`
    SELECT f.code, f.name, f.description, f.is_system, f.is_active,
           coalesce(sum(m.delta) FILTER (WHERE m.delta > 0), 0)  AS allocated,
           coalesce(-sum(m.delta) FILTER (WHERE m.delta < 0), 0) AS used,
           coalesce(sum(m.delta), 0) AS balance
      FROM fin_funds f LEFT JOIN fin_fund_movements m ON m.fund_code = f.code
     GROUP BY f.code ORDER BY f.is_system DESC, f.created_at`);
  const reserve = await reserveBalance(exec);
  return (r.rows as Array<Record<string, unknown>>).map((x) => {
    if (x.code === "RESERVE") {
      return { code: "RESERVE", name: String(x.name), description: (x.description as string) ?? null, isSystem: true, isActive: true,
        allocated: reserve.contributed, used: reserve.drawn, balance: reserve.balance, derived: true };
    }
    return {
      code: String(x.code), name: String(x.name), description: (x.description as string) ?? null,
      isSystem: Boolean(x.is_system), isActive: Boolean(x.is_active),
      allocated: toNum(x.allocated), used: toNum(x.used), balance: round2(toNum(x.balance)), derived: false,
    };
  });
}

/**
 * Actual money, what is set aside inside it, and what is left. The funds
 * divide the money; they never add to it.
 */
export async function financialPosition(exec: Exec = db) {
  const accounts = await moneyAccountBalances(exec);
  const funds = await fundBalances(exec);
  const actual = round2(accounts.filter((a) => a.isActive || a.balance !== 0).reduce((s, a) => s + a.balance, 0));
  const earmarked = round2(funds.filter((f) => f.balance > 0).reduce((s, f) => s + f.balance, 0));
  return {
    accounts,
    funds,
    actual,
    earmarked,
    unallocated: round2(actual - earmarked),
    overCommitted: earmarked > actual + 0.005,
  };
}

export async function audit(
  exec: Exec,
  entry: { actorUserId?: string | null; actorRole?: string | null; action: string; entity: string; entityId?: string | null; detail?: unknown; note?: string | null },
) {
  await (exec as typeof db).insert(finAuditLogTable).values({
    actorUserId: entry.actorUserId ?? null,
    actorRole: entry.actorRole ?? null,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    detail: (entry.detail ?? null) as never,
    note: entry.note ?? null,
  });
}
