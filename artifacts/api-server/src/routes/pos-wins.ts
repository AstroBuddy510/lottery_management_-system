import { Router } from "express";
import {
  db,
  payoutRequestsTable,
  payoutClaimAttemptsTable,
  masterWalletLedgerTable,
  ticketsTable,
  writersTable,
  agentsTable,
  usersTable,
  gamesTable,
  betTypesTable,
  gameResultsTable,
  ticketEventsTable,
} from "@workspace/db";
import { and, desc, eq, gte, lte, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middleware/auth";
import { livePaystackBalance } from "../lib/finance/paystack-balance";
import { submitClaim, promoteAwaitingFunds } from "../lib/payout-claims";
import {
  approveAndDisburse,
  reconcileTransfer,
  alertStaff,
} from "../lib/payout-disbursement";
import {
  fundWallet,
  withdrawFromWallet,
  holdForPayout,
  releaseHold,
  readWallet,
  parseAmount,
} from "../lib/master-wallet";
import {
  MOMO_PROVIDERS,
  isMomoProvider,
  normaliseMomoNumber,
  isGhanaMobile,
  resolveMomoName,
  paystackGhsBalance,
} from "../lib/paystack-transfers";
import { paystackConfigured } from "../lib/paystack";
import { recordTicketEvent, detectTicketAnomalies, type AuditTicket, type AuditEvent } from "../lib/ticket-audit";
import { SmsAdapter } from "../lib/sms-gateway";
import { logger } from "../lib/logger";
import { expiryDate, TICKET_VALIDITY_DAYS } from "../lib/receipt";

/**
 * POS wins: who may do what.
 *
 *   writer         claims their own winning tickets, sees their own claims
 *   cashier        approves or rejects verified claims; nothing else here
 *   administrator  reviews what a cashier rejected; reads the Master Wallet
 *   director       funds the Master Wallet; reads everything
 *
 * The lines are drawn so that no one role can both create a payout and
 * release it. The administrator runs the draw that makes a ticket a winner
 * and cannot approve its payment. The cashier approves payment and can
 * neither run a draw, fund the wallet, nor change where a writer is paid.
 * The director supplies the money and takes no part in the daily flow.
 */

const router = Router();
const sms = new SmsAdapter();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cashierUsers = alias(usersTable, "cashier_users");

/* ════════════════════════════ Writer: claims ════════════════════════════ */

const claimSchema = z.object({
  code: z.string().min(1).max(600),
  method: z.enum(["qr", "manual"]).default("qr"),
});

/** Stage 03: the POS presents a ticket. */
router.post("/pos-wins/claims", requireAuth, requireRole("writer"), async (req, res) => {
  const parsed = claimSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Scan a ticket QR code or enter a ticket number" });
    return;
  }
  const results = await submitClaim(req.user!.userId, parsed.data.code, parsed.data.method);
  res.json({ results });
});

/** The writer's own winning tickets and where each one has got to. */
router.get("/pos-wins/my-claims", requireAuth, requireRole("writer"), async (req, res) => {
  const writerId = req.user!.userId;

  const rows = await db
    .select({
      payoutId: payoutRequestsTable.id,
      status: payoutRequestsTable.status,
      amount: payoutRequestsTable.payoutAmount,
      claimedAt: payoutRequestsTable.claimedAt,
      paidAt: payoutRequestsTable.paidAt,
      rejectionReason: payoutRequestsTable.rejectionReason,
      resolutionNote: payoutRequestsTable.resolutionNote,
      payeeMomoNumber: payoutRequestsTable.payeeMomoNumber,
      ticketId: ticketsTable.id,
      ticketNumber: ticketsTable.ticketNumber,
      numbers: ticketsTable.numbers,
      gameName: gamesTable.name,
      eventNumber: gamesTable.eventNumber,
      gameCloseAt: gamesTable.closeAt,
    })
    .from(payoutRequestsTable)
    .innerJoin(ticketsTable, eq(ticketsTable.id, payoutRequestsTable.ticketId))
    .innerJoin(gamesTable, eq(gamesTable.id, ticketsTable.gameId))
    .where(eq(payoutRequestsTable.writerId, writerId))
    .orderBy(desc(payoutRequestsTable.createdAt))
    .limit(200);

  const [writer] = await db
    .select({
      momoNumber: writersTable.momoNumber,
      momoProvider: writersTable.momoProvider,
      momoAccountName: writersTable.momoAccountName,
    })
    .from(writersTable)
    .where(eq(writersTable.id, writerId))
    .limit(1);

  res.json({
    wallet: writer?.momoNumber
      ? {
          number: writer.momoNumber,
          provider: writer.momoProvider,
          providerLabel: isMomoProvider(writer.momoProvider) ? MOMO_PROVIDERS[writer.momoProvider].label : null,
          accountName: writer.momoAccountName,
        }
      : null,
    // A win nobody claimed inside its validity is no longer claimable, and
    // the screen must not go on inviting the writer to scan it.
    claims: rows.map((r) => {
      const validUntil = expiryDate(r.gameCloseAt, TICKET_VALIDITY_DAYS);
      validUntil.setUTCHours(23, 59, 59, 999);
      const unclaimed = r.status === "pending" || r.status === "approved";
      return { ...r, validUntil, expired: unclaimed && Date.now() > validUntil.getTime() };
    }),
  });
});

