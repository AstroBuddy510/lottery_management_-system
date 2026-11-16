import {
  db,
  payoutRequestsTable,
  writersTable,
  ticketsTable,
  usersTable,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { recordFeeQuietly } from "./finance/fees";
import { disburse, type Actor } from "./master-wallet";
import {
  createMomoRecipient,
  initiateTransfer,
  verifyTransfer,
  isMomoProvider,
  toMinorUnits,
  type TransferOutcome,
} from "./paystack-transfers";
import { paystackConfigured } from "./paystack";
import { recordTicketEvent } from "./ticket-audit";
import { dispatchSystemNotification } from "./notify";
import { SmsAdapter } from "./sms-gateway";
import { logger } from "./logger";

/**
 * Stage 05 and 06: a cashier has approved; send the money and book it.
 *
 * A request leaves the queue (`verified`) for `processing` BEFORE Paystack is
 * called, in its own committed transaction. That ordering is the point: if the
 * process dies after Paystack has taken the instruction, the request is
 * already out of the queue and cannot be approved a second time. What is left
 * is a `processing` row with a reference, and Paystack can be asked what
 * became of that reference for as long as it takes.
 *
 * The request only becomes `paid`, and the Master Wallet only records the
 * disbursement, once Paystack says the transfer succeeded - never on the
 * strength of our own request having been sent.
 */

const sms = new SmsAdapter();

/** How long a transfer nobody can find at Paystack is given before being treated as never sent. */
const NOT_FOUND_GRACE_MS = 3 * 60 * 1000;

export type DisbursementState = "paid" | "processing" | "requeued";

export interface DisbursementResult {
  ok: boolean;
  state?: DisbursementState;
  httpStatus: number;
  message: string;
}

/** `poswin-<request id>-<attempt>`: lowercase, digits and dashes, well inside Paystack's 50 characters. */
function referenceFor(payoutId: string, attempt: number): string {
  return `poswin-${payoutId.replace(/-/g, "")}-${attempt}`;
}

/**
 * Book a confirmed transfer. Idempotent: the webhook, a status check and the
 * original response can all arrive for the same reference, and only the first
 * finds a row to change.
 *
 * Accepts a request that has gone back to `verified` as well as one still
 * `processing`. A transfer reported failed and then found to have succeeded
 * after all is rare, but the money has moved either way, and the request's
 * payout is still held - so it is booked rather than left looking unpaid.
 */
export async function markPaid(payoutId: string, reference: string): Promise<boolean> {
  const booked = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(payoutRequestsTable)
      .set({ status: "paid", paidAt: new Date(), transferStatus: "success", transferError: null })
      .where(
        and(
          eq(payoutRequestsTable.id, payoutId),
          eq(payoutRequestsTable.transferReference, reference),
          inArray(payoutRequestsTable.status, ["processing", "verified"]),
        ),
      )
      .returning();
    if (!row) return null;

    const amount = Number(row.payoutAmount).toFixed(2);
    const actor: Actor = { userId: row.reviewedBy, role: "cashier" };

    await disburse(tx, {
      payoutRequestId: row.id,
      amount,
      actor,
      reference,
      note: `POS win paid to ${row.payeeMomoNumber ?? "wallet"}`,
    });

    await recordTicketEvent(tx, {
      ticketId: row.ticketId,
      eventType: "paid",
      actorUserId: row.reviewedBy,
      actorRole: "cashier",
      source: "system",
      note: `GHS ${amount} sent to MoMo ${row.payeeMomoNumber ?? ""} (${reference})`,
    });

    // Kept from the old paying step: a postpaid writer's ledger records the
    // win against the draw. Recorded only - it is never netted off what they owe.
    await tx.execute(sql`
      UPDATE postpaid_daily_ledger l
         SET total_winnings = l.total_winnings + ${amount}::numeric
        FROM game_results gr
       WHERE gr.id = ${row.gameResultId}
         AND l.game_id = gr.game_id
         AND l.writer_id = ${row.writerId}
    `);

    return row;
  });

  if (!booked) return false;

  // The fee Paystack charged for this transfer, as Paystack reports it.
  // Outside the payment's transaction: a fee lookup that fails must never
  // un-pay a winner. A missing figure is picked up by the Fees sync later.
  void (async () => {
    try {
      const v = await verifyTransfer(reference);
      recordFeeQuietly({
        reference, kind: "transfer", sourceType: "payout_request", sourceId: payoutId,
        grossMinor: toMinorUnits(Number(booked.payoutAmount).toFixed(2)),
        feeMinor: v.state === "success" && "feeMinor" in v ? v.feeMinor : null,
        capturedFrom: "verify", occurredAt: new Date(),
      });
    } catch (err) {
      logger.warn({ err, payoutId }, "[PAYOUT] paid; fee lookup failed and will be retried by the Fees sync");
    }
  })();

  // After the commit, never inside it: a text that fails to send must not
  // un-pay a payout.
  try {
    const [info] = await db
      .select({ phone: writersTable.phone, ticketNumber: ticketsTable.ticketNumber })
      .from(payoutRequestsTable)
      .innerJoin(writersTable, eq(writersTable.id, payoutRequestsTable.writerId))
      .innerJoin(ticketsTable, eq(ticketsTable.id, payoutRequestsTable.ticketId))
      .where(eq(payoutRequestsTable.id, payoutId))
      .limit(1);
    if (info?.phone) {
      await sms.send(
        info.phone,
        `VS2000: GHS ${Number(booked.payoutAmount).toFixed(2)} for winning ticket ${info.ticketNumber} has been sent to your MoMo wallet ${booked.payeeMomoNumber ?? ""}.`,
      );
    }
  } catch (err) {
    logger.error({ err, payoutId }, "[PAYOUT] paid, but the confirmation text failed");
  }
  return true;
}

