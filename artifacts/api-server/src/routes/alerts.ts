import { Router } from "express";
import { db, ticketsTable, betTypesTable, writersTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";
import { buildExposureReport, type ExposureTicket } from "../lib/exposure";
import { loadHedgePolicy } from "../lib/hedge-policy";
import { logger } from "../lib/logger";

/**
 * Everything that wants an office user's attention, in one small response,
 * for the menu badges and the bell. Read-only; polled by the layout.
 *
 * Each alert names the page that deals with it, so the bell can take the
 * user straight there. Only alerts the user's role can act on are returned.
 */

const router = Router();

type Alert = {
  key: string;
  /** Which menu item it belongs to. */
  area: "notifications" | "live-ticker" | "risk" | "finance" | "payments";
  tone: "info" | "warn" | "urgent";
  title: string;
  detail: string;
  count?: number;
  href: string;
};

const n = (v: unknown) => Number(v ?? 0) || 0;
const one = async (q: ReturnType<typeof sql>) => n(((await db.execute(q)).rows[0] as { v?: unknown } | undefined)?.v);
const ghs = (v: number) => `GH₵${v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Combinations on today's live games that the hedge policy says must be laid
 * off. Computed the same way as the Risk Management page. A failure here
 * never takes the other alerts down with it.
 */
async function mustHedgeOnLiveGames(): Promise<{ count: number; liability: number; games: string[] }> {
  try {
    const live = (await db.execute(sql`SELECT id, name FROM games WHERE status = 'live' AND close_at > now()`)).rows as Array<{ id: string; name: string }>;
    if (!live.length) return { count: 0, liability: 0, games: [] };
    const [betTypes, flagged, policy] = await Promise.all([
      db.select({ id: betTypesTable.id, name: betTypesTable.name, code: betTypesTable.code, payoutMultiplier: betTypesTable.payoutMultiplier }).from(betTypesTable),
      db.select({ id: writersTable.id }).from(writersTable).where(eq(writersTable.isRedFlagged, true)),
      loadHedgePolicy(),
    ]);
    const flaggedIds = new Set(flagged.map((w) => w.id));
    let count = 0;
    let liability = 0;
    const games: string[] = [];
    for (const g of live) {
      const tickets = await db
        .select({ writerId: ticketsTable.writerId, betTypeId: ticketsTable.betTypeId, numbers: ticketsTable.numbers, stakeAmount: ticketsTable.stakeAmount, potentialPayout: ticketsTable.potentialPayout })
        .from(ticketsTable)
        .where(and(eq(ticketsTable.gameId, g.id), eq(ticketsTable.status, "active")));
      if (!tickets.length) continue;
      const report = buildExposureReport(tickets as ExposureTicket[], betTypes, flaggedIds, policy);
      if (report.mustHedgeCount > 0) {
        count += report.mustHedgeCount;
        liability += report.mustHedgeLiability;
        games.push(g.name);
      }
    }
    return { count, liability, games };
  } catch (err) {
    logger.warn({ err }, "[ALERTS] hedge check failed");
    return { count: 0, liability: 0, games: [] };
  }
}

router.get("/alerts", requireAuth, requireRole("director", "administrator", "cashier"), async (req, res) => {
  const role = req.user!.role;
  const userId = req.user!.userId;
  const mgmt = role === "director" || role === "administrator";
  const alerts: Alert[] = [];

  // ── Notifications ──
  const unread = await one(sql`SELECT count(*) AS v FROM notification_receipts WHERE user_id = ${userId} AND read_at IS NULL`);
  const latest = (await db.execute(sql`
    SELECT n.title, n.created_at FROM notification_receipts r JOIN notifications n ON n.id = r.notification_id
     WHERE r.user_id = ${userId} AND r.read_at IS NULL ORDER BY n.created_at DESC LIMIT 1`)).rows[0] as { title: string; created_at: string } | undefined;
  if (unread > 0) {
    alerts.push({ key: "notifications", area: "notifications", tone: "info", count: unread,
      title: `${unread} unread notification${unread === 1 ? "" : "s"}`, detail: latest ? `Latest: ${latest.title}` : "", href: "/notifications" });
  }

  // ── The newest game ──
  // A game counts as new from the moment it goes live (or is created) until
  // the user has opened the Live Ticker since; the browser remembers that.
  let newestGame: { id: string; name: string; eventNumber: string; status: string; since: string } | null = null;
  if (mgmt) {
    const g = (await db.execute(sql`
      SELECT id, name, event_number, status, greatest(created_at, CASE WHEN status = 'live' THEN go_live_at ELSE created_at END) AS since
        FROM games
       WHERE (status = 'live' AND close_at > now()) OR created_at > now() - interval '24 hours'
       ORDER BY (status = 'live') DESC, since DESC LIMIT 1`)).rows[0] as { id: string; name: string; event_number: string; status: string; since: string } | undefined;
    if (g) {
      newestGame = { id: g.id, name: g.name, eventNumber: g.event_number, status: g.status, since: g.since };
      alerts.push({ key: `game:${g.id}`, area: "live-ticker", tone: "info",
        title: g.status === "live" ? `${g.name} is live` : `New game: ${g.name}`,
        detail: `#${g.event_number} - follow its sales on the Live Ticker`, href: "/live-ticker" });
    }
  }

  // ── Risk: what needs someone now ──
  let riskTotal = 0;
  if (mgmt) {
    const [openFlags, flaggedClaims, hedge] = await Promise.all([
      one(sql`SELECT count(*) AS v FROM risk_flags WHERE status = 'open'`),
      one(sql`SELECT count(*) AS v FROM payout_requests WHERE status = 'rejected'`),
      mustHedgeOnLiveGames(),
    ]);
    if (openFlags) alerts.push({ key: "risk:flags", area: "risk", tone: "urgent", count: openFlags, title: `${openFlags} open risk flag${openFlags === 1 ? "" : "s"}`, detail: "Suspicious activity waiting for review", href: "/risk-management" });
    if (flaggedClaims) alerts.push({ key: "risk:claims", area: "risk", tone: "urgent", count: flaggedClaims, title: `${flaggedClaims} flagged win claim${flaggedClaims === 1 ? "" : "s"}`, detail: "Sent back for review - resolve or withhold", href: "/risk-management" });
    if (hedge.count) alerts.push({ key: "risk:hedge", area: "risk", tone: "urgent", count: hedge.count, title: `${hedge.count} combination${hedge.count === 1 ? "" : "s"} must be hedged`, detail: `${ghs(hedge.liability)} exposed on ${hedge.games.join(", ")}`, href: "/risk-management" });
    riskTotal = openFlags + flaggedClaims + hedge.count;
  }

  // ── Finance: decisions waiting on this role ──
  try {
    if (mgmt) {
      const openings = await one(sql`SELECT count(*) AS v FROM agency_opening_balances WHERE status = 'proposed' AND proposed_by <> ${userId}`);
      if (openings) alerts.push({ key: "fin:openings", area: "finance", tone: "warn", count: openings, title: `${openings} agency opening balance${openings === 1 ? "" : "s"} to approve`, detail: "Finance & Statements › Agencies", href: "/finance?tab=agencies" });
    }
    if (role === "director") {
      const schedules = await one(sql`SELECT count(*) AS v FROM salary_schedules WHERE status = 'submitted' AND prepared_by <> ${userId}`);
      if (schedules) alerts.push({ key: "fin:salary", area: "finance", tone: "warn", count: schedules, title: `${schedules} salary schedule${schedules === 1 ? "" : "s"} to approve`, detail: "Finance & Statements › Payroll", href: "/finance?tab=payroll" });
      const costs = await one(sql`SELECT count(*) AS v FROM booklet_batches WHERE NOT cost_confirmed`);
      if (costs) alerts.push({ key: "fin:booklets", area: "finance", tone: "warn", count: costs, title: `${costs} booklet batch cost${costs === 1 ? "" : "s"} to confirm`, detail: "Against the supplier's invoice - Finance & Statements › Inventory", href: "/finance?tab=inventory" });
    }
    if (mgmt) {
      const requests = await one(sql`SELECT count(*) AS v FROM agent_commission_payouts WHERE status = 'requested' AND requested_by <> ${userId}`);
      if (requests) alerts.push({ key: "fin:commission-review", area: "finance", tone: "warn", count: requests, title: `${requests} commission request${requests === 1 ? "" : "s"} to review`, detail: "Finance & Statements › Commissions", href: "/finance?tab=commissions" });
    }
    if (role === "cashier") {
      const toPay = await one(sql`SELECT count(*) AS v FROM agent_commission_payouts WHERE status = 'approved'`);
      if (toPay) alerts.push({ key: "fin:commission-pay", area: "finance", tone: "warn", count: toPay, title: `${toPay} approved commission${toPay === 1 ? "" : "s"} to pay`, detail: "Finance & Statements › Commissions", href: "/finance?tab=commissions" });
      const waiting = await one(sql`SELECT count(*) AS v FROM payout_requests WHERE status = 'verified'`);
      if (waiting) alerts.push({ key: "pay:wins", area: "payments", tone: "warn", count: waiting, title: `${waiting} POS win${waiting === 1 ? "" : "s"} waiting to be paid`, detail: "POS Wins Payment", href: "/pos-wins-payment" });
    }
  } catch (err) {
    // The finance tables arrive with migrations 0022-0025; until then, no finance alerts.
    logger.warn({ err }, "[ALERTS] finance alerts unavailable");
  }

  res.json({ unread, newestGame, riskTotal, alerts });
});

export default router;