/* ═══════════════════════ Cashier: POS WINS PAYMENT ═══════════════════════ */

const QUEUE_STATUSES = ["verified", "awaiting_funds", "processing", "paid", "rejected", "withheld"] as const;

function queueColumns() {
  return {
    payoutId: payoutRequestsTable.id,
    status: payoutRequestsTable.status,
    amount: payoutRequestsTable.payoutAmount,
    claimedAt: payoutRequestsTable.claimedAt,
    claimMethod: payoutRequestsTable.claimMethod,
    payeeMomoNumber: payoutRequestsTable.payeeMomoNumber,
    payeeMomoProvider: payoutRequestsTable.payeeMomoProvider,
    payeeName: payoutRequestsTable.payeeName,
    reviewedAt: payoutRequestsTable.reviewedAt,
    reviewedByName: cashierUsers.fullName,
    rejectionReason: payoutRequestsTable.rejectionReason,
    flaggedAt: payoutRequestsTable.flaggedAt,
    resolutionNote: payoutRequestsTable.resolutionNote,
    resolvedAt: payoutRequestsTable.resolvedAt,
    transferReference: payoutRequestsTable.transferReference,
    transferStatus: payoutRequestsTable.transferStatus,
    transferError: payoutRequestsTable.transferError,
    transferAttempts: payoutRequestsTable.transferAttempts,
    paidAt: payoutRequestsTable.paidAt,
    writerUnsettledAmount: payoutRequestsTable.writerUnsettledAmount,
    ticketId: ticketsTable.id,
    ticketNumber: ticketsTable.ticketNumber,
    numbers: ticketsTable.numbers,
    stakeAmount: ticketsTable.stakeAmount,
    ticketStatus: ticketsTable.status,
    soldAt: ticketsTable.createdAt,
    betTypeId: ticketsTable.betTypeId,
    betTypeName: betTypesTable.name,
    gameId: ticketsTable.gameId,
    gameName: gamesTable.name,
    eventNumber: gamesTable.eventNumber,
    gameCloseAt: gamesTable.closeAt,
    winningNumbers: gameResultsTable.winningNumbers,
    drawProcessedAt: gameResultsTable.processedAt,
    writerId: writersTable.id,
    writerName: writersTable.fullName,
    writerCode: writersTable.fullCode,
    writerPhone: writersTable.phone,
    writerMomoUpdatedAt: writersTable.momoUpdatedAt,
    agentId: agentsTable.id,
    agentCode: agentsTable.fullCode,
    agencyName: agentsTable.agencyName,
  };
}

function queueQuery() {
  return db
    .select(queueColumns())
    .from(payoutRequestsTable)
    .innerJoin(ticketsTable, eq(ticketsTable.id, payoutRequestsTable.ticketId))
    .innerJoin(betTypesTable, eq(betTypesTable.id, ticketsTable.betTypeId))
    .innerJoin(gamesTable, eq(gamesTable.id, ticketsTable.gameId))
    .innerJoin(gameResultsTable, eq(gameResultsTable.id, payoutRequestsTable.gameResultId))
    .innerJoin(writersTable, eq(writersTable.id, payoutRequestsTable.writerId))
    .innerJoin(agentsTable, eq(agentsTable.id, payoutRequestsTable.agentId))
    .leftJoin(cashierUsers, eq(cashierUsers.id, payoutRequestsTable.reviewedBy));
}

type QueueRow = Awaited<ReturnType<ReturnType<typeof queueQuery>["execute"]>>[number];

/**
 * Everything a cashier should weigh before releasing money, as plain
 * sentences. The same fraud rules the lookup screen runs, plus the things
 * only a claim can tell you.
 */
async function withFlags(rows: QueueRow[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.ticketId);

  const events = await db
    .select({
      ticketId: ticketEventsTable.ticketId,
      eventType: ticketEventsTable.eventType,
      occurredAt: ticketEventsTable.occurredAt,
      actorRole: ticketEventsTable.actorRole,
      source: ticketEventsTable.source,
    })
    .from(ticketEventsTable)
    .where(inArray(ticketEventsTable.ticketId, ids));

  const tickets: AuditTicket[] = rows.map((r) => ({
    id: r.ticketId,
    ticketNumber: r.ticketNumber,
    writerId: r.writerId,
    gameId: r.gameId,
    betTypeId: r.betTypeId,
    numbers: r.numbers,
    stakeAmount: r.stakeAmount,
    status: r.ticketStatus,
    createdAt: r.soldAt,
    gameCloseAt: r.gameCloseAt,
    drawProcessedAt: r.drawProcessedAt,
  }));
  const anomalies = detectTicketAnomalies(tickets, events as AuditEvent[]);
  const byTicket = new Map<string, string[]>();
  for (const a of anomalies) {
    const list = byTicket.get(a.ticketId) ?? [];
    list.push(a.detail);
    byTicket.set(a.ticketId, list);
  }

  return rows.map((r) => {
    const flags = [...(byTicket.get(r.ticketId) ?? [])];
    if (r.claimMethod === "manual") {
      flags.push("Ticket number was typed in, not scanned from the printed QR.");
    }
    const owed = Number(r.writerUnsettledAmount ?? 0);
    if (owed > 0) {
      flags.push(`Writer had not settled GHS ${owed.toFixed(2)} of postpaid sales when this draw was run.`);
    }
    if (r.writerMomoUpdatedAt && r.claimedAt) {
      const hours = (r.claimedAt.getTime() - r.writerMomoUpdatedAt.getTime()) / 3_600_000;
      if (hours >= 0 && hours < 24) {
        flags.push("The payout wallet was changed less than 24 hours before this claim.");
      }
    }
    if (r.resolvedAt) {
      flags.push(`Previously rejected; cleared by an administrator${r.resolutionNote ? `: ${r.resolutionNote}` : "."}`);
    }
    return { ...r, flags };
  });
}

