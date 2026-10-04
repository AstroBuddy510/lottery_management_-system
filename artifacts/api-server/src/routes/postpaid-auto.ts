import { Router } from "express";
import {
  db,
  postpaidAutoSettingsTable,
  postpaidDailyLedgerTable,
  systemSettingsTable,
  writersTable,
  gamesTable,
} from "@workspace/db";
import { eq, and, lt, desc, sql, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middleware/auth";
import { logger } from "../lib/logger";
import {
  sellGate,
  dueReminder,
  midpointOf,
  outstandingOn,
  parseLeadMinutes,
  money,
  type AutoPostpaidConfig,
  type SellGate,
} from "../lib/postpaid-auto";
import { sendWhatsAppTemplate, whatsappConfigured } from "../lib/whatsapp-gateway";

const router = Router();

/** Africa/Accra, the day the office names. */
const BUSINESS_TZ = "Africa/Accra";

function accraToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * The one settings row, created on first read.
 *
 * Defaults are deliberately the OFF position: installing this feature must not
 * change how anybody's day works until an administrator decides it should.
 */
export async function loadAutoConfig(): Promise<{
  config: AutoPostpaidConfig;
  row: typeof postpaidAutoSettingsTable.$inferSelect;
}> {
  let [row] = await db.select().from(postpaidAutoSettingsTable).limit(1);
  if (!row) {
    [row] = await db.insert(postpaidAutoSettingsTable).values({}).returning();
  }
  const r = row!;
  return {
    row: r,
    config: {
      enabled: r.enabled,
      reminderLeadMinutes: parseLeadMinutes(r.reminderLeadMinutes),
      graceMinutes: r.graceMinutes,
      blockNextDay: r.blockNextDay,
      minimumChargeable: Number(r.minimumChargeable),
    },
  };
}

/**
 * The writer commission rate in force.
 *
 * Ordered by updatedAt, matching every other rate lookup in this codebase.
 * effectiveDate is not unique - production carries ten settings rows all dated
 * the same day - so ordering by it returns an arbitrary row, which is exactly
 * how writers came to be credited at 0% while the office had set 30%.
 */
async function liveCommissionPct(): Promise<number> {
  const [s] = await db
    .select({ pct: systemSettingsTable.writerCommissionPct })
    .from(systemSettingsTable)
    .orderBy(desc(systemSettingsTable.updatedAt))
    .limit(1);
  return Number(s?.pct ?? 0);
}

/**
 * Whether this writer may sell into this game, right now.
 *
 * Shared by the gate endpoint and the sale itself so the banner a writer sees
 * and the refusal they get can never disagree.
 */
export async function gateForWriter(opts: {
  writerId: string;
  game: { id: string; goLiveAt: Date | string; closeAt: Date | string };
  now?: Date;
}): Promise<SellGate & { enabled: boolean }> {
  const now = opts.now ?? new Date();
  const { config } = await loadAutoConfig();

  if (!config.enabled) {
    return {
      enabled: false,
      allowed: true,
      reason: null,
      amountDue: 0,
      locksAt: null,
      midpointAt: null,
      owedFrom: null,
    };
  }

  const pct = await liveCommissionPct();
  const today = accraToday(now);

  const [ledgerRow] = await db
    .select()
    .from(postpaidDailyLedgerTable)
    .where(
      and(
        eq(postpaidDailyLedgerTable.writerId, opts.writerId),
        eq(postpaidDailyLedgerTable.gameId, opts.game.id),
        eq(postpaidDailyLedgerTable.ledgerDate, today),
      ),
    )
    .limit(1);

  // Anything still owed from a day before today, oldest first.
  const priorRows = await db
    .select({
      ledgerDate: postpaidDailyLedgerTable.ledgerDate,
      totalStakes: postpaidDailyLedgerTable.totalStakes,
      amountPaid: postpaidDailyLedgerTable.amountPaid,
      commissionPct: postpaidDailyLedgerTable.commissionPct,
    })
    .from(postpaidDailyLedgerTable)
    .where(
      and(
        eq(postpaidDailyLedgerTable.writerId, opts.writerId),
        lt(postpaidDailyLedgerTable.ledgerDate, today),
        sql`${postpaidDailyLedgerTable.settlementStatus} <> 'settled'`,
      ),
    )
    .orderBy(postpaidDailyLedgerTable.ledgerDate);

  const priorUnsettled = priorRows
    .map((p) => ({
      ledgerDate: p.ledgerDate,
      outstanding: outstandingOn(
        {
          totalStakes: Number(p.totalStakes),
          amountPaid: Number(p.amountPaid),
          commissionPct: p.commissionPct === null ? null : Number(p.commissionPct),
          remindersSent: 0,
        },
        pct,
      ),
    }))
    .filter((p) => p.outstanding > 0);

  const gate = sellGate({
    now,
    config,
    game: {
      goLiveAt: new Date(opts.game.goLiveAt),
      closeAt: new Date(opts.game.closeAt),
    },
    ledger: ledgerRow
      ? {
          totalStakes: Number(ledgerRow.totalStakes),
          amountPaid: Number(ledgerRow.amountPaid),
          commissionPct:
            ledgerRow.commissionPct === null ? null : Number(ledgerRow.commissionPct),
          remindersSent: ledgerRow.remindersSent,
        }
      : null,
    liveCommissionPct: pct,
    priorUnsettled,
  });

  return { enabled: true, ...gate };
}

/* ------------------------------------------------------------------ admin */

router.get(
  "/postpaid/auto/settings",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (_req, res) => {
    const { row } = await loadAutoConfig();
    res.json({
      ...row,
      whatsappConfigured: whatsappConfigured(),
    });
  },
);

const settingsSchema = z.object({
  enabled: z.boolean(),
  reminderLeadMinutes: z.string().max(60),
  graceMinutes: z.number().int().min(0).max(240),
  blockNextDay: z.boolean(),
  minimumChargeable: z.number().min(0).max(1_000_000),
  whatsappEnabled: z.boolean(),
});

router.put(
  "/postpaid/auto/settings",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const parse = settingsSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid settings", details: parse.error.issues });
      return;
    }
    const leads = parseLeadMinutes(parse.data.reminderLeadMinutes);
    if (leads.length === 0) {
      res.status(400).json({ error: "Give at least one reminder time, in minutes" });
      return;
    }

    const { row } = await loadAutoConfig();
    const [updated] = await db
      .update(postpaidAutoSettingsTable)
      .set({
        enabled: parse.data.enabled,
        reminderLeadMinutes: leads.join(","),
        graceMinutes: parse.data.graceMinutes,
        blockNextDay: parse.data.blockNextDay,
        minimumChargeable: parse.data.minimumChargeable.toFixed(2),
        whatsappEnabled: parse.data.whatsappEnabled,
        updatedBy: req.user!.userId,
      })
      .where(eq(postpaidAutoSettingsTable.id, row.id))
      .returning();

    logger.info(
      { by: req.user!.userId, enabled: parse.data.enabled },
      "[POSTPAID AUTO] settings changed",
    );
    res.json({ ...updated, whatsappConfigured: whatsappConfigured() });
  },
);

