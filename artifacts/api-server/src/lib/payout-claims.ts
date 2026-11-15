import {
  db,
  ticketsTable,
  writersTable,
  gamesTable,
  gameResultsTable,
  payoutRequestsTable,
  payoutClaimAttemptsTable,
  usersTable,
} from "@workspace/db";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { holdForPayout, type Actor } from "./master-wallet";
import { recordTicketEvent } from "./ticket-audit";
import { expiryDate, TICKET_VALIDITY_DAYS } from "./receipt";
import { dispatchSystemNotification } from "./notify";
import { logger } from "./logger";

/**
 * Stage 03 and 04: a writer presents a ticket on their POS, and the system
 * decides whether it is owed money.
 *
 * The decision is never "does this ticket carry winning numbers". That
 * question is how each of the frauds this was built against would work:
 *
 *   A ticket from last week whose numbers happen to match TODAY'S draw.
 *     Nothing here compares numbers to a draw. A ticket is settled once, by
 *     the engine, against the one game it was sold into. If it lost that
 *     game it is `lost` for ever, whatever any later draw produces.
 *
 *   A ticket from another company.
 *     It has no row in our tickets table. There is nothing to look up, so
 *     there is nothing to pay. The attempt is recorded all the same.
 *
 *   The same ticket twice.
 *     A winning ticket has exactly one registry row (unique on ticket_id) and
 *     claiming it is one UPDATE ... WHERE status = 'pending'. Postgres lets
 *     that succeed once. A second scan - a second later or from two phones at
 *     the same instant - finds no pending row and changes nothing.
 *
 * So eligibility is read from the Winning Tickets registry, which only
 * settlement writes. The QR is merely how the writer says which row they mean.
 */

export type ClaimOutcome =
  | "accepted"
  | "accepted_awaiting_funds"
  | "unreadable"
  | "not_found"
  | "forged"
  | "not_owner"
  | "not_drawn"
  | "not_winner"
  | "voided"
  | "not_in_registry"
  | "already_claimed"
  | "already_paid"
  | "under_review"
  | "withheld"
  | "expired"
  | "no_wallet"
  | "writer_inactive"
  | "too_many_attempts";

export interface ClaimResult {
  outcome: ClaimOutcome;
  accepted: boolean;
  message: string;
  ticketNumber?: string;
  amount?: string;
  payoutId?: string;
}

/** Refusals that look like somebody trying things, rather than a slip of the hand. */
const SUSPICIOUS: ClaimOutcome[] = ["not_found", "forged", "not_owner"];
const SUSPICIOUS_LIMIT = 10;
const SUSPICIOUS_WINDOW_MS = 60 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Presented =
  | { kind: "ticket"; id?: string; number?: string; writerCode?: string }
  | { kind: "slip"; slip: string }
  | { kind: "unreadable" };

/**
 * What the scanner handed over. A printed ticket's QR is the JSON written by
 * buildQrPayload - {t, n, w, a, ts} - and a slip's is {s, w, ts}. A typed
 * entry is just the ticket number.
 */
export function parsePresented(raw: string): Presented {
  const text = raw.trim();
  if (text.length === 0 || text.length > 600) return { kind: "unreadable" };

  if (text.startsWith("{")) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { kind: "unreadable" };
    }
    if (typeof parsed["s"] === "string" && parsed["s"].length <= 30) {
      return { kind: "slip", slip: parsed["s"] };
    }
    const id = typeof parsed["t"] === "string" && UUID.test(parsed["t"]) ? parsed["t"] : undefined;
    const number = typeof parsed["n"] === "string" && parsed["n"].length <= 30 ? parsed["n"] : undefined;
    const writerCode = typeof parsed["w"] === "string" ? parsed["w"] : undefined;
    if (!id && !number) return { kind: "unreadable" };
    return { kind: "ticket", id, number, writerCode };
  }

  if (UUID.test(text)) return { kind: "ticket", id: text };
  if (/^[A-Za-z0-9-]{4,30}$/.test(text)) return { kind: "ticket", number: text };
  return { kind: "unreadable" };
}