/** The queue, and the figures above it. Read by the cashier; visible to audit. */
router.get(
  "/pos-wins/queue",
  requireAuth,
  requireRole("cashier", "administrator", "director"),
  async (req, res) => {
    const requested = typeof req.query["status"] === "string" ? req.query["status"] : "verified";
    if (!(QUEUE_STATUSES as readonly string[]).includes(requested)) {
      res.status(400).json({ error: "Unknown status" });
      return;
    }
    const status = requested as (typeof QUEUE_STATUSES)[number];

    const rows = await queueQuery()
      .where(eq(payoutRequestsTable.status, status))
      .orderBy(status === "paid" ? desc(payoutRequestsTable.paidAt) : payoutRequestsTable.claimedAt)
      .limit(300);

    const counts = await db
      .select({
        status: payoutRequestsTable.status,
        n: sql<number>`count(*)::int`,
        total: sql<string>`coalesce(sum(${payoutRequestsTable.payoutAmount}), 0)::text`,
      })
      .from(payoutRequestsTable)
      .where(inArray(payoutRequestsTable.status, [...QUEUE_STATUSES]))
      .groupBy(payoutRequestsTable.status);

    const wallet = await readWallet(db);

    res.json({
      status,
      requests: await withFlags(rows),
      counts: Object.fromEntries(counts.map((c) => [c.status, { count: c.n, total: c.total }])),
      // A cashier sees what the wallet can still cover, not how to change it.
      walletAvailable: wallet.available,
      walletHeld: wallet.held,
      paystackReady: paystackConfigured(),
    });
  },
);

/** Stage 05: approve. Sends the transfer. Cashier only. */
router.post("/pos-wins/:id/approve", requireAuth, requireRole("cashier"), async (req, res) => {
  const id = req.params["id"] as string;
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Invalid request id" });
    return;
  }
  const result = await approveAndDisburse(id, { userId: req.user!.userId });
  res.status(result.httpStatus).json(result.ok ? result : { error: result.message, state: result.state });
});

/** Ask Paystack what became of a transfer in flight. */
router.post("/pos-wins/:id/check", requireAuth, requireRole("cashier"), async (req, res) => {
  const id = req.params["id"] as string;
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Invalid request id" });
    return;
  }
  const result = await reconcileTransfer(id);
  res.status(result.httpStatus).json(result.ok || result.state ? result : { error: result.message });
});

const reasonSchema = z.object({ reason: z.string().trim().min(5).max(500) });

/**
 * Stage 05, the other branch: reject. The hold is released, the ticket is
 * flagged, and the administrators are told.
 */
router.post("/pos-wins/:id/reject", requireAuth, requireRole("cashier"), async (req, res) => {
  const id = req.params["id"] as string;
  const parsed = reasonSchema.safeParse(req.body);
  if (!UUID.test(id) || !parsed.success) {
    res.status(400).json({ error: "Give a reason of at least five characters" });
    return;
  }

  const rejected = await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ status: payoutRequestsTable.status })
      .from(payoutRequestsTable)
      .where(eq(payoutRequestsTable.id, id))
      .for("update")
      .limit(1);
    if (!before || (before.status !== "verified" && before.status !== "awaiting_funds")) return null;

    const [row] = await tx
      .update(payoutRequestsTable)
      .set({
        status: "rejected",
        reviewedBy: req.user!.userId,
        reviewedAt: new Date(),
        rejectionReason: parsed.data.reason,
        flaggedAt: new Date(),
        resolvedBy: null,
        resolvedAt: null,
        resolutionNote: null,
      })
      .where(eq(payoutRequestsTable.id, id))
      .returning();
    if (!row) return null;

    // Only a verified claim was holding money.
    if (before.status === "verified") {
      await releaseHold(tx, {
        payoutRequestId: id,
        amount: Number(row.payoutAmount).toFixed(2),
        actor: { userId: req.user!.userId, role: req.user!.role },
        note: `Rejected: ${parsed.data.reason}`.slice(0, 300),
      });
    }

    await recordTicketEvent(tx, {
      ticketId: row.ticketId,
      eventType: "claim_rejected",
      actorUserId: req.user!.userId,
      actorRole: req.user!.role,
      source: "admin",
      note: parsed.data.reason,
    });
    return row;
  });

  if (!rejected) {
    res.status(409).json({ error: "This request is no longer waiting for a decision." });
    return;
  }

  await alertStaff(
    "POS win rejected by cashier",
    `A cashier rejected a payout of GHS ${Number(rejected.payoutAmount).toFixed(2)}: "${parsed.data.reason}". ` +
      `It is waiting in Ticket Lookup → Flagged for an administrator to resolve or withhold.`,
    ["administrator"],
  );

  res.json({ ok: true, status: "rejected" });
});

