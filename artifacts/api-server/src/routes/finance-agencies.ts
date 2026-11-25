import { Router } from "express";
import { db, agencyOpeningBalancesTable, agentCommissionPayoutsTable, agentsTable, usersTable, finMoneyAccountsTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middleware/auth";
import { syncBooks, audit } from "../lib/finance/books";
import {
  derivedAgencyBalances, refreshAgencyBalances, agencyStatement, commissionWeeks, commissionWallet, commissionWallets,
} from "../lib/finance/agencies";
import { dispatchSystemNotification } from "../lib/notify";
import { logger } from "../lib/logger";

/**
 * Agencies: opening balances carried over from manual operation, the
 * agency's account statement, and agent commission - earned, requested,
 * approved, paid.
 */

const router = Router();
const MGMT = ["director", "administrator"] as const;
const actorOf = (req: { user?: { userId: string; role: string } }) => ({ actorUserId: req.user?.userId ?? null, actorRole: req.user?.role ?? null });
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

async function notify(userIds: string[], sentBy: string, title: string, body: string, targetId?: string) {
  if (!userIds.length) return;
  try {
    await dispatchSystemNotification({ sentBy, messageType: "alert", title, body, targetType: "agent", targetId, recipientUserIds: userIds });
  } catch (err) {
    logger.warn({ err, title }, "[FINANCE] notification failed");
  }
}
async function usersWithRoles(roles: string[]) {
  const rows = await db.select({ id: usersTable.id }).from(usersTable).where(inArray(usersTable.role, roles as never[]));
  return rows.map((r) => r.id);
}

/* ── Agency balances ──────────────────────────────────────────────────────── */

router.get("/finance/agencies", requireAuth, requireRole(...MGMT), async (_req, res) => {
  await syncBooks();
  const [agents, derived, openings, weeks, payouts, history] = await Promise.all([
    db.execute(sql`
      SELECT a.id, a.full_code, a.agency_name, a.outstanding_debt, a.status, u.full_name AS agent_name,
             (SELECT min(debt_before) FILTER (WHERE true) FROM (SELECT debt_before FROM agent_debt_reductions r WHERE r.agent_id = a.id ORDER BY r.created_at LIMIT 1) f) AS first_recorded
        FROM agents a JOIN users u ON u.id = a.user_id ORDER BY a.full_code`),
    derivedAgencyBalances(),
    db.execute(sql`
      SELECT o.*, pu.full_name AS proposed_by_name, du.full_name AS decided_by_name
        FROM agency_opening_balances o
        JOIN users pu ON pu.id = o.proposed_by LEFT JOIN users du ON du.id = o.decided_by
       WHERE o.status IN ('proposed', 'approved')`),
    commissionWeeks(),
    db.execute(sql`SELECT agent_id, status, sum(amount) AS amount FROM agent_commission_payouts GROUP BY 1, 2`),
    // What the ledger would say with no opening at all - from the first draw.
    db.execute(sql`
      SELECT a.id AS agent_id,
             coalesce((SELECT sum(c.writer_balance) FROM daily_calculations c JOIN writers w ON w.id = c.writer_id WHERE w.agent_id = a.id), 0) AS draws_net,
             coalesce((SELECT sum(CASE WHEN p.transaction_type = 'pay_in' THEN p.amount ELSE -p.amount END) FROM payments p
                        WHERE p.agent_id = a.id AND p.status = 'completed' AND NOT p.is_voided), 0) AS payments_net
        FROM agents a`),
  ]);
  const dmap = new Map(derived.map((d) => [d.agentId, d]));
  const omap = new Map<string, { approved?: Record<string, unknown>; proposed?: Record<string, unknown> }>();
  for (const o of openings.rows as Array<Record<string, unknown>>) {
    const k = String(o.agent_id);
    const e = omap.get(k) ?? {};
    if (o.status === "approved") e.approved = o; else e.proposed = o;
    omap.set(k, e);
  }
  const hmap = new Map((history.rows as Array<Record<string, unknown>>).map((h) => [String(h.agent_id), Math.round((Number(h.payments_net) - Number(h.draws_net)) * 100) / 100]));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Accra" }).format(new Date());
  const rows = (agents.rows as Array<Record<string, unknown>>).map((a) => {
    const id = String(a.id);
    const w = weeks.filter((x) => x.agentId === id);
    const p = (payouts.rows as Array<Record<string, unknown>>).filter((x) => x.agent_id === id);
    const paid = p.filter((x) => x.status === "paid").reduce((s, x) => s + Number(x.amount), 0);
    const pending = p.filter((x) => x.status === "requested" || x.status === "approved").reduce((s, x) => s + Number(x.amount), 0);
    const earnedClosed = w.filter((x) => x.weekEnd < today).reduce((s, x) => s + x.commission, 0);
    return {
      id, code: a.full_code, agencyName: a.agency_name, agentName: a.agent_name, status: a.status,
      stored: Number(a.outstanding_debt),
      firstRecorded: a.first_recorded === null ? null : Number(a.first_recorded),
      ledgerFromInception: hmap.get(id) ?? 0,
      derived: dmap.get(id) ?? null,
      approvedOpening: omap.get(id)?.approved ?? null,
      proposedOpening: omap.get(id)?.proposed ?? null,
      commission: {
        earned: Math.round(w.reduce((s, x) => s + x.commission, 0) * 100) / 100,
        earnedClosed: Math.round(earnedClosed * 100) / 100,
        paid, pending,
        available: Math.round((earnedClosed - paid - pending) * 100) / 100,
      },
    };
  });
  res.json(rows);
});

router.get("/finance/agencies/:id/statement", requireAuth, requireRole(...MGMT, "agent"), async (req, res) => {
  const id = String(req.params["id"]);
  if (req.user!.role === "agent") {
    const [mine] = await db.select({ id: agentsTable.id }).from(agentsTable).where(eq(agentsTable.userId, req.user!.userId)).limit(1);
    if (!mine || mine.id !== id) {
      res.status(403).json({ error: "You can see your own agency's statement only" });
      return;
    }
  }
  const q = req.query as Record<string, string>;
  const to = isDate(q["to"]) ? q["to"] : new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Accra" }).format(new Date());
  const from = isDate(q["from"]) ? q["from"] : `${to.slice(0, 8)}01`;
  res.json(await agencyStatement(id, from, to));
});

const openingSchema = z.object({
  amount: z.union([z.string(), z.number()]).transform((v) => String(v).trim())
    .refine((v) => /^\d{1,11}(\.\d{1,2})?$/.test(v), "Enter the amount to the pesewa, without a sign - the direction says which way"),
  direction: z.enum(["agency_owes", "company_owes"]),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  basis: z.string().trim().min(10, "Say what the figure rests on: the ledger, statement or agreement it comes from").max(1000),
});

/**
 * Propose an agency's opening balance. Nothing changes until someone else
 * approves it. A new proposal replaces a waiting one; an approved balance is
 * replaced only by approving a new proposal.
 */
router.post("/finance/agencies/:id/opening", requireAuth, requireRole(...MGMT), async (req, res) => {
  const p = openingSchema.safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: p.error.issues[0]?.message ?? "Check the figures" });
    return;
  }
  const agentId = String(req.params["id"]);
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId)).limit(1);
  if (!agent) {
    res.status(404).json({ error: "No such agency" });
    return;
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Accra" }).format(new Date());
  if (p.data.asOf > today) {
    res.status(400).json({ error: "The opening balance must be as at a date that has passed" });
    return;
  }
  const row = await db.transaction(async (tx) => {
    await tx.update(agencyOpeningBalancesTable).set({ status: "superseded", decidedAt: new Date(), decisionNote: "Replaced by a newer proposal" })
      .where(and(eq(agencyOpeningBalancesTable.agentId, agentId), eq(agencyOpeningBalancesTable.status, "proposed")));
    const [r] = await tx.insert(agencyOpeningBalancesTable).values({
      agentId, amount: Number(p.data.amount).toFixed(2), direction: p.data.direction, asOf: p.data.asOf, basis: p.data.basis,
      proposedBy: req.user!.userId, storedBefore: agent.outstandingDebt,
    }).returning();
    await audit(tx, { ...actorOf(req), action: "agency.opening_proposed", entity: "agency_opening_balance", entityId: r!.id, detail: { agency: agent.fullCode, ...p.data } });
    return r!;
  });
  const others = (await usersWithRoles(["director", "administrator"])).filter((u) => u !== req.user!.userId);
  await notify(others, req.user!.userId, `Opening balance to approve — ${agent.fullCode}`,
    `GH₵${Number(p.data.amount).toFixed(2)} ${p.data.direction === "agency_owes" ? "owed by the agency to the company" : "owed by the company to the agency"}, as at ${p.data.asOf}. Approve or reject it in Finance & Statements › Agencies.`, agentId);
  res.status(201).json(row);
});