/**
 * The transfer definitely did not happen. Back to the cashier queue with the
 * reason attached; the payout stays held in the Master Wallet.
 */
export async function requeueAfterFailure(payoutId: string, reference: string, message: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(payoutRequestsTable)
      .set({ status: "verified", transferStatus: "failed", transferError: message.slice(0, 500) })
      .where(
        and(
          eq(payoutRequestsTable.id, payoutId),
          eq(payoutRequestsTable.transferReference, reference),
          eq(payoutRequestsTable.status, "processing"),
        ),
      )
      .returning({ ticketId: payoutRequestsTable.ticketId, reviewedBy: payoutRequestsTable.reviewedBy });
    if (!row) return false;
    await recordTicketEvent(tx, {
      ticketId: row.ticketId,
      eventType: "transfer_failed",
      actorUserId: row.reviewedBy,
      actorRole: "cashier",
      source: "system",
      note: `${reference}: ${message}`.slice(0, 500),
    });
    return true;
  });
}

async function noteInFlight(payoutId: string, reference: string, outcome: TransferOutcome): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (outcome.state === "pending") {
    patch["transferStatus"] = outcome.paystackStatus;
    patch["transferCode"] = outcome.transferCode;
    patch["transferError"] = null;
  } else if (outcome.state === "otp") {
    patch["transferStatus"] = "otp";
    patch["transferCode"] = outcome.transferCode;
    patch["transferError"] =
      "Paystack is waiting for a one-time code. Transfers by API need OTP switched off in the Paystack dashboard (Settings → Preferences).";
  } else if (outcome.state === "unknown") {
    patch["transferStatus"] = "unknown";
    patch["transferError"] = `No clear answer from Paystack (${outcome.message}). Use "Check status" - do not approve again.`;
  }
  await db
    .update(payoutRequestsTable)
    .set(patch)
    .where(and(eq(payoutRequestsTable.id, payoutId), eq(payoutRequestsTable.transferReference, reference)));
}

/** Turn whatever Paystack said into the request's next state. */
async function settle(payoutId: string, reference: string, outcome: TransferOutcome): Promise<DisbursementResult> {
  if (outcome.state === "success") {
    await markPaid(payoutId, reference);
    return { ok: true, state: "paid", httpStatus: 200, message: "Paid. Paystack confirmed the transfer." };
  }
  if (outcome.state === "failed") {
    await requeueAfterFailure(payoutId, reference, outcome.message);
    return {
      ok: false,
      state: "requeued",
      httpStatus: 502,
      message: `Paystack did not send the money: ${outcome.message}. The request is back in the queue.`,
    };
  }
  await noteInFlight(payoutId, reference, outcome);
  return {
    ok: true,
    state: "processing",
    httpStatus: 202,
    message:
      outcome.state === "pending"
        ? "Transfer sent. It will show as paid when Paystack confirms it."
        : outcome.state === "otp"
          ? "Paystack is waiting for a one-time code - see the note on the request."
          : "Paystack did not answer clearly. The request is held as processing; check its status shortly.",
  };
}

/**
 * A cashier approves one verified request.
 */