/** A cashier's own disbursements; audit roles see everyone's. */
router.get(
  "/pos-wins/ledger",
  requireAuth,
  requireRole("cashier", "administrator", "director"),
  async (req, res) => {
    const mine = req.user!.role === "cashier";
    const rows = await queueQuery()
      .where(
        mine
          ? and(eq(payoutRequestsTable.status, "paid"), eq(payoutRequestsTable.reviewedBy, req.user!.userId))
          : eq(payoutRequestsTable.status, "paid"),
      )
      .orderBy(desc(payoutRequestsTable.paidAt))
      .limit(500);

    const total = rows.reduce((sum, r) => sum + Number(r.amount), 0);
    res.json({ scope: mine ? "mine" : "all", count: rows.length, total: total.toFixed(2), entries: rows });
  },
);

/* ══════════════════ Administrator: the flagged queue ═════════════════════ */

router.get(
  "/pos-wins/flagged",
  requireAuth,
  requireRole("administrator", "director"),
  async (_req, res) => {
    const rows = await queueQuery()
      .where(eq(payoutRequestsTable.status, "rejected"))
      .orderBy(payoutRequestsTable.flaggedAt)
      .limit(300);
    res.json({ requests: await withFlags(rows) });
  },
);

const noteSchema = z.object({ note: z.string().trim().min(5).max(500) });

/**
 * Cleared: back to the cashier. The payout has to be held again - it was
 * released when the cashier rejected it - so this can land in
 * `awaiting_funds` if the wallet has been drawn down in the meantime.
 *
 * It goes back to the cashier, not past them. Resolving a flag is the
 * administrator saying "this is fine to look at again", not "pay it".
 */
router.post("/pos-wins/:id/resolve", requireAuth, requireRole("administrator"), async (req, res) => {
  const id = req.params["id"] as string;
  const parsed = noteSchema.safeParse(req.body);
  if (!UUID.test(id) || !parsed.success) {
    res.status(400).json({ error: "Say what was checked, in at least five characters" });
    return;
  }

  const outcome = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(payoutRequestsTable)
      .set({
        status: "verified",
        resolvedBy: req.user!.userId,
        resolvedAt: new Date(),
        resolutionNote: parsed.data.note,
      })
      .where(and(eq(payoutRequestsTable.id, id), eq(payoutRequestsTable.status, "rejected")))
      .returning();
    if (!row) return null;

    const held = await holdForPayout(tx, {
      payoutRequestId: id,
      amount: Number(row.payoutAmount).toFixed(2),
      actor: { userId: req.user!.userId, role: req.user!.role },
      note: "Re-allocated after administrator review",
    });
    if (!held) {
      await tx.update(payoutRequestsTable).set({ status: "awaiting_funds" }).where(eq(payoutRequestsTable.id, id));
    }

    await recordTicketEvent(tx, {
      ticketId: row.ticketId,
      eventType: "claim_resolved",
      actorUserId: req.user!.userId,
      actorRole: req.user!.role,
      source: "admin",
      note: parsed.data.note,
    });
    return held ? "verified" : "awaiting_funds";
  });

  if (!outcome) {
    res.status(409).json({ error: "This request is not flagged." });
    return;
  }
  res.json({ ok: true, status: outcome });
});

/** Dropped: the payout is cancelled and the writer is told why. Final. */
router.post("/pos-wins/:id/withhold", requireAuth, requireRole("administrator"), async (req, res) => {
  const id = req.params["id"] as string;
  const parsed = reasonSchema.safeParse(req.body);
  if (!UUID.test(id) || !parsed.success) {
    res.status(400).json({ error: "Give the reason the writer will be sent, in at least five characters" });
    return;
  }

  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(payoutRequestsTable)
      .set({
        status: "withheld",
        resolvedBy: req.user!.userId,
        resolvedAt: new Date(),
        resolutionNote: parsed.data.reason,
      })
      .where(and(eq(payoutRequestsTable.id, id), eq(payoutRequestsTable.status, "rejected")))
      .returning();
    if (!updated) return null;
    // Nothing to release: the hold went back when the cashier rejected it.
    await recordTicketEvent(tx, {
      ticketId: updated.ticketId,
      eventType: "claim_withheld",
      actorUserId: req.user!.userId,
      actorRole: req.user!.role,
      source: "admin",
      note: parsed.data.reason,
    });
    return updated;
  });

  if (!row) {
    res.status(409).json({ error: "This request is not flagged." });
    return;
  }

  // The writer hears the reason from the company rather than finding out by
  // the money not arriving.
  let texted = false;
  try {
    const [info] = await db
      .select({ phone: writersTable.phone, ticketNumber: ticketsTable.ticketNumber })
      .from(writersTable)
      .innerJoin(ticketsTable, eq(ticketsTable.id, row.ticketId))
      .where(eq(writersTable.id, row.writerId))
      .limit(1);
    if (info?.phone) {
      const sent = await sms.send(
        info.phone,
        `VS2000: Payment on ticket ${info.ticketNumber} has been withheld. Reason: ${parsed.data.reason}. Contact your agent if you believe this is wrong.`,
      );
      texted = sent.success;
    }
  } catch (err) {
    logger.error({ err, payoutId: id }, "[POS WINS] withheld, but the writer could not be texted");
  }

  res.json({ ok: true, status: "withheld", writerNotified: texted });
});