const decideSchema = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(500).optional().nullable() });

/**
 * Approve or reject a proposed opening balance. The person who proposed it
 * cannot decide it. Approval replaces any earlier approved figure, and the
 * agency's balance is recomputed from it at once.
 */
router.post("/finance/agency-openings/:id/decide", requireAuth, requireRole(...MGMT), async (req, res) => {
  const p = decideSchema.safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: "Approve or reject" });
    return;
  }
  const id = String(req.params["id"]);
  const [o] = await db.select().from(agencyOpeningBalancesTable).where(eq(agencyOpeningBalancesTable.id, id)).limit(1);
  if (!o || o.status !== "proposed") {
    res.status(409).json({ error: "This proposal is no longer waiting for a decision" });
    return;
  }
  if (o.proposedBy === req.user!.userId) {
    res.status(403).json({ error: "Someone other than the person who proposed it must approve or reject it" });
    return;
  }
  if (p.data.decision === "reject" && !p.data.note) {
    res.status(400).json({ error: "Say why it is rejected" });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [agent] = await tx.select().from(agentsTable).where(eq(agentsTable.id, o.agentId)).for("update").limit(1);
    if (p.data.decision === "approve") {
      await tx.update(agencyOpeningBalancesTable).set({ status: "superseded", decisionNote: "Replaced by a newly approved opening balance" })
        .where(and(eq(agencyOpeningBalancesTable.agentId, o.agentId), eq(agencyOpeningBalancesTable.status, "approved")));
    }
    await tx.update(agencyOpeningBalancesTable).set({
      status: p.data.decision === "approve" ? "approved" : "rejected",
      decidedBy: req.user!.userId, decidedAt: new Date(), decisionNote: p.data.note || null, storedBefore: agent!.outstandingDebt,
    }).where(eq(agencyOpeningBalancesTable.id, id));
    let after: string | null = null;
    if (p.data.decision === "approve") {
      await refreshAgencyBalances(tx, o.agentId);
      const [a2] = await tx.select({ d: agentsTable.outstandingDebt }).from(agentsTable).where(eq(agentsTable.id, o.agentId)).limit(1);
      after = a2!.d;
    }
    await audit(tx, {
      ...actorOf(req), action: `agency.opening_${p.data.decision === "approve" ? "approved" : "rejected"}`, entity: "agency_opening_balance", entityId: id,
      detail: { agency: agent!.fullCode, amount: o.amount, direction: o.direction, asOf: o.asOf, storedBefore: agent!.outstandingDebt, balanceAfter: after },
      note: p.data.note ?? null,
    });
    return { storedBefore: agent!.outstandingDebt, balanceAfter: after };
  });
  res.json({ ok: true, ...result });
});