/* ----------------------------------------------------------------- writer */

/**
 * The writer's own view: may I sell, what do I owe, when does it lock.
 *
 * Returns one entry per game that is currently sellable, because the midpoint
 * is per game and a writer may be mid-way through one draw and early in another.
 */
router.get("/postpaid/auto/gate", requireAuth, requireRole("writer"), async (req, res) => {
  const now = new Date();
  const { config } = await loadAutoConfig();

  if (!config.enabled) {
    res.json({ enabled: false, games: [] });
    return;
  }

  const live = await db
    .select({
      id: gamesTable.id,
      name: gamesTable.name,
      eventNumber: gamesTable.eventNumber,
      goLiveAt: gamesTable.goLiveAt,
      closeAt: gamesTable.closeAt,
    })
    .from(gamesTable)
    .where(and(eq(gamesTable.status, "live"), sql`${gamesTable.closeAt} > now()`))
    .orderBy(gamesTable.closeAt);

  const games = await Promise.all(
    live.map(async (g) => ({
      gameId: g.id,
      gameName: g.name,
      eventNumber: g.eventNumber,
      ...(await gateForWriter({ writerId: req.user!.userId, game: g, now })),
    })),
  );

  res.json({ enabled: true, games });
});

/* ------------------------------------------------------------------ sweep */