/** Refused claim attempts, per writer - where forged and foreign tickets show up. */
router.get(
  "/pos-wins/claim-attempts",
  requireAuth,
  requireRole("administrator", "director"),
  async (req, res) => {
    const days = Math.min(Math.max(Number(req.query["days"]) || 7, 1), 90);
    const since = new Date(Date.now() - days * 86_400_000);

    const byWriter = await db
      .select({
        writerId: writersTable.id,
        writerCode: writersTable.fullCode,
        writerName: writersTable.fullName,
        agentCode: agentsTable.fullCode,
        refused: sql<number>`count(*) filter (where ${payoutClaimAttemptsTable.outcome} not like 'accepted%')::int`,
        notOurs: sql<number>`count(*) filter (where ${payoutClaimAttemptsTable.outcome} in ('not_found', 'forged'))::int`,
        notTheirs: sql<number>`count(*) filter (where ${payoutClaimAttemptsTable.outcome} = 'not_owner')::int`,
        repeats: sql<number>`count(*) filter (where ${payoutClaimAttemptsTable.outcome} in ('already_claimed', 'already_paid'))::int`,
        losers: sql<number>`count(*) filter (where ${payoutClaimAttemptsTable.outcome} in ('not_winner', 'expired', 'voided'))::int`,
        lastAt: sql<Date>`max(${payoutClaimAttemptsTable.createdAt})`,
      })
      .from(payoutClaimAttemptsTable)
      .innerJoin(writersTable, eq(writersTable.id, payoutClaimAttemptsTable.writerId))
      .innerJoin(agentsTable, eq(agentsTable.id, writersTable.agentId))
      .where(gte(payoutClaimAttemptsTable.createdAt, since))
      .groupBy(writersTable.id, writersTable.fullCode, writersTable.fullName, agentsTable.fullCode)
      .having(sql`count(*) filter (where ${payoutClaimAttemptsTable.outcome} not like 'accepted%') > 0`)
      .orderBy(sql`count(*) filter (where ${payoutClaimAttemptsTable.outcome} in ('not_found', 'forged', 'not_owner')) desc`);

    const recent = await db
      .select({
        id: payoutClaimAttemptsTable.id,
        createdAt: payoutClaimAttemptsTable.createdAt,
        outcome: payoutClaimAttemptsTable.outcome,
        method: payoutClaimAttemptsTable.method,
        presented: payoutClaimAttemptsTable.presented,
        detail: payoutClaimAttemptsTable.detail,
        writerCode: writersTable.fullCode,
        writerName: writersTable.fullName,
      })
      .from(payoutClaimAttemptsTable)
      .innerJoin(writersTable, eq(writersTable.id, payoutClaimAttemptsTable.writerId))
      .where(
        and(
          gte(payoutClaimAttemptsTable.createdAt, since),
          sql`${payoutClaimAttemptsTable.outcome} not like 'accepted%'`,
        ),
      )
      .orderBy(desc(payoutClaimAttemptsTable.createdAt))
      .limit(100);

    res.json({ days, byWriter, recent });
  },
);

/* ═════════════════════════════ Master Wallet ═════════════════════════════ */

/** Balances and totals. Director and administrator; the administrator only ever reads. */
router.get(
  "/master-wallet",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const wallet = await readWallet(db);

    const totals = await db
      .select({
        entryType: masterWalletLedgerTable.entryType,
        total: sql<string>`coalesce(sum(${masterWalletLedgerTable.amount}), 0)::text`,
        n: sql<number>`count(*)::int`,
      })
      .from(masterWalletLedgerTable)
      .groupBy(masterWalletLedgerTable.entryType);
    const byType = Object.fromEntries(totals.map((t) => [t.entryType, { total: t.total, count: t.n }]));

    const [waiting] = await db
      .select({
        n: sql<number>`count(*)::int`,
        total: sql<string>`coalesce(sum(${payoutRequestsTable.payoutAmount}), 0)::text`,
      })
      .from(payoutRequestsTable)
      .where(eq(payoutRequestsTable.status, "awaiting_funds"));

    // What Paystack is really holding. The wallet is our record of what has
    // been committed; this is the cash. They should move together.
    const paystackBalance = paystackConfigured() ? await paystackGhsBalance() : null;

    // The ledger must add up to the wallet. If it ever does not, somebody
    // should know before reconciliation rather than during it.
    const funded = Number(byType["fund"]?.total ?? 0);
    const disbursed = Number(byType["disburse"]?.total ?? 0);
    const withdrawn = Number(byType["withdraw"]?.total ?? 0);
    const ledgerSaysTotal = funded - withdrawn - disbursed;
    const walletSaysTotal = Number(wallet.available) + Number(wallet.held);

    res.json({
      available: wallet.available,
      held: wallet.held,
      total: walletSaysTotal.toFixed(2),
      totalFunded: funded.toFixed(2),
      totalDisbursed: disbursed.toFixed(2),
      totalWithdrawn: withdrawn.toFixed(2),
      awaitingFunds: { count: waiting?.n ?? 0, total: waiting?.total ?? "0" },
      paystackBalance,
      paystackConfigured: paystackConfigured(),
      ledgerBalanced: Math.abs(ledgerSaysTotal - walletSaysTotal) < 0.005,
      canFund: req.user!.role === "director",
    });
  },
);