export async function approveAndDisburse(payoutId: string, cashier: { userId: string }): Promise<DisbursementResult> {
  // Fail closed, and before anything changes: with no Paystack there is no
  // way to pay, and "approved" must never mean anything short of "sent".
  if (!paystackConfigured()) {
    return { ok: false, httpStatus: 503, message: "Paystack is not configured on this server, so nothing can be paid out." };
  }

  const [current] = await db
    .select()
    .from(payoutRequestsTable)
    .where(eq(payoutRequestsTable.id, payoutId))
    .limit(1);
  if (!current) return { ok: false, httpStatus: 404, message: "Payout request not found" };
  if (current.status !== "verified") {
    return { ok: false, httpStatus: 409, message: `This request is ${current.status.replace("_", " ")}, not waiting for approval.` };
  }
  if (!current.payeeMomoNumber || !isMomoProvider(current.payeeMomoProvider)) {
    return { ok: false, httpStatus: 409, message: "This request has no MoMo wallet recorded. Reject it so it can be re-claimed." };
  }

  // An earlier attempt left a reference behind. Before sending anything new,
  // find out for certain what became of it - a transfer believed failed that
  // actually went through must be booked, not repeated.
  if (current.transferReference) {
    const previous = await verifyTransfer(current.transferReference);
    if (previous.state === "success") {
      await db
        .update(payoutRequestsTable)
        .set({ reviewedBy: cashier.userId, reviewedAt: new Date() })
        .where(and(eq(payoutRequestsTable.id, payoutId), eq(payoutRequestsTable.status, "verified")));
      await markPaid(payoutId, current.transferReference);
      return { ok: true, state: "paid", httpStatus: 200, message: "The earlier transfer had already gone through. Booked as paid; nothing was sent again." };
    }
    if (previous.state !== "failed" && previous.state !== "not_found") {
      return {
        ok: false,
        httpStatus: 409,
        message: "The previous transfer for this request is still unresolved at Paystack. Try again in a few minutes.",
      };
    }
  }

  // Out of the queue, with its reference, before Paystack hears about it.
  const attempt = current.transferAttempts + 1;
  const reference = referenceFor(payoutId, attempt);
  const [claimed] = await db
    .update(payoutRequestsTable)
    .set({
      status: "processing",
      reviewedBy: cashier.userId,
      reviewedAt: new Date(),
      transferReference: reference,
      transferAttempts: attempt,
      transferInitiatedAt: new Date(),
      transferStatus: "initiating",
      transferCode: null,
      transferError: null,
    })
    .where(and(eq(payoutRequestsTable.id, payoutId), eq(payoutRequestsTable.status, "verified")))
    .returning();
  if (!claimed) {
    return { ok: false, httpStatus: 409, message: "Another cashier has just acted on this request." };
  }

  await recordTicketEvent(db, {
    ticketId: claimed.ticketId,
    eventType: "claim_approved",
    actorUserId: cashier.userId,
    actorRole: "cashier",
    source: "admin",
    note: `Approved under POS WINS PAYMENT; transfer ${reference}`,
  });

  // The recipient is made for the wallet the cashier actually saw - the one
  // frozen on the request - not whatever the writer's record says now.
  const [writer] = await db
    .select({
      momoNumber: writersTable.momoNumber,
      momoProvider: writersTable.momoProvider,
      recipientCode: writersTable.paystackRecipientCode,
      fullName: writersTable.fullName,
    })
    .from(writersTable)
    .where(eq(writersTable.id, claimed.writerId))
    .limit(1);

  const walletUnchanged =
    writer?.momoNumber === claimed.payeeMomoNumber && writer?.momoProvider === claimed.payeeMomoProvider;

  let recipientCode = walletUnchanged ? (writer?.recipientCode ?? null) : null;
  if (!recipientCode) {
    const made = await createMomoRecipient({
      name: claimed.payeeName ?? writer?.fullName ?? "Writer",
      number: claimed.payeeMomoNumber!,
      provider: claimed.payeeMomoProvider as "mtn",
    });
    if (!made.ok) {
      // Nothing was sent - no transfer was ever attempted on this reference.
      await requeueAfterFailure(payoutId, reference, `Could not register the MoMo wallet with Paystack: ${made.message}`);
      return { ok: false, state: "requeued", httpStatus: 502, message: `Paystack would not accept that MoMo wallet: ${made.message}` };
    }
    recipientCode = made.recipientCode;
    if (walletUnchanged) {
      await db
        .update(writersTable)
        .set({ paystackRecipientCode: recipientCode })
        .where(eq(writersTable.id, claimed.writerId));
    }
  }

  const outcome = await initiateTransfer({
    amount: Number(claimed.payoutAmount).toFixed(2),
    recipientCode,
    reference,
    reason: "VS2000 POS win payout",
  });

  return settle(payoutId, reference, outcome);
}