/* ── Agent commission ─────────────────────────────────────────────────────── */

router.get("/finance/commissions", requireAuth, requireRole(...MGMT, "cashier"), async (_req, res) => {
  const [weeks, payouts] = await Promise.all([
    commissionWeeks(),
    db.execute(sql`
      SELECT p.*, a.full_code AS agent_code, a.agency_name, ru.full_name AS requested_by_name,
             rv.full_name AS reviewed_by_name, pu.full_name AS paid_by_name, m.name AS account_name
        FROM agent_commission_payouts p
        JOIN agents a ON a.id = p.agent_id
        JOIN users ru ON ru.id = p.requested_by
        LEFT JOIN users rv ON rv.id = p.reviewed_by
        LEFT JOIN users pu ON pu.id = p.paid_by
        LEFT JOIN fin_money_accounts m ON m.id = p.account_id
       ORDER BY p.requested_at DESC LIMIT 2000`),
  ]);
  const agents = await db.select({ id: agentsTable.id, code: agentsTable.fullCode, name: agentsTable.agencyName }).from(agentsTable);
  res.json({ weeks, payouts: payouts.rows, agents });
});

/** Each agency's commission wallet, for the Agency Overview cards. */
router.get("/finance/commissions/wallets", requireAuth, requireRole(...MGMT, "cashier"), async (_req, res) => {
  res.json({ wallets: await commissionWallets() });
});

async function myAgent(userId: string) {
  const [a] = await db.select().from(agentsTable).where(eq(agentsTable.userId, userId)).limit(1);
  return a ?? null;
}