/** A ticket is honoured through the end of its last valid day. */
function hasExpired(gameCloseAt: Date, now: Date): { expired: boolean; validUntil: Date } {
  const validUntil = expiryDate(gameCloseAt, TICKET_VALIDITY_DAYS);
  validUntil.setUTCHours(23, 59, 59, 999); // Accra is GMT all year.
  return { expired: now.getTime() > validUntil.getTime(), validUntil };
}

const fmtDay = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Accra" });

async function logAttempt(entry: {
  writerId: string;
  ticketId?: string | null;
  presented: string;
  method: string;
  outcome: ClaimOutcome;
  detail?: string | null;
}): Promise<void> {
  try {
    await db.insert(payoutClaimAttemptsTable).values({
      writerId: entry.writerId,
      ticketId: entry.ticketId ?? null,
      presented: entry.presented.slice(0, 200),
      method: entry.method,
      outcome: entry.outcome,
      detail: entry.detail ?? null,
    });
  } catch (err) {
    // The decision has been made and must stand; a missing log row is the
    // lesser failure. It is still loud, because this log is the fraud record.
    logger.error({ err, outcome: entry.outcome }, "[CLAIMS] could not record a claim attempt");
  }
}

async function suspiciousCount(writerId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(payoutClaimAttemptsTable)
    .where(
      and(
        eq(payoutClaimAttemptsTable.writerId, writerId),
        inArray(payoutClaimAttemptsTable.outcome, SUSPICIOUS),
        gte(payoutClaimAttemptsTable.createdAt, new Date(Date.now() - SUSPICIOUS_WINDOW_MS)),
      ),
    );
  return row?.n ?? 0;
}

/** Tell the administrators once, on the attempt that crosses the line. */
async function raiseSuspicionAlert(writer: { id: string; fullCode: string; fullName: string }): Promise<void> {
  try {
    const admins = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.role, "administrator"), eq(usersTable.isActive, true)));
    if (admins.length === 0) return;
    await dispatchSystemNotification({
      sentBy: admins[0]!.id,
      messageType: "alert",
      title: `Repeated invalid claim attempts — ${writer.fullCode}`,
      body:
        `${writer.fullName} (${writer.fullCode}) has presented ${SUSPICIOUS_LIMIT} tickets in the last hour ` +
        `that were not ours, not theirs, or did not match our records. Further claims from this ` +
        `terminal are paused for an hour. See Risk Management → Claim attempts.`,
      targetType: "system",
      recipientUserIds: admins.map((a) => a.id),
    });
  } catch (err) {
    logger.error({ err }, "[CLAIMS] could not raise the suspicion alert");
  }
}

interface WriterContext {
  id: string;
  fullCode: string;
  fullName: string;
  isActive: boolean;
  approvalStatus: string;
  momoNumber: string | null;
  momoProvider: string | null;
  momoAccountName: string | null;
}

/**
 * Decide one ticket. Everything that can refuse it does so before anything is
 * written; the single write at the end is the claim itself.
 */