/**
 * Ask Paystack what became of a `processing` request. Used by the cashier's
 * "Check status" and safe to press any number of times.
 */
export async function reconcileTransfer(payoutId: string): Promise<DisbursementResult> {
  const [row] = await db
    .select()
    .from(payoutRequestsTable)
    .where(eq(payoutRequestsTable.id, payoutId))
    .limit(1);
  if (!row) return { ok: false, httpStatus: 404, message: "Payout request not found" };
  if (row.status !== "processing" || !row.transferReference) {
    return { ok: false, httpStatus: 409, message: `This request is ${row.status}; there is no transfer in flight to check.` };
  }

  const found = await verifyTransfer(row.transferReference);

  if (found.state === "not_found") {
    // Paystack has never heard of it. Only believed once the original request
    // has had time to arrive - checked too early, a transfer still on its way
    // in would be sent back to the queue and then land.
    const age = Date.now() - (row.transferInitiatedAt?.getTime() ?? 0);
    if (age < NOT_FOUND_GRACE_MS) {
      return { ok: true, state: "processing", httpStatus: 202, message: "Paystack has not registered the transfer yet. Check again in a few minutes." };
    }
    await requeueAfterFailure(payoutId, row.transferReference, "Paystack has no record of this transfer; it was never sent");
    return { ok: false, state: "requeued", httpStatus: 200, message: "Paystack never received this transfer. The request is back in the queue." };
  }

  if (found.state === "success") {
    const expected = toMinorUnits(Number(row.payoutAmount).toFixed(2));
    if ("amountMinor" in found && found.amountMinor !== expected) {
      logger.error({ payoutId, expected, got: found.amountMinor }, "[PAYOUT] Paystack amount does not match the request");
      return { ok: false, httpStatus: 409, message: "Paystack reports a different amount for this transfer. Left as processing for manual review." };
    }
  }

  return settle(payoutId, row.transferReference, found as TransferOutcome);
}

/**
 * Paystack's own account of a transfer, arriving by webhook. The signature
 * has been checked by the caller; the event is still confirmed against the
 * API before any money is booked, for the same reason charges are - a signed
 * message proves who sent it, not that it is still true.
 */
export async function handleTransferEvent(event: string, reference: string): Promise<void> {
  const [row] = await db
    .select()
    .from(payoutRequestsTable)
    .where(eq(payoutRequestsTable.transferReference, reference))
    .limit(1);
  if (!row) {
    logger.warn({ event, reference }, "[PAYOUT] transfer event for a reference we did not issue");
    return;
  }

  const found = await verifyTransfer(reference);

  if (event === "transfer.success") {
    if (found.state !== "success") {
      logger.warn({ reference, state: found.state }, "[PAYOUT] transfer.success webhook not confirmed by Paystack; ignored");
      return;
    }
    const expected = toMinorUnits(Number(row.payoutAmount).toFixed(2));
    if ("amountMinor" in found && found.amountMinor !== expected) {
      logger.error({ reference, expected, got: found.amountMinor }, "[PAYOUT] webhook amount does not match the request; not booked");
      return;
    }
    await markPaid(row.id, reference);
    return;
  }

  if (event === "transfer.failed" || event === "transfer.reversed") {
    if (row.status === "paid") {
      // Booked as paid and now reversed: the money is back in the Paystack
      // balance but our ledger says it left. That needs a person.
      await alertStaff(
        `Paid POS win reversed by Paystack`,
        `Transfer ${reference} was confirmed and has since been reversed. The ledger still shows it as disbursed. Review it against the Paystack dashboard.`,
      );
      await recordTicketEvent(db, {
        ticketId: row.ticketId,
        eventType: "transfer_failed",
        source: "system",
        note: `${reference} reversed by Paystack AFTER being booked as paid`,
      });
      return;
    }
    if (found.state === "failed") {
      await requeueAfterFailure(row.id, reference, found.message);
    }
  }
}

/** An in-app alert to everyone who should know: administrators and directors. */
export async function alertStaff(title: string, body: string, roles: string[] = ["administrator", "director"]): Promise<void> {
  try {
    const staff = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(inArray(usersTable.role, roles as never[]), eq(usersTable.isActive, true)));
    if (staff.length === 0) return;
    await dispatchSystemNotification({
      sentBy: staff[0]!.id,
      messageType: "alert",
      title,
      body,
      targetType: "system",
      recipientUserIds: staff.map((s) => s.id),
    });
  } catch (err) {
    logger.error({ err, title }, "[PAYOUT] could not raise a staff alert");
  }
}