const fundSchema = z.object({
  amount: z.union([z.string(), z.number()]),
  reference: z.string().trim().min(3).max(120),
  note: z.string().trim().max(300).optional(),
});

/**
 * Add money. Director only - and only the Director: the administrator who
 * decides which tickets won must not also be able to supply the money that
 * pays them.
 */
router.post("/master-wallet/fund", requireAuth, requireRole("director"), async (req, res) => {
  const parsed = fundSchema.safeParse(req.body);
  const amount = parsed.success ? parseAmount(parsed.data.amount) : null;
  if (!parsed.success || !amount) {
    res.status(400).json({ error: "Enter an amount above zero and the bank or transfer reference for it" });
    return;
  }

  // The wallet records money that is in Paystack; it cannot be the source of
  // it. A top-up is accepted only when Paystack is already holding enough to
  // cover everything the wallet would then claim - available and held
  // together. This is what stops a figure typed into the screen from becoming
  // "money" a cashier is shown as able to pay out.
  const live = await livePaystackBalance();
  if (live === null) {
    res.status(503).json({ error: "Paystack's balance could not be checked, so the top-up was not recorded. Try again once Paystack is reachable." });
    return;
  }
  const current = await readWallet(db);
  const wouldClaim = Number(current.available) + Number(current.held) + Number(amount);
  if (wouldClaim > live + 0.005) {
    res.status(409).json({
      error: `Paystack is holding GH₵${live.toFixed(2)}. With this top-up the wallet would claim GH₵${wouldClaim.toFixed(2)}. Deposit the money into Paystack first, then record it here.`,
      paystackBalance: live.toFixed(2),
      walletWouldClaim: wouldClaim.toFixed(2),
    });
    return;
  }

  const actor = { userId: req.user!.userId, role: req.user!.role };
  const result = await db.transaction(async (tx) => {
    const after = await fundWallet(tx, {
      amount,
      actor,
      reference: parsed.data.reference,
      note: parsed.data.note ?? null,
    });
    const promoted = await promoteAwaitingFunds(tx, actor);
    return { after: promoted > 0 ? await readWallet(tx) : after, promoted };
  });

  res.json({ ok: true, available: result.after.available, held: result.after.held, claimsReleased: result.promoted });
});

const withdrawSchema = z.object({
  amount: z.union([z.string(), z.number()]),
  reason: z.string().trim().min(5).max(300),
  reference: z.string().trim().max(120).optional(),
});

/**
 * Take unpromised money back out. Director only.
 *
 * This is the correction for a mistaken top-up as much as it is a withdrawal:
 * the ledger cannot be edited, so an error is undone by an entry that says so.
 * A reason is required for exactly that - the row has to explain itself.
 */
router.post("/master-wallet/withdraw", requireAuth, requireRole("director"), async (req, res) => {
  const parsed = withdrawSchema.safeParse(req.body);
  const amount = parsed.success ? parseAmount(parsed.data.amount) : null;
  if (!parsed.success || !amount) {
    res.status(400).json({ error: "Enter an amount above zero and the reason for taking it out" });
    return;
  }
  const after = await db.transaction((tx) =>
    withdrawFromWallet(tx, {
      amount,
      actor: { userId: req.user!.userId, role: req.user!.role },
      reference: parsed.data.reference || null,
      note: parsed.data.reason,
    }),
  );
  if (!after) {
    res.status(409).json({ error: "That is more than the wallet has available. Money held for claims cannot be withdrawn." });
    return;
  }
  res.json({ ok: true, available: after.available, held: after.held });
});