/**
 * Send any reminders that have come due.
 *
 * This deployment has no scheduler, so the sweep is driven two ways: an
 * external cron may POST here with the shared secret, and live traffic calls
 * it opportunistically (see runSweepIfDue). Both funnel through the same code,
 * and the per-ledger bitmask means a reminder is sent once however often it
 * runs.
 */
export async function sweepReminders(now = new Date()): Promise<{
  checked: number;
  sent: number;
  skipped: number;
}> {
  const { config, row } = await loadAutoConfig();
  if (!config.enabled) return { checked: 0, sent: 0, skipped: 0 };

  const pct = await liveCommissionPct();
  const today = accraToday(now);

  const live = await db
    .select({
      id: gamesTable.id,
      name: gamesTable.name,
      goLiveAt: gamesTable.goLiveAt,
      closeAt: gamesTable.closeAt,
    })
    .from(gamesTable)
    .where(and(eq(gamesTable.status, "live"), sql`${gamesTable.closeAt} > now()`));

  if (live.length === 0) return { checked: 0, sent: 0, skipped: 0 };

  const ledgers = await db
    .select({
      id: postpaidDailyLedgerTable.id,
      writerId: postpaidDailyLedgerTable.writerId,
      gameId: postpaidDailyLedgerTable.gameId,
      totalStakes: postpaidDailyLedgerTable.totalStakes,
      amountPaid: postpaidDailyLedgerTable.amountPaid,
      commissionPct: postpaidDailyLedgerTable.commissionPct,
      remindersSent: postpaidDailyLedgerTable.remindersSent,
      writerName: writersTable.fullName,
      writerPhone: writersTable.phone,
    })
    .from(postpaidDailyLedgerTable)
    .innerJoin(writersTable, eq(postpaidDailyLedgerTable.writerId, writersTable.id))
    .where(
      and(
        eq(postpaidDailyLedgerTable.ledgerDate, today),
        inArray(
          postpaidDailyLedgerTable.gameId,
          live.map((g) => g.id),
        ),
        sql`${postpaidDailyLedgerTable.settlementStatus} <> 'settled'`,
      ),
    );

  let sent = 0;
  let skipped = 0;

  for (const l of ledgers) {
    const game = live.find((g) => g.id === l.gameId);
    if (!game) continue;

    const outstanding = outstandingOn(
      {
        totalStakes: Number(l.totalStakes),
        amountPaid: Number(l.amountPaid),
        commissionPct: l.commissionPct === null ? null : Number(l.commissionPct),
        remindersSent: l.remindersSent,
      },
      pct,
    );

    const due = dueReminder({
      now,
      config,
      game: { goLiveAt: new Date(game.goLiveAt), closeAt: new Date(game.closeAt) },
      outstanding,
      remindersSent: l.remindersSent,
    });
    if (!due) continue;

    // Mark spent BEFORE sending. A reminder that goes out twice is an
    // annoyance; one that goes out in a loop because the send failed is a
    // phone bill, and the in-app banner is there regardless.
    await db
      .update(postpaidDailyLedgerTable)
      .set({ remindersSent: l.remindersSent | due.mask })
      .where(eq(postpaidDailyLedgerTable.id, l.id));

    const amount = `GH₵${outstanding.toFixed(2)}`;
    const minutes = String(Math.max(1, Math.round(due.minutesLeft)));

    // The in-app reminder needs no message of its own: the portal polls the
    // gate endpoint and shows a live countdown and the amount, which is more
    // use than a notification the writer has to go and open.
    if (row.whatsappEnabled && l.writerPhone) {
      const result = await sendWhatsAppTemplate({
        to: l.writerPhone,
        template: process.env["WHATSAPP_SETTLEMENT_TEMPLATE"] ?? "settlement_reminder",
        variables: [l.writerName ?? "Writer", game.name, amount, minutes],
      });
      if (result.success) sent += 1;
      else skipped += 1;
    } else {
      skipped += 1;
    }
  }

  await db
    .update(postpaidAutoSettingsTable)
    .set({ lastSweptAt: now })
    .where(eq(postpaidAutoSettingsTable.id, row.id));

  return { checked: ledgers.length, sent, skipped };
}

/**
 * Opportunistic sweep, throttled.
 *
 * Claims the slot with a conditional UPDATE before doing any work, so two
 * concurrent requests cannot both decide it is their turn. Fire and forget:
 * the caller is serving a writer and must not wait on WhatsApp.
 */