/** The agent's own commission wallet. */
router.get("/agent/commission", requireAuth, requireRole("agent"), async (req, res) => {
  const agent = await myAgent(req.user!.userId);
  if (!agent) {
    res.status(404).json({ error: "No agency is linked to this account" });
    return;
  }
  const [wallet, payouts] = await Promise.all([
    commissionWallet(agent.id),
    db.select().from(agentCommissionPayoutsTable).where(eq(agentCommissionPayoutsTable.agentId, agent.id)),
  ]);
  payouts.sort((a, b) => +b.requestedAt - +a.requestedAt);
  res.json({ agentId: agent.id, ...wallet, payouts });
});

const requestSchema = z.object({
  amount: z.union([z.string(), z.number()]).transform((v) => String(v).trim())
    .refine((v) => /^\d{1,9}(\.\d{1,2})?$/.test(v) && Number(v) > 0, "Enter an amount above zero, to the pesewa"),
  note: z.string().trim().max(300).optional().nullable(),
});

/** An agent asks to be paid commission. Never more than is available. */
router.post("/agent/commission/requests", requireAuth, requireRole("agent"), async (req, res) => {
  const p = requestSchema.safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: p.error.issues[0]?.message ?? "Check the amount" });
    return;
  }
  const agent = await myAgent(req.user!.userId);
  if (!agent) {
    res.status(404).json({ error: "No agency is linked to this account" });
    return;
  }
  const outcome = await db.transaction(async (tx) => {
    // One request at a time per agent, so two at once cannot both pass the check.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`commission:${agent.id}`}))`);
    const w = await commissionWallet(agent.id, tx);
    if (Number(p.data.amount) > w.available + 0.005) {
      return { error: `You can request up to GH₵${w.available.toFixed(2)}: commission for completed weeks, less what is paid or already requested.` };
    }
    const [r] = await tx.insert(agentCommissionPayoutsTable).values({
      agentId: agent.id, amount: Number(p.data.amount).toFixed(2), requestedBy: req.user!.userId, requestNote: p.data.note || null,
    }).returning();
    await audit(tx, { ...actorOf(req), action: "commission.requested", entity: "agent_commission_payout", entityId: r!.id, detail: { agency: agent.fullCode, amount: p.data.amount } });
    return { row: r! };
  });
  if ("error" in outcome) {
    res.status(409).json({ error: outcome.error });
    return;
  }
  await notify(await usersWithRoles(["administrator"]), req.user!.userId, `Commission payout request — ${agent.fullCode}`,
    `${agent.fullCode} asks to be paid GH₵${Number(p.data.amount).toFixed(2)} commission. Review it in Finance & Statements › Commissions.`, agent.id);
  res.status(201).json(outcome.row);
});

const reviewSchema = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(300).optional().nullable() });