/** The ledger itself. */
router.get(
  "/master-wallet/ledger",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const type = typeof req.query["type"] === "string" ? req.query["type"] : "";
    const dateFrom = typeof req.query["dateFrom"] === "string" ? req.query["dateFrom"] : "";
    const dateTo = typeof req.query["dateTo"] === "string" ? req.query["dateTo"] : "";
    const limit = Math.min(Math.max(Number(req.query["limit"]) || 200, 1), 1000);

    const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
    const conditions = [
      ["fund", "withdraw", "hold", "release", "disburse"].includes(type) ? eq(masterWalletLedgerTable.entryType, type) : undefined,
      isDate(dateFrom) ? gte(masterWalletLedgerTable.createdAt, new Date(`${dateFrom}T00:00:00Z`)) : undefined,
      isDate(dateTo) ? lte(masterWalletLedgerTable.createdAt, new Date(`${dateTo}T23:59:59.999Z`)) : undefined,
    ].filter(Boolean);

    const rows = await db
      .select({
        id: masterWalletLedgerTable.id,
        entryType: masterWalletLedgerTable.entryType,
        amount: masterWalletLedgerTable.amount,
        availableAfter: masterWalletLedgerTable.availableAfter,
        heldAfter: masterWalletLedgerTable.heldAfter,
        reference: masterWalletLedgerTable.reference,
        note: masterWalletLedgerTable.note,
        actorName: usersTable.fullName,
        actorRole: masterWalletLedgerTable.actorRole,
        createdAt: masterWalletLedgerTable.createdAt,
        ticketNumber: ticketsTable.ticketNumber,
        writerCode: writersTable.fullCode,
      })
      .from(masterWalletLedgerTable)
      .leftJoin(usersTable, eq(usersTable.id, masterWalletLedgerTable.actorUserId))
      .leftJoin(payoutRequestsTable, eq(payoutRequestsTable.id, masterWalletLedgerTable.payoutRequestId))
      .leftJoin(ticketsTable, eq(ticketsTable.id, payoutRequestsTable.ticketId))
      .leftJoin(writersTable, eq(writersTable.id, payoutRequestsTable.writerId))
      .where(conditions.length ? and(...(conditions as never[])) : undefined)
      .orderBy(desc(masterWalletLedgerTable.createdAt))
      .limit(limit);

    res.json({ entries: rows });
  },
);

/* ═══════════════════════ The writer's payout wallet ══════════════════════ */

/** May this user see or change this writer's wallet? Agents only their own writers'. */
async function writerInScope(role: string, userId: string, writerId: string): Promise<boolean> {
  if (role === "administrator" || role === "director" || role === "cashier") return true;
  if (role !== "agent") return false;
  const [row] = await db
    .select({ id: writersTable.id })
    .from(writersTable)
    .innerJoin(agentsTable, eq(agentsTable.id, writersTable.agentId))
    .where(and(eq(writersTable.id, writerId), eq(agentsTable.userId, userId)))
    .limit(1);
  return !!row;
}

router.get(
  "/writers/:id/momo",
  requireAuth,
  requireRole("director", "administrator", "cashier", "agent"),
  async (req, res) => {
    const id = req.params["id"] as string;
    if (!UUID.test(id) || !(await writerInScope(req.user!.role, req.user!.userId, id))) {
      res.status(404).json({ error: "Writer not found" });
      return;
    }
    const [w] = await db
      .select({
        momoNumber: writersTable.momoNumber,
        momoProvider: writersTable.momoProvider,
        momoAccountName: writersTable.momoAccountName,
        momoUpdatedAt: writersTable.momoUpdatedAt,
        updatedByName: usersTable.fullName,
      })
      .from(writersTable)
      .leftJoin(usersTable, eq(usersTable.id, writersTable.momoUpdatedBy))
      .where(eq(writersTable.id, id))
      .limit(1);
    if (!w) {
      res.status(404).json({ error: "Writer not found" });
      return;
    }
    res.json({
      ...w,
      providers: Object.entries(MOMO_PROVIDERS).map(([value, p]) => ({ value, label: p.label })),
      // The cashier releases the money, so the cashier does not get to say
      // where it goes. Nor does the director, who supplies it.
      canEdit: req.user!.role === "administrator" || req.user!.role === "agent",
    });
  },
);

const momoSchema = z.object({ number: z.string(), provider: z.string() });

router.put(
  "/writers/:id/momo",
  requireAuth,
  requireRole("administrator", "agent"),
  async (req, res) => {
    const id = req.params["id"] as string;
    if (!UUID.test(id) || !(await writerInScope(req.user!.role, req.user!.userId, id))) {
      res.status(404).json({ error: "Writer not found" });
      return;
    }
    const parsed = momoSchema.safeParse(req.body);
    const number = parsed.success ? normaliseMomoNumber(parsed.data.number) : null;
    if (!parsed.success || !number || !isMomoProvider(parsed.data.provider)) {
      res.status(400).json({ error: "Enter a 10-digit mobile money number and choose its network" });
      return;
    }
    if (!isGhanaMobile(number)) {
      res.status(400).json({ error: `${number} is not a Ghana mobile number, so it cannot be a MoMo wallet` });
      return;
    }
    const provider = parsed.data.provider;

    // Who the network says owns it. Shown to the cashier beside every payout
    // to this wallet; absent when Paystack is not set up or cannot say.
    const accountName = paystackConfigured() ? await resolveMomoName(number, provider) : null;

    const [updated] = await db
      .update(writersTable)
      .set({
        momoNumber: number,
        momoProvider: provider,
        momoAccountName: accountName,
        // A recipient code belongs to one number on one network.
        paystackRecipientCode: null,
        momoUpdatedAt: new Date(),
        momoUpdatedBy: req.user!.userId,
      })
      .where(eq(writersTable.id, id))
      .returning({ id: writersTable.id });
    if (!updated) {
      res.status(404).json({ error: "Writer not found" });
      return;
    }
    res.json({ ok: true, momoNumber: number, momoProvider: provider, momoAccountName: accountName });
  },
);

