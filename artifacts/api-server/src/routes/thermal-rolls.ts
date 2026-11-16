import { Router } from "express";
import {
  db,
  thermalRollPurchasesTable,
  thermalRollAllotmentsTable,
  thermalRollDistributionsTable,
  thermalRollSettingsTable,
  agentsTable,
  writersTable,
  usersTable,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middleware/auth";
import { dispatchSystemNotification } from "../lib/notify";
import { logger } from "../lib/logger";

/**
 * Thermal Rolls - the paper the POS terminals print tickets on.
 *
 * Purchases fill the office store; allotments move rolls from the store to
 * an agent; distributions move them from an agent to one of their writers.
 * Every balance is computed from those movements at the moment it is asked
 * for, so the figures on screen are the figures in the database.
 *
 * Who does what
 *   read             director, administrator, cashier
 *   record movements administrator, cashier   (the same people who keep booklets)
 *   set the alert    director, administrator
 *
 * Low stock: when the store falls to the threshold, every active director,
 * administrator and cashier gets an alert in Notifications - once. It is not
 * repeated on each later allotment while stock stays low; a purchase that
 * lifts the store back above the line re-arms it.
 */

const router = Router();

const READ = ["director", "administrator", "cashier"] as const;
const WRITE = ["administrator", "cashier"] as const;
const SETTINGS = ["director", "administrator"] as const;
const ALERT_ROLES = ["director", "administrator", "cashier"] as const;

/** A real calendar day, not just the shape of one - 2026-02-30 is refused. */
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-16")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "That date does not exist");

const notes = z.string().trim().max(500).optional().nullable();
const count = (label: string) =>
  z.number({ error: `${label} is required` }).int(`${label} must be a whole number`).positive(`${label} must be more than zero`).max(1_000_000);

const purchaseBody = z.object({
  purchaseDate: day,
  boxes: count("Boxes"),
  rollsPerBox: count("Rolls per box"),
  totalCost: z.number().nonnegative("Cost cannot be negative").max(100_000_000),
  supplier: z.string().trim().max(120).optional().nullable(),
  notes,
});

const allotmentBody = z.object({
  agentId: z.string().uuid(),
  allottedDate: day,
  quantity: count("Quantity"),
  notes,
});

const distributionBody = z.object({
  writerId: z.string().uuid(),
  distributedDate: day,
  quantity: count("Quantity"),
  notes,
});

const settingsBody = z.object({
  lowStockThreshold: z.number().int("Use a whole number of rolls").min(0).max(1_000_000),
});

function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Invalid request";
}

/* ── balances ────────────────────────────────────────────────────────────── */

type Executor = Pick<typeof db, "execute">;

async function storeFigures(ex: Executor) {
  const res = await ex.execute(sql`
    SELECT
      (SELECT coalesce(sum(total_rolls), 0) FROM thermal_roll_purchases)::int  AS purchased,
      (SELECT coalesce(sum(boxes), 0)       FROM thermal_roll_purchases)::int  AS boxes,
      (SELECT coalesce(sum(total_cost), 0)  FROM thermal_roll_purchases)::text AS cost,
      (SELECT coalesce(sum(quantity), 0)    FROM thermal_roll_allotments)::int AS allotted,
      (SELECT coalesce(sum(quantity), 0)    FROM thermal_roll_distributions)::int AS distributed
  `);
  const r = res.rows[0] as { purchased: number; boxes: number; cost: string; allotted: number; distributed: number };
  return { ...r, store: r.purchased - r.allotted, withAgents: r.allotted - r.distributed };
}

async function agentHolding(ex: Executor, agentId: string): Promise<number> {
  const res = await ex.execute(sql`
    SELECT
      (SELECT coalesce(sum(quantity), 0) FROM thermal_roll_allotments    WHERE agent_id = ${agentId})
    - (SELECT coalesce(sum(quantity), 0) FROM thermal_roll_distributions WHERE agent_id = ${agentId}) AS held
  `);
  return Number((res.rows[0] as { held: number | string }).held) || 0;
}