async function claimTicket(
  writer: WriterContext,
  ref: { id?: string; number?: string; writerCode?: string },
  method: "qr" | "manual",
  now: Date,
): Promise<ClaimResult & { ticketId?: string }> {
  // ── Is it ours at all? ──
  const [byRef] = await db
    .select({
      ticket: ticketsTable,
      gameName: gamesTable.name,
      eventNumber: gamesTable.eventNumber,
      gameCloseAt: gamesTable.closeAt,
      sellerCode: writersTable.fullCode,
    })
    .from(ticketsTable)
    .innerJoin(gamesTable, eq(gamesTable.id, ticketsTable.gameId))
    .innerJoin(writersTable, eq(writersTable.id, ticketsTable.writerId))
    .where(ref.id ? eq(ticketsTable.id, ref.id) : eq(ticketsTable.ticketNumber, ref.number!))
    .limit(1);

  if (!byRef) {
    return {
      outcome: "not_found",
      accepted: false,
      message: "This ticket was not issued by VS2000. It cannot be paid here.",
    };
  }

  const { ticket } = byRef;
  const base = { ticketId: ticket.id, ticketNumber: ticket.ticketNumber };

  // A QR carries the ticket's id, its number and the seller's code together.
  // A real one agrees with itself; one assembled from a known ticket number
  // and somebody else's id does not.
  if (
    (ref.id && ref.number && ticket.ticketNumber !== ref.number) ||
    (ref.writerCode && ref.writerCode !== byRef.sellerCode)
  ) {
    return {
      ...base,
      outcome: "forged",
      accepted: false,
      message: "This code does not match our record of the ticket. It has been reported for review.",
    };
  }

  // ── Is it this writer's to claim? ──
  if (ticket.writerId !== writer.id) {
    return {
      ...base,
      outcome: "not_owner",
      accepted: false,
      message: "This ticket was sold on another terminal. It can only be claimed by the writer who sold it.",
    };
  }

  const drawLabel = `${byRef.gameName} #${byRef.eventNumber} (${fmtDay(byRef.gameCloseAt)})`;

  // ── Did it win the draw it was sold into? ──
  if (ticket.status === "active") {
    return { ...base, outcome: "not_drawn", accepted: false, message: `The draw for ${drawLabel} has not been run yet.` };
  }
  if (ticket.status === "void" || ticket.status === "cancelled") {
    return { ...base, outcome: "voided", accepted: false, message: "This ticket was voided and cannot be paid." };
  }
  if (ticket.status !== "won" || !ticket.isWinner) {
    return {
      ...base,
      outcome: "not_winner",
      accepted: false,
      // Said in full, because this is the ticket-from-an-old-game case: the
      // writer may be looking at today's numbers and seeing a match.
      message: `This ticket was played in ${drawLabel} and did not win that draw. A ticket only counts in the draw it was bought for.`,
    };
  }

  // ── Is it in the registry, and where has it got to? ──
  const [request] = await db
    .select({
      id: payoutRequestsTable.id,
      status: payoutRequestsTable.status,
      payoutAmount: payoutRequestsTable.payoutAmount,
      paidAt: payoutRequestsTable.paidAt,
      resultGameId: gameResultsTable.gameId,
    })
    .from(payoutRequestsTable)
    .innerJoin(gameResultsTable, eq(gameResultsTable.id, payoutRequestsTable.gameResultId))
    .where(eq(payoutRequestsTable.ticketId, ticket.id))
    .limit(1);

  // A won ticket with no registry row, a registry row pointing at another
  // game's result, or an amount that is not what settlement wrote on the
  // ticket: none of these can come from normal operation.
  if (
    !request ||
    request.resultGameId !== ticket.gameId ||
    Number(request.payoutAmount) !== Number(ticket.winAmount) ||
    Number(request.payoutAmount) <= 0
  ) {
    logger.error(
      { ticketId: ticket.id, hasRequest: !!request },
      "[CLAIMS] winning ticket and registry disagree - refusing the claim",
    );
    return {
      ...base,
      outcome: "not_in_registry",
      accepted: false,
      message: "This ticket could not be verified against the winning tickets list. It has been reported for review.",
    };
  }

  const amount = Number(request.payoutAmount).toFixed(2);
  const withAmount = { ...base, amount, payoutId: request.id };

  switch (request.status) {
    case "pending":
      break;
    case "paid":
      return {
        ...withAmount,
        outcome: "already_paid",
        accepted: false,
        message: `This ticket was already paid${request.paidAt ? ` on ${fmtDay(request.paidAt)}` : ""}. A ticket is paid once.`,
      };
    case "rejected":
      return { ...withAmount, outcome: "under_review", accepted: false, message: "This claim was sent back for review. You will be told the outcome." };
    case "withheld":
      return { ...withAmount, outcome: "withheld", accepted: false, message: "Payment on this ticket has been withheld. Contact your agent." };
    default:
      return { ...withAmount, outcome: "already_claimed", accepted: false, message: "This ticket has already been claimed and is waiting for payment." };
  }

  // ── Is it still in date? ──
  const validity = hasExpired(byRef.gameCloseAt, now);
  if (validity.expired) {
    return {
      ...withAmount,
      outcome: "expired",
      accepted: false,
      message: `This ticket expired on ${fmtDay(validity.validUntil)}. Tickets are valid for ${TICKET_VALIDITY_DAYS} days after the draw.`,
    };
  }

  // ── Is there somewhere to pay it? ──
  if (!writer.momoNumber || !writer.momoProvider) {
    return {
      ...withAmount,
      outcome: "no_wallet",
      accepted: false,
      message: "You have no MoMo wallet registered for payouts. Ask your agent to add one, then scan again.",
    };
  }

  // ── The claim. One statement decides who got there first. ──
  const actor: Actor = { userId: null, role: "writer" };
  const result = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(payoutRequestsTable)
      .set({
        status: "verified",
        claimedAt: now,
        claimMethod: method,
        payeeMomoNumber: writer.momoNumber,
        payeeMomoProvider: writer.momoProvider,
        payeeName: writer.momoAccountName ?? writer.fullName,
      })
      .where(and(eq(payoutRequestsTable.id, request.id), eq(payoutRequestsTable.status, "pending")))
      .returning({ id: payoutRequestsTable.id });

    if (!claimed) return "lost_race" as const;

    const held = await holdForPayout(tx, {
      payoutRequestId: request.id,
      amount,
      actor,
      note: `Allocated for ticket ${ticket.ticketNumber}`,
    });

    if (!held) {
      // Verified, but there is nothing to back it. It waits outside the
      // cashier queue: a cashier must never be offered a payment the wallet
      // cannot make.
      await tx
        .update(payoutRequestsTable)
        .set({ status: "awaiting_funds" })
        .where(eq(payoutRequestsTable.id, request.id));
    }

    await recordTicketEvent(tx, {
      ticketId: ticket.id,
      eventType: "claim_submitted",
      fromStatus: "won",
      toStatus: "won",
      actorRole: "writer",
      source: "portal",
      note: `${method === "qr" ? "Scanned" : "Entered by hand"} on ${writer.fullCode}; ${amount} ${held ? "held from Master Wallet" : "awaiting Master Wallet funds"}`,
      occurredAt: now,
    });

    return held ? ("held" as const) : ("unfunded" as const);
  });

  if (result === "lost_race") {
    return { ...withAmount, outcome: "already_claimed", accepted: false, message: "This ticket has already been claimed and is waiting for payment." };
  }
  if (result === "unfunded") {
    return {
      ...withAmount,
      outcome: "accepted_awaiting_funds",
      accepted: true,
      message: `Claim received for GHS ${amount}. It will join the payment queue as soon as funds are released.`,
    };
  }
  return {
    ...withAmount,
    outcome: "accepted",
    accepted: true,
    message: `Claim verified for GHS ${amount}. It is with the cashier for payment to your MoMo wallet.`,
  };
}