/* ══════════════════════════ Finance & Reports ════════════════════════════ */

/**
 * POS wins over a period: what was claimed, what was paid, what is stuck.
 *
 * Portal tickets only, by construction - a payout request exists only for a
 * ticket sold through a writer's POS. Wins an agent typed in by hand live in
 * wins_entries and never reach this pipeline, which is the separation this
 * report is here to show: these figures are the ones a machine verified.
 */
router.get(
  "/reports/pos-wins",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (req, res) => {
    const dateFrom = typeof req.query["dateFrom"] === "string" ? req.query["dateFrom"] : "";
    const dateTo = typeof req.query["dateTo"] === "string" ? req.query["dateTo"] : "";
    const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
    if ((dateFrom && !isDate(dateFrom)) || (dateTo && !isDate(dateTo))) {
      res.status(400).json({ error: "Dates must be YYYY-MM-DD" });
      return;
    }
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00Z`) : null;
    const to = dateTo ? new Date(`${dateTo}T23:59:59.999Z`) : null;

    // Paid in the period.
    const paidConditions = [
      eq(payoutRequestsTable.status, "paid"),
      sql`${payoutRequestsTable.transferReference} is not null`,
      from ? gte(payoutRequestsTable.paidAt, from) : undefined,
      to ? lte(payoutRequestsTable.paidAt, to) : undefined,
    ].filter(Boolean);

    const disbursements = await db
      .select({
        payoutId: payoutRequestsTable.id,
        paidAt: payoutRequestsTable.paidAt,
        amount: payoutRequestsTable.payoutAmount,
        transferReference: payoutRequestsTable.transferReference,
        payeeMomoNumber: payoutRequestsTable.payeeMomoNumber,
        ticketNumber: ticketsTable.ticketNumber,
        gameName: gamesTable.name,
        eventNumber: gamesTable.eventNumber,
        writerCode: writersTable.fullCode,
        writerName: writersTable.fullName,
        agentId: agentsTable.id,
        agentCode: agentsTable.fullCode,
        agencyName: agentsTable.agencyName,
        cashierName: cashierUsers.fullName,
      })
      .from(payoutRequestsTable)
      .innerJoin(ticketsTable, eq(ticketsTable.id, payoutRequestsTable.ticketId))
      .innerJoin(gamesTable, eq(gamesTable.id, ticketsTable.gameId))
      .innerJoin(writersTable, eq(writersTable.id, payoutRequestsTable.writerId))
      .innerJoin(agentsTable, eq(agentsTable.id, payoutRequestsTable.agentId))
      .leftJoin(cashierUsers, eq(cashierUsers.id, payoutRequestsTable.reviewedBy))
      .where(and(...(paidConditions as never[])))
      .orderBy(desc(payoutRequestsTable.paidAt))
      .limit(2000);

    const byAgency = new Map<string, { agentCode: string; agencyName: string | null; count: number; total: number }>();
    const byCashier = new Map<string, { cashierName: string; count: number; total: number }>();
    let paidTotal = 0;
    for (const d of disbursements) {
      const amount = Number(d.amount);
      paidTotal += amount;
      const a = byAgency.get(d.agentId) ?? { agentCode: d.agentCode, agencyName: d.agencyName, count: 0, total: 0 };
      a.count += 1;
      a.total += amount;
      byAgency.set(d.agentId, a);
      const name = d.cashierName ?? "—";
      const c = byCashier.get(name) ?? { cashierName: name, count: 0, total: 0 };
      c.count += 1;
      c.total += amount;
      byCashier.set(name, c);
    }

    // Where everything else stands right now - not period-bound, because a
    // claim stuck since last week is still today's problem.
    const pipeline = await db
      .select({
        status: payoutRequestsTable.status,
        n: sql<number>`count(*)::int`,
        total: sql<string>`coalesce(sum(${payoutRequestsTable.payoutAmount}), 0)::text`,
      })
      .from(payoutRequestsTable)
      .groupBy(payoutRequestsTable.status);

    const wallet = await readWallet(db);

    res.json({
      period: { dateFrom: dateFrom || null, dateTo: dateTo || null },
      paid: { count: disbursements.length, total: paidTotal.toFixed(2) },
      byAgency: [...byAgency.values()]
        .sort((x, y) => y.total - x.total)
        .map((a) => ({ ...a, total: a.total.toFixed(2) })),
      byCashier: [...byCashier.values()]
        .sort((x, y) => y.total - x.total)
        .map((c) => ({ ...c, total: c.total.toFixed(2) })),
      pipeline: Object.fromEntries(pipeline.map((p) => [p.status, { count: p.n, total: p.total }])),
      wallet,
      disbursements,
    });
  },
);

export default router;