/** The administrator (or director) approves or rejects a request. */
router.post("/finance/commissions/payouts/:id/review", requireAuth, requireRole(...MGMT), async (req, res) => {
  const p = reviewSchema.safeParse(req.body);
  if (!p.success || (p.data.decision === "reject" && !p.data.note)) {
    res.status(400).json({ error: "Approve, or reject with a reason" });
    return;
  }
  const id = String(req.params["id"]);
  const outcome = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(agentCommissionPayoutsTable).where(eq(agentCommissionPayoutsTable.id, id)).for("update").limit(1);
    if (!row || row.status !== "requested") return { error: "This request is not waiting for review", status: 409 };
    if (row.requestedBy === req.user!.userId) return { error: "You cannot review your own request", status: 403 };
    if (p.data.decision === "approve") {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`commission:${row.agentId}`}))`);
      // Re-checked here: commission can be revised by a corrected draw after the request.
      const w = await commissionWallet(row.agentId, tx);
      if (Number(row.amount) > w.available + Number(row.amount) + 0.005) {
        return { error: `The agent now has only GH₵${(w.available + Number(row.amount)).toFixed(2)} available.`, status: 409 };
      }
    }
    const [u] = await tx.update(agentCommissionPayoutsTable).set({
      status: p.data.decision === "approve" ? "approved" : "rejected", reviewedBy: req.user!.userId, reviewedAt: new Date(), reviewNote: p.data.note || null,
    }).where(eq(agentCommissionPayoutsTable.id, id)).returning();
    await audit(tx, { ...actorOf(req), action: `commission.${p.data.decision === "approve" ? "approved" : "rejected"}`, entity: "agent_commission_payout", entityId: id, note: p.data.note ?? null });
    return { row: u! };
  });
  if ("error" in outcome) {
    res.status(outcome.status ?? 409).json({ error: outcome.error });
    return;
  }
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, outcome.row.agentId)).limit(1);
  if (agent) {
    const amount = Number(outcome.row.amount).toFixed(2);
    if (p.data.decision === "approve") {
      await notify([agent.userId], req.user!.userId, "Commission payout approved", `Your request for GH₵${amount} is approved and has gone to the cashier for payment.`, agent.id);
      await notify(await usersWithRoles(["cashier"]), req.user!.userId, `Commission to pay — ${agent.fullCode}`, `GH₵${amount} approved for ${agent.fullCode}. Pay it from Finance & Statements › Commissions.`, agent.id);
    } else {
      await notify([agent.userId], req.user!.userId, "Commission payout not approved", `Your request for GH₵${amount} was not approved: ${p.data.note}`, agent.id);
    }
  }
  res.json(outcome.row);
});

const paySchema = z.object({
  method: z.enum(["cash", "momo", "bank", "transfer"]),
  accountId: z.string().uuid(),
  reference: z.string().trim().max(120).optional().nullable(),
});

/**
 * The cashier pays an approved request and records how. Only then does the
 * commission owed go down - the cash book entry follows from this record.
 */
router.post("/finance/commissions/payouts/:id/pay", requireAuth, requireRole("cashier"), async (req, res) => {
  const p = paySchema.safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: "Choose how it was paid and from which account" });
    return;
  }
  if (p.data.method !== "cash" && !p.data.reference) {
    res.status(400).json({ error: "Enter the transfer or MoMo reference" });
    return;
  }
  const [acc] = await db.select().from(finMoneyAccountsTable).where(eq(finMoneyAccountsTable.id, p.data.accountId)).limit(1);
  if (!acc || !acc.isActive) {
    res.status(404).json({ error: "Choose an open account" });
    return;
  }
  const id = String(req.params["id"]);
  const outcome = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(agentCommissionPayoutsTable).where(eq(agentCommissionPayoutsTable.id, id)).for("update").limit(1);
    if (!row || row.status !== "approved") return { error: "Only an approved request can be paid", status: 409 };
    if (row.reviewedBy === req.user!.userId) return { error: "The person who approved a payout cannot also pay it", status: 403 };
    const [u] = await tx.update(agentCommissionPayoutsTable).set({
      status: "paid", paidBy: req.user!.userId, paidAt: new Date(), method: p.data.method, accountId: acc.id, reference: p.data.reference || null,
    }).where(eq(agentCommissionPayoutsTable.id, id)).returning();
    await audit(tx, { ...actorOf(req), action: "commission.paid", entity: "agent_commission_payout", entityId: id, detail: { ...p.data, amount: row.amount } });
    return { row: u! };
  });
  if ("error" in outcome) {
    res.status(outcome.status ?? 409).json({ error: outcome.error });
    return;
  }
  await syncBooks(true);
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, outcome.row.agentId)).limit(1);
  if (agent) await notify([agent.userId], req.user!.userId, "Commission paid", `GH₵${Number(outcome.row.amount).toFixed(2)} commission has been paid to you (${p.data.method}${p.data.reference ? `, ref ${p.data.reference}` : ""}).`, agent.id);
  res.json(outcome.row);
});

/** An agent withdraws a request nobody has acted on yet. */
router.post("/agent/commission/requests/:id/cancel", requireAuth, requireRole("agent"), async (req, res) => {
  const agent = await myAgent(req.user!.userId);
  const id = String(req.params["id"]);
  const [u] = await db.update(agentCommissionPayoutsTable).set({ status: "cancelled", reviewedAt: new Date(), reviewNote: "Withdrawn by the agent" })
    .where(and(eq(agentCommissionPayoutsTable.id, id), eq(agentCommissionPayoutsTable.agentId, agent?.id ?? "00000000-0000-0000-0000-000000000000"), eq(agentCommissionPayoutsTable.status, "requested")))
    .returning();
  if (!u) {
    res.status(409).json({ error: "Only a request still waiting for review can be withdrawn" });
    return;
  }
  await audit(db, { ...actorOf(req), action: "commission.cancelled", entity: "agent_commission_payout", entityId: id });
  res.json(u);
});

export default router;