/**
 * A writer presents something on their POS. Returns one result per ticket -
 * a slip of several bets is several tickets, each claimed on its own.
 */
export async function submitClaim(
  writerId: string,
  presentedRaw: string,
  method: "qr" | "manual",
): Promise<ClaimResult[]> {
  const now = new Date();
  const presentedText = typeof presentedRaw === "string" ? presentedRaw : "";

  const [writer] = await db
    .select({
      id: writersTable.id,
      fullCode: writersTable.fullCode,
      fullName: writersTable.fullName,
      isActive: writersTable.isActive,
      approvalStatus: writersTable.approvalStatus,
      momoNumber: writersTable.momoNumber,
      momoProvider: writersTable.momoProvider,
      momoAccountName: writersTable.momoAccountName,
    })
    .from(writersTable)
    .where(eq(writersTable.id, writerId))
    .limit(1);

  if (!writer || !writer.isActive || writer.approvalStatus !== "approved") {
    return [{ outcome: "writer_inactive", accepted: false, message: "This terminal is not active. Contact your agent." }];
  }

  // A terminal that has just presented ten tickets that were not ours, not
  // its own, or did not match, stops being answered for an hour. Checked
  // before anything is looked up, so the pause cannot be used to keep probing.
  if ((await suspiciousCount(writer.id)) >= SUSPICIOUS_LIMIT) {
    await logAttempt({ writerId: writer.id, presented: presentedText, method, outcome: "too_many_attempts" });
    return [{
      outcome: "too_many_attempts",
      accepted: false,
      message: "Too many invalid tickets have been presented on this terminal. Claims are paused for an hour.",
    }];
  }

  const presented = parsePresented(presentedText);

  if (presented.kind === "unreadable") {
    await logAttempt({ writerId: writer.id, presented: presentedText, method, outcome: "unreadable" });
    return [{ outcome: "unreadable", accepted: false, message: "That code could not be read. Scan the QR on the ticket again, or type the ticket number." }];
  }

  // Which tickets is this about?
  let refs: Array<{ id?: string; number?: string; writerCode?: string }>;
  if (presented.kind === "slip") {
    const onSlip = await db
      .select({ id: ticketsTable.id, status: ticketsTable.status })
      .from(ticketsTable)
      .where(eq(ticketsTable.slipNumber, presented.slip));
    if (onSlip.length === 0) {
      refs = [{ number: presented.slip }]; // falls through to not_found, and is logged as such
    } else {
      // Only the bets that won are being claimed. If none did, report the
      // first so the writer is told why rather than told nothing.
      const winners = onSlip.filter((t) => t.status === "won");
      refs = (winners.length > 0 ? winners : onSlip.slice(0, 1)).map((t) => ({ id: t.id }));
    }
  } else {
    refs = [{ id: presented.id, number: presented.number, writerCode: presented.writerCode }];
  }

  const results: ClaimResult[] = [];
  for (const ref of refs) {
    const { ticketId, ...result } = await claimTicket(writer, ref, method, now);
    await logAttempt({
      writerId: writer.id,
      ticketId,
      presented: presentedText,
      method,
      outcome: result.outcome,
      detail: result.accepted ? null : result.message,
    });
    results.push(result);

    if (SUSPICIOUS.includes(result.outcome) && (await suspiciousCount(writer.id)) === SUSPICIOUS_LIMIT) {
      await raiseSuspicionAlert(writer);
    }
  }
  return results;
}