/** The single settings row, created on first use so a fresh database needs no seed. */
async function settingsRow(ex: Executor & Pick<typeof db, "insert" | "select">) {
  await ex.insert(thermalRollSettingsTable).values({ id: 1 }).onConflictDoNothing();
  const [row] = await ex.select().from(thermalRollSettingsTable).where(eq(thermalRollSettingsTable.id, 1));
  return row!;
}

/**
 * One lock for every roll movement.
 *
 * "Is there enough in the store?" and "take it" have to be one step. Two
 * cashiers allotting the last fifty rolls at the same moment would otherwise
 * both see fifty and both take them. Movements are rare, so serialising all
 * of them costs nothing anyone will notice.
 */
async function lockRolls(tx: Executor) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('thermal_rolls'))`);
}

type LowStockCrossing = { store: number; threshold: number } | null;

/**
 * Compare the store with the threshold after a change, inside the change's
 * own transaction, and flip the alert flag if the line was crossed.
 *
 * Returns the crossing so the caller can send the alert AFTER commit - an
 * alert for a movement that then rolled back would be a false alarm.
 */
async function checkLowStock(tx: any): Promise<LowStockCrossing> {
  const settings = await settingsRow(tx);
  const { store } = await storeFigures(tx);
  const low = store <= settings.lowStockThreshold;
  if (low && !settings.alertActive) {
    await tx
      .update(thermalRollSettingsTable)
      .set({ alertActive: true, lastAlertAt: new Date() })
      .where(eq(thermalRollSettingsTable.id, 1));
    return { store, threshold: settings.lowStockThreshold };
  }
  if (!low && settings.alertActive) {
    await tx.update(thermalRollSettingsTable).set({ alertActive: false }).where(eq(thermalRollSettingsTable.id, 1));
  }
  return null;
}

async function sendLowStockAlert(crossing: LowStockCrossing, actorId: string) {
  if (!crossing) return;
  try {
    const recipients = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(inArray(usersTable.role, [...ALERT_ROLES]), eq(usersTable.isActive, true)));
    const rolls = (n: number) => `${n.toLocaleString("en-GB")} roll${n === 1 ? "" : "s"}`;
    await dispatchSystemNotification({
      sentBy: actorId,
      messageType: "alert",
      title: `Thermal rolls low - ${rolls(crossing.store)} left in store`,
      body:
        `The office store of thermal rolls is down to ${rolls(crossing.store)}, at or below the ` +
        `low-stock line of ${rolls(crossing.threshold)}. Terminals cannot print tickets without them. ` +
        `Record a purchase under Inventory → Thermal Rolls once more are bought.`,
      targetType: "system",
      recipientUserIds: recipients.map((r) => r.id),
    });
  } catch (err) {
    // The movement is already saved; a failed alert must not undo it.
    logger.error({ err }, "[THERMAL ROLLS] low-stock alert could not be sent");
  }
}

/* ── summary ─────────────────────────────────────────────────────────────── */

router.get("/inventory/thermal-rolls/summary", requireAuth, requireRole(...READ), async (_req, res) => {
  const [figures, settings] = await Promise.all([storeFigures(db), settingsRow(db)]);
  res.json({
    purchased: figures.purchased,
    boxesPurchased: figures.boxes,
    totalCost: Number(figures.cost).toFixed(2),
    costPerRoll: figures.purchased > 0 ? (Number(figures.cost) / figures.purchased).toFixed(2) : "0.00",
    allotted: figures.allotted,
    distributed: figures.distributed,
    storeBalance: figures.store,
    withAgents: figures.withAgents,
    lowStockThreshold: settings.lowStockThreshold,
    isLow: figures.store <= settings.lowStockThreshold,
    alertActive: settings.alertActive,
    lastAlertAt: settings.lastAlertAt?.toISOString() ?? null,
  });
});

/* ── purchases ───────────────────────────────────────────────────────────── */

router.get("/inventory/thermal-rolls/purchases", requireAuth, requireRole(...READ), async (_req, res) => {
  // stockAfter is the store's running total of rolls PURCHASED, oldest first:
  // "how many rolls had we bought in all, as of this purchase".
  const rows = await db.execute(sql`
    SELECT p.id, p.purchase_date, p.boxes, p.rolls_per_box, p.total_rolls, p.total_cost::text AS total_cost,
           p.supplier, p.notes, p.created_at, u.full_name AS entered_by_name,
           sum(p.total_rolls) OVER (ORDER BY p.purchase_date, p.created_at, p.id)::int AS cumulative_rolls
      FROM thermal_roll_purchases p
      LEFT JOIN users u ON u.id = p.entered_by
     ORDER BY p.purchase_date DESC, p.created_at DESC, p.id DESC
  `);
  res.json(
    (rows.rows as Record<string, any>[]).map((r) => ({
      id: r.id,
      purchaseDate: String(r.purchase_date).slice(0, 10),
      boxes: r.boxes,
      rollsPerBox: r.rolls_per_box,
      totalRolls: r.total_rolls,
      totalCost: Number(r.total_cost).toFixed(2),
      costPerRoll: r.total_rolls > 0 ? (Number(r.total_cost) / r.total_rolls).toFixed(2) : "0.00",
      cumulativeRolls: r.cumulative_rolls,
      supplier: r.supplier,
      notes: r.notes,
      enteredBy: r.entered_by_name,
      createdAt: new Date(r.created_at).toISOString(),
    })),
  );
});

router.post("/inventory/thermal-rolls/purchases", requireAuth, requireRole(...WRITE), async (req, res) => {
  const parse = purchaseBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: firstIssue(parse.error) });
    return;
  }
  const b = parse.data;
  const actor = req.user!.userId;

  const { purchase, crossing } = await db.transaction(async (tx) => {
    await lockRolls(tx);
    const [purchase] = await tx
      .insert(thermalRollPurchasesTable)
      .values({
        purchaseDate: b.purchaseDate,
        boxes: b.boxes,
        rollsPerBox: b.rollsPerBox,
        totalCost: b.totalCost.toFixed(2),
        supplier: b.supplier || null,
        notes: b.notes || null,
        enteredBy: actor,
      })
      .returning();
    // A purchase only ever raises the store, so this can only re-arm the
    // alert - unless the store is still at or under the line after it.
    const crossing = await checkLowStock(tx);
    return { purchase, crossing };
  });

  await sendLowStockAlert(crossing, actor);
  res.status(201).json(purchase);
});

/* ── allotments: store -> agent ──────────────────────────────────────────── */

router.get("/inventory/thermal-rolls/allotments", requireAuth, requireRole(...READ), async (_req, res) => {
  const rows = await db.execute(sql`
    SELECT t.id, t.allotted_date, t.quantity, t.notes, t.created_at,
           a.id AS agent_id, a.full_code AS agent_code,
           coalesce(nullif(a.agency_name, ''), au.full_name, a.full_code) AS agency_name,
           u.full_name AS entered_by_name
      FROM thermal_roll_allotments t
      JOIN agents a ON a.id = t.agent_id
      LEFT JOIN users au ON au.id = a.user_id
      LEFT JOIN users u ON u.id = t.entered_by
     ORDER BY t.allotted_date DESC, t.created_at DESC, t.id DESC
  `);
  res.json(
    (rows.rows as Record<string, any>[]).map((r) => ({
      id: r.id,
      allottedDate: String(r.allotted_date).slice(0, 10),
      quantity: r.quantity,
      notes: r.notes,
      agentId: r.agent_id,
      agentCode: r.agent_code,
      agencyName: r.agency_name,
      enteredBy: r.entered_by_name,
      createdAt: new Date(r.created_at).toISOString(),
    })),
  );
});

router.post("/inventory/thermal-rolls/allotments", requireAuth, requireRole(...WRITE), async (req, res) => {
  const parse = allotmentBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: firstIssue(parse.error) });
    return;
  }
  const b = parse.data;
  const actor = req.user!.userId;

  const [agent] = await db.select({ id: agentsTable.id }).from(agentsTable).where(eq(agentsTable.id, b.agentId)).limit(1);
  if (!agent) {
    res.status(404).json({ error: "Agency not found" });
    return;
  }

  const result = await db.transaction(async (tx) => {
    await lockRolls(tx);
    const { store } = await storeFigures(tx);
    if (b.quantity > store) {
      return { error: `Only ${store.toLocaleString("en-GB")} roll${store === 1 ? " is" : "s are"} in the store.` } as const;
    }
    const [row] = await tx
      .insert(thermalRollAllotmentsTable)
      .values({
        agentId: b.agentId,
        allottedDate: b.allottedDate,
        quantity: b.quantity,
        notes: b.notes || null,
        enteredBy: actor,
      })
      .returning();
    const crossing = await checkLowStock(tx);
    return { row, crossing } as const;
  });

  if ("error" in result) {
    res.status(409).json({ error: result.error });
    return;
  }
  await sendLowStockAlert(result.crossing, actor);
  res.status(201).json(result.row);
});

/* ── distributions: agent -> writer ──────────────────────────────────────── */

router.get("/inventory/thermal-rolls/distributions", requireAuth, requireRole(...READ), async (_req, res) => {
  const rows = await db.execute(sql`
    SELECT d.id, d.distributed_date, d.quantity, d.notes, d.created_at,
           a.id AS agent_id, a.full_code AS agent_code,
           coalesce(nullif(a.agency_name, ''), au.full_name, a.full_code) AS agency_name,
           w.id AS writer_id, w.full_code AS writer_code, w.full_name AS writer_name,
           u.full_name AS entered_by_name
      FROM thermal_roll_distributions d
      JOIN agents  a ON a.id = d.agent_id
      LEFT JOIN users au ON au.id = a.user_id
      JOIN writers w ON w.id = d.writer_id
      LEFT JOIN users u ON u.id = d.entered_by
     ORDER BY d.distributed_date DESC, d.created_at DESC, d.id DESC
  `);
  res.json(
    (rows.rows as Record<string, any>[]).map((r) => ({
      id: r.id,
      distributedDate: String(r.distributed_date).slice(0, 10),
      quantity: r.quantity,
      notes: r.notes,
      agentId: r.agent_id,
      agentCode: r.agent_code,
      agencyName: r.agency_name,
      writerId: r.writer_id,
      writerCode: r.writer_code,
      writerName: r.writer_name,
      enteredBy: r.entered_by_name,
      createdAt: new Date(r.created_at).toISOString(),
    })),
  );
});

router.post("/inventory/thermal-rolls/distributions", requireAuth, requireRole(...WRITE), async (req, res) => {
  const parse = distributionBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: firstIssue(parse.error) });
    return;
  }
  const b = parse.data;
  const actor = req.user!.userId;

  // The rolls come out of the stock of the agent the writer works for.
  const [writer] = await db
    .select({ id: writersTable.id, agentId: writersTable.agentId })
    .from(writersTable)
    .where(eq(writersTable.id, b.writerId))
    .limit(1);
  if (!writer) {
    res.status(404).json({ error: "Writer not found" });
    return;
  }

  const result = await db.transaction(async (tx) => {
    await lockRolls(tx);
    const held = await agentHolding(tx, writer.agentId);
    if (b.quantity > held) {
      return { error: `This agency holds ${held.toLocaleString("en-GB")} roll${held === 1 ? "" : "s"}. Allot more to the agency first.` } as const;
    }
    const [row] = await tx
      .insert(thermalRollDistributionsTable)
      .values({
        agentId: writer.agentId,
        writerId: b.writerId,
        distributedDate: b.distributedDate,
        quantity: b.quantity,
        notes: b.notes || null,
        enteredBy: actor,
      })
      .returning();
    return { row } as const;
  });

  if ("error" in result) {
    res.status(409).json({ error: result.error });
    return;
  }
  res.status(201).json(result.row);
});

/* ── balances by agency, and by writer ───────────────────────────────────── */

router.get("/inventory/thermal-rolls/balances", requireAuth, requireRole(...READ), async (_req, res) => {
  // Every active agency is listed, including those never allotted a roll -
  // "has none" is exactly what someone deciding the next allotment needs.
  const agencies = await db.execute(sql`
    SELECT a.id AS agent_id, a.full_code AS agent_code,
           coalesce(nullif(a.agency_name, ''), au.full_name, a.full_code) AS agency_name,
           coalesce(al.total, 0)::int AS allotted,
           coalesce(di.total, 0)::int AS distributed,
           al.last_date AS last_allotted
      FROM agents a
      LEFT JOIN users au ON au.id = a.user_id
      LEFT JOIN (SELECT agent_id, sum(quantity) AS total, max(allotted_date) AS last_date
                   FROM thermal_roll_allotments GROUP BY agent_id) al ON al.agent_id = a.id
      LEFT JOIN (SELECT agent_id, sum(quantity) AS total
                   FROM thermal_roll_distributions GROUP BY agent_id) di ON di.agent_id = a.id
     WHERE a.is_active OR al.total IS NOT NULL
     ORDER BY (coalesce(al.total, 0) - coalesce(di.total, 0)) DESC, a.full_code
  `);
  const writers = await db.execute(sql`
    SELECT w.id AS writer_id, w.full_code AS writer_code, w.full_name AS writer_name, w.agent_id,
           sum(d.quantity)::int AS received, max(d.distributed_date) AS last_received
      FROM thermal_roll_distributions d
      JOIN writers w ON w.id = d.writer_id
     GROUP BY w.id, w.full_code, w.full_name, w.agent_id
     ORDER BY received DESC, w.full_code
  `);
  res.json({
    agencies: (agencies.rows as Record<string, any>[]).map((r) => ({
      agentId: r.agent_id,
      agentCode: r.agent_code,
      agencyName: r.agency_name,
      allotted: r.allotted,
      distributed: r.distributed,
      balance: r.allotted - r.distributed,
      lastAllotted: r.last_allotted ? String(r.last_allotted).slice(0, 10) : null,
    })),
    writers: (writers.rows as Record<string, any>[]).map((r) => ({
      writerId: r.writer_id,
      writerCode: r.writer_code,
      writerName: r.writer_name,
      agentId: r.agent_id,
      received: r.received,
      lastReceived: r.last_received ? String(r.last_received).slice(0, 10) : null,
    })),
  });
});

/** An agency's writers, for the "give to writer" picker, with what each has had. */
router.get("/inventory/thermal-rolls/agencies/:agentId/writers", requireAuth, requireRole(...READ), async (req, res) => {
  const agentId = String(req.params.agentId);
  if (!z.string().uuid().safeParse(agentId).success) {
    res.status(400).json({ error: "Invalid agency" });
    return;
  }
  const [rows, held] = await Promise.all([
    db.execute(sql`
      SELECT w.id, w.full_code, w.full_name,
             coalesce((SELECT sum(quantity) FROM thermal_roll_distributions d WHERE d.writer_id = w.id), 0)::int AS received
        FROM writers w
       WHERE w.agent_id = ${agentId} AND w.is_active
       ORDER BY w.full_code
    `),
    agentHolding(db, agentId),
  ]);
  res.json({
    holding: held,
    writers: (rows.rows as Record<string, any>[]).map((r) => ({
      writerId: r.id,
      writerCode: r.full_code,
      writerName: r.full_name,
      received: r.received,
    })),
  });
});

/* ── low-stock line ──────────────────────────────────────────────────────── */

router.put("/inventory/thermal-rolls/settings", requireAuth, requireRole(...SETTINGS), async (req, res) => {
  const parse = settingsBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: firstIssue(parse.error) });
    return;
  }
  const actor = req.user!.userId;

  const crossing = await db.transaction(async (tx) => {
    await lockRolls(tx);
    await settingsRow(tx);
    await tx
      .update(thermalRollSettingsTable)
      .set({ lowStockThreshold: parse.data.lowStockThreshold, updatedBy: actor, updatedAt: new Date() })
      .where(eq(thermalRollSettingsTable.id, 1));
    // Raising the line above the current stock is itself a crossing.
    return checkLowStock(tx);
  });

  await sendLowStockAlert(crossing, actor);
  const settings = await settingsRow(db);
  res.json({ lowStockThreshold: settings.lowStockThreshold, alertActive: settings.alertActive });
});

export default router;