export function runSweepIfDue(minIntervalSeconds = 60): void {
  void (async () => {
    try {
      const claimed = await db
        .update(postpaidAutoSettingsTable)
        .set({ lastSweptAt: new Date() })
        .where(
          sql`${postpaidAutoSettingsTable.enabled} = true and (${postpaidAutoSettingsTable.lastSweptAt} is null or ${postpaidAutoSettingsTable.lastSweptAt} < now() - make_interval(secs => ${minIntervalSeconds}))`,
        )
        .returning({ id: postpaidAutoSettingsTable.id });
      if (claimed.length === 0) return;
      await sweepReminders();
    } catch (err) {
      logger.error({ err }, "[POSTPAID AUTO] opportunistic sweep failed");
    }
  })();
}

/** For an external cron. Unauthenticated by design, guarded by a shared secret. */
router.post("/postpaid/auto/sweep", async (req, res) => {
  const expected = process.env["POSTPAID_SWEEP_SECRET"] ?? "";
  if (!expected) {
    res.status(503).json({ error: "Sweep secret not configured" });
    return;
  }
  const given = req.get("x-sweep-secret") ?? "";
  if (given !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const result = await sweepReminders();
  res.json(result);
});

/* -------------------------------------------------------------- payment */

const paySchema = z.object({
  amount: z.number().positive().max(1_000_000),
  method: z.enum(["cash", "momo"]).default("cash"),
  reference: z.string().max(200).optional(),
});

/**
 * Record a mid-game payment and lift the lock.
 *
 * Separate from /postpaid/confirm because that endpoint settles a finished
 * bill against a quoted amountPayable, and at the midpoint there is no quote
 * yet - the game is still selling, so the figure is computed live from what
 * has been sold so far. Adding to amountPaid rather than setting it means a
 * writer can pay twice in a game without the second payment erasing the first.
 *
 * The ledger is only marked settled when the payment clears the whole of what
 * is currently owed; paying part of it narrows the gap and nothing more.
 */
router.post(
  "/postpaid/auto/pay/:ledgerId",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (req, res) => {
    const parse = paySchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid payment", details: parse.error.issues });
      return;
    }
    const ledgerId = req.params["ledgerId"] as string;
    const pct = await liveCommissionPct();

    const result = await db.transaction(async (tx) => {
      const [ledger] = await tx
        .select()
        .from(postpaidDailyLedgerTable)
        .where(eq(postpaidDailyLedgerTable.id, ledgerId))
        .limit(1);
      if (!ledger) return { error: "Settlement not found" as const, status: 404 };

      const before = outstandingOn(
        {
          totalStakes: Number(ledger.totalStakes),
          amountPaid: Number(ledger.amountPaid),
          commissionPct: ledger.commissionPct === null ? null : Number(ledger.commissionPct),
          remindersSent: ledger.remindersSent,
        },
        pct,
      );
      if (before <= 0) return { error: "Nothing outstanding on this bill" as const, status: 400 };

      // Never bank more than is owed: an over-payment here would silently
      // become credit against tomorrow, which no one asked for.
      const applied = money(Math.min(parse.data.amount, before));
      const paidTotal = money(Number(ledger.amountPaid) + applied);
      const clears = applied >= before;

      const [updated] = await tx
        .update(postpaidDailyLedgerTable)
        .set({
          amountPaid: paidTotal.toFixed(2),
          ...(clears
            ? {
                settlementStatus: "settled" as const,
                settlementMethod: parse.data.method,
                settlementReference: parse.data.reference ?? null,
                settledAt: new Date(),
                settledBy: req.user!.userId,
              }
            : {}),
        })
        .where(eq(postpaidDailyLedgerTable.id, ledgerId))
        .returning();

      return { ledger: updated!, applied, remaining: money(before - applied), status: 200 };
    });

    if ("error" in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    logger.info(
      { ledgerId, applied: result.applied, remaining: result.remaining, by: req.user!.userId },
      "[POSTPAID AUTO] payment recorded",
    );
    res.json({
      ledger: result.ledger,
      applied: result.applied.toFixed(2),
      remaining: result.remaining.toFixed(2),
      unlocked: result.remaining <= 0,
    });
  },
);

export default router;