/**
 * Money has arrived: move waiting claims into the cashier queue, oldest first.
 * Runs inside the funding transaction, so a top-up and the claims it unblocks
 * commit together. A claim too large for what is left is skipped rather than
 * blocking the smaller ones behind it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function promoteAwaitingFunds(tx: any, actor: Actor): Promise<number> {
  const waiting = await tx
    .select({
      id: payoutRequestsTable.id,
      payoutAmount: payoutRequestsTable.payoutAmount,
      ticketId: payoutRequestsTable.ticketId,
    })
    .from(payoutRequestsTable)
    .where(eq(payoutRequestsTable.status, "awaiting_funds"))
    .orderBy(payoutRequestsTable.claimedAt)
    .for("update");

  let promoted = 0;
  for (const row of waiting as Array<{ id: string; payoutAmount: string; ticketId: string }>) {
    const amount = Number(row.payoutAmount).toFixed(2);
    const held = await holdForPayout(tx, {
      payoutRequestId: row.id,
      amount,
      actor,
      note: "Allocated after Master Wallet top-up",
    });
    if (!held) continue;
    await tx
      .update(payoutRequestsTable)
      .set({ status: "verified" })
      .where(and(eq(payoutRequestsTable.id, row.id), eq(payoutRequestsTable.status, "awaiting_funds")));
    promoted += 1;
  }
  return promoted;
}
