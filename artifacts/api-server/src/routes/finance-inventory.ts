import { Router } from "express";
import {
  db, bookletBatchesTable, thermalRollPurchasesTable, inventoryCostCorrectionsTable, inventorySupplierPaymentsTable,
  bookletAdjustmentsTable, finMoneyAccountsTable, salarySchedulesTable, salaryPaymentsTable, usersTable,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middleware/auth";
import { syncBooks, audit, fundBalances } from "../lib/finance/books";
import { bookletStock, thermalStock } from "../lib/finance/inventory";
import { dispatchSystemNotification } from "../lib/notify";
import { logger } from "../lib/logger";

/**
 * Inventory at cost (booklets, thermal rolls), what is owed to suppliers,
 * and the monthly salary schedule that must be approved before salaries are
 * paid.
 */

const router = Router();
const MGMT = ["director", "administrator"] as const;
const ALL3 = ["director", "administrator", "cashier"] as const;
const actorOf = (req: { user?: { userId: string; role: string } }) => ({ actorUserId: req.user?.userId ?? null, actorRole: req.user?.role ?? null });
const amountStr = z.union([z.string(), z.number()]).transform((v) => String(v).trim())
  .refine((v) => /^\d{1,11}(\.\d{1,2})?$/.test(v) && Number(v) > 0, "Enter an amount above zero, to the pesewa");

async function notifyRoles(roles: string[], sentBy: string, title: string, body: string) {
  try {
    const ids = (await db.select({ id: usersTable.id }).from(usersTable).where(inArray(usersTable.role, roles as never[]))).map((u) => u.id).filter((id) => id !== sentBy);
    if (ids.length) await dispatchSystemNotification({ sentBy, messageType: "alert", title, body, targetType: "system", recipientUserIds: ids });
  } catch (err) {
    logger.warn({ err, title }, "[FINANCE] notification failed");
  }
}

/* ── Inventory ────────────────────────────────────────────────────────────── */

router.get("/finance/inventory", requireAuth, requireRole(...ALL3), async (_req, res) => {
  await syncBooks();
  const [booklets, thermal, adjustments] = await Promise.all([
    bookletStock(),
    thermalStock(),
    db.execute(sql`
      SELECT b.*, a.full_code AS agent_code, u.full_name AS entered_by_name
        FROM booklet_adjustments b LEFT JOIN agents a ON a.id = b.agent_id JOIN users u ON u.id = b.entered_by
       ORDER BY b.occurred_on DESC, b.created_at DESC LIMIT 1000`),
  ]);
  res.json({ booklets, thermal, adjustments: adjustments.rows });
});

const detailsSchema = z.object({
  supplier: z.string().trim().max(120).optional().nullable(),
  invoiceRef: z.string().trim().max(120).optional().nullable(),
  serialFrom: z.string().trim().max(40).optional().nullable(),
  serialTo: z.string().trim().max(40).optional().nullable(),
});

/** Supplier, invoice and serial range for a booklet batch. Descriptive only; the change is audited. */
router.post("/finance/inventory/booklet-batches/:id/details", requireAuth, requireRole(...MGMT), async (req, res) => {
  const p = detailsSchema.safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: "Check the details" });
    return;
  }
  const id = String(req.params["id"]);
  const [before] = await db.select().from(bookletBatchesTable).where(eq(bookletBatchesTable.id, id)).limit(1);
  if (!before) {
    res.status(404).json({ error: "No such batch" });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.update(bookletBatchesTable).set({
      supplier: p.data.supplier || null, invoiceRef: p.data.invoiceRef || null, serialFrom: p.data.serialFrom || null, serialTo: p.data.serialTo || null,
    }).where(eq(bookletBatchesTable.id, id));
    await audit(tx, { ...actorOf(req), action: "inventory.batch_details", entity: "booklet_batch", entityId: id,
      detail: { before: { supplier: before.supplier, invoiceRef: before.invoiceRef, serialFrom: before.serialFrom, serialTo: before.serialTo }, after: p.data } });
  });
  res.json({ ok: true });
});

const confirmSchema = z.object({
  totalCost: amountStr,
  invoiceRef: z.string().trim().min(2, "Give the invoice number the cost comes from").max(120),
  reason: z.string().trim().min(5).max(500),
});

/**
 * Confirm a booklet batch's cost against the supplier's invoice. The figure
 * on file is replaced only here, only once, and only by the director; the
 * old and new figures are both kept.
 */
router.post("/finance/inventory/booklet-batches/:id/confirm-cost", requireAuth, requireRole("director"), async (req, res) => {
  const p = confirmSchema.safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: p.error.issues[0]?.message ?? "Check the figures" });
    return;
  }
  const id = String(req.params["id"]);
  const outcome = await db.transaction(async (tx) => {
    const [b] = await tx.select().from(bookletBatchesTable).where(eq(bookletBatchesTable.id, id)).for("update").limit(1);
    if (!b) return { error: "No such batch", status: 404 };
    if (b.costConfirmed) return { error: "This batch's cost is already confirmed", status: 409 };
    const paid = await tx.execute(sql`SELECT coalesce(sum(amount), 0) AS paid FROM inventory_supplier_payments WHERE item_type = 'booklet_batch' AND item_id = ${id}`);
    if (Number(p.data.totalCost) + 0.005 < Number((paid.rows[0] as { paid: string }).paid)) {
      return { error: "More has already been paid to the supplier than this cost", status: 409 };
    }
    await tx.insert(inventoryCostCorrectionsTable).values({
      itemType: "booklet_batch", itemId: id, oldTotal: b.totalCost, newTotal: Number(p.data.totalCost).toFixed(2),
      invoiceRef: p.data.invoiceRef, reason: p.data.reason, correctedBy: req.user!.userId,
    });
    await tx.update(bookletBatchesTable).set({
      totalCost: Number(p.data.totalCost).toFixed(2),
      costPerBooklet: (Number(p.data.totalCost) / b.quantity).toFixed(4),
      invoiceRef: p.data.invoiceRef,
      costConfirmed: true, costConfirmedBy: req.user!.userId, costConfirmedAt: new Date(),
    }).where(eq(bookletBatchesTable.id, id));
    await audit(tx, { ...actorOf(req), action: "inventory.cost_confirmed", entity: "booklet_batch", entityId: id,
      detail: { quantity: b.quantity, oldTotal: b.totalCost, newTotal: p.data.totalCost, invoiceRef: p.data.invoiceRef }, note: p.data.reason });
    return { ok: true };
  });
  if ("error" in outcome) {
    res.status(outcome.status ?? 409).json({ error: outcome.error });
    return;
  }
  res.json(outcome);
});

const payItemSchema = z.object({
  amount: amountStr,
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  method: z.enum(["cash", "momo", "bank", "cheque", "transfer"]),
  accountId: z.string().uuid(),
  reference: z.string().trim().max(120).optional().nullable(),
  note: z.string().trim().max(300).optional().nullable(),
});

/** Pay a supplier for a batch. Never more than is still owed on it. */
router.post("/finance/inventory/:type/:id/payments", requireAuth, requireRole(...ALL3), async (req, res) => {
  const type = String(req.params["type"]);
  if (type !== "booklet_batch" && type !== "thermal_purchase") {
    res.status(404).json({ error: "Unknown item" });
    return;
  }
  const p = payItemSchema.safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: p.error.issues[0]?.message ?? "Check the payment" });
    return;
  }
  const [acc] = await db.select().from(finMoneyAccountsTable).where(eq(finMoneyAccountsTable.id, p.data.accountId)).limit(1);
  if (!acc || !acc.isActive) {
    res.status(404).json({ error: "Choose an open account" });
    return;
  }
  const id = String(req.params["id"]);
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`supplier:${type}:${id}`}))`);
    const row = type === "booklet_batch"
      ? (await tx.select({ total: bookletBatchesTable.totalCost, confirmed: bookletBatchesTable.costConfirmed }).from(bookletBatchesTable).where(eq(bookletBatchesTable.id, id)).limit(1))[0]
      : (await tx.select({ total: thermalRollPurchasesTable.totalCost }).from(thermalRollPurchasesTable).where(eq(thermalRollPurchasesTable.id, id)).limit(1))[0];
    if (!row) return { error: "No such purchase", status: 404 };
    if ("confirmed" in row && !row.confirmed) return { error: "Confirm this batch's cost against the invoice before paying for it", status: 409 };
    const paid = Number(((await tx.execute(sql`SELECT coalesce(sum(amount), 0) AS paid FROM inventory_supplier_payments WHERE item_type = ${type} AND item_id = ${id}`)).rows[0] as { paid: string }).paid);
    const owed = Math.round((Number(row.total) - paid) * 100) / 100;
    if (Number(p.data.amount) > owed + 0.005) return { error: `Only GH₵${owed.toFixed(2)} is still owed on this purchase`, status: 409 };
    const [r] = await tx.insert(inventorySupplierPaymentsTable).values({
      itemType: type, itemId: id, amount: Number(p.data.amount).toFixed(2), paidOn: p.data.paidOn, method: p.data.method,
      accountId: acc.id, reference: p.data.reference || null, note: p.data.note || null, paidBy: req.user!.userId,
    }).returning();
    await audit(tx, { ...actorOf(req), action: "inventory.supplier_paid", entity: type, entityId: id, detail: p.data });
    return { row: r! };
  });
  if ("error" in outcome) {
    res.status(outcome.status ?? 409).json({ error: outcome.error });
    return;
  }
  await syncBooks(true);
  res.status(201).json(outcome.row);
});

const adjustmentSchema = z.object({
  adjustmentType: z.enum(["return_to_store", "damaged", "lost", "count_correction"]),
  quantity: z.number().int().refine((v) => v !== 0, "Enter a quantity"),
  agentId: z.string().uuid().optional().nullable(),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().min(5, "Say what happened").max(500),
});

/** Booklets returned to the store, damaged, lost, or found different on a count. */
router.post("/finance/inventory/booklet-adjustments", requireAuth, requireRole(...ALL3), async (req, res) => {
  const p = adjustmentSchema.safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: p.error.issues[0]?.message ?? "Check the adjustment" });
    return;
  }
  if (p.data.adjustmentType !== "count_correction" && p.data.quantity < 0) {
    res.status(400).json({ error: "Enter a positive quantity" });
    return;
  }
  if (p.data.adjustmentType === "return_to_store" && !p.data.agentId) {
    res.status(400).json({ error: "Say which agency returned them" });
    return;
  }
  const [r] = await db.transaction(async (tx) => {
    const rows = await tx.insert(bookletAdjustmentsTable).values({
      adjustmentType: p.data.adjustmentType, quantity: p.data.quantity, agentId: p.data.agentId || null,
      occurredOn: p.data.occurredOn, note: p.data.note, enteredBy: req.user!.userId,
    }).returning();
    await audit(tx, { ...actorOf(req), action: `inventory.booklets_${p.data.adjustmentType}`, entity: "booklet_adjustment", entityId: rows[0]!.id, detail: p.data });
    return rows;
  });
  res.status(201).json(r);
});

/* ── Salary schedules ─────────────────────────────────────────────────────── */

router.get("/finance/salary-schedules", requireAuth, requireRole(...ALL3), async (_req, res) => {
  await syncBooks();
  const [schedules, periods, funds] = await Promise.all([
    db.execute(sql`
      SELECT s.*, pu.full_name AS prepared_by_name, du.full_name AS decided_by_name,
             (SELECT coalesce(sum(net_amount), 0) FROM salary_payments sp WHERE sp.period_month = s.period_month AND sp.period_year = s.period_year AND sp.status = 'paid') AS paid_amount,
             (SELECT count(*)::int FROM salary_payments sp WHERE sp.period_month = s.period_month AND sp.period_year = s.period_year AND sp.status = 'paid') AS paid_count
        FROM salary_schedules s JOIN users pu ON pu.id = s.prepared_by LEFT JOIN users du ON du.id = s.decided_by
       ORDER BY s.period_year DESC, s.period_month DESC, s.submitted_at DESC`),
    db.execute(sql`
      SELECT period_year, period_month,
             count(*)::int AS staff, coalesce(sum(net_amount), 0) AS total,
             count(*) FILTER (WHERE status = 'paid')::int AS paid_count,
             coalesce(sum(net_amount) FILTER (WHERE status <> 'paid'), 0) AS unpaid
        FROM salary_payments GROUP BY 1, 2 ORDER BY 1 DESC, 2 DESC LIMIT 24`),
    fundBalances(),
  ]);
  const provision = funds.find((f) => f.code === "SALARY")?.balance ?? 0;
  const committed = (schedules.rows as Array<Record<string, unknown>>)
    .filter((s) => s.status === "submitted" || s.status === "approved")
    .reduce((t, s) => t + Math.max(0, Number(s.total_amount) - Number(s.paid_amount)), 0);
  res.json({
    schedules: schedules.rows,
    periods: periods.rows,
    provision,
    committedUnpaid: Math.round(committed * 100) / 100,
    shortfall: Math.round(Math.max(0, committed - provision) * 100) / 100,
  });
});

const submitSchema = z.object({ month: z.number().int().min(1).max(12), year: z.number().int().min(2020).max(2100), note: z.string().trim().max(500).optional().nullable() });

/**
 * The administrator submits a month's salaries - every unpaid salary line
 * generated for it - for the director's approval.
 */
router.post("/finance/salary-schedules", requireAuth, requireRole("administrator", "director"), async (req, res) => {
  const p = submitSchema.safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: "Choose the month" });
    return;
  }
  const lines = await db.select().from(salaryPaymentsTable)
    .where(and(eq(salaryPaymentsTable.periodMonth, p.data.month), eq(salaryPaymentsTable.periodYear, p.data.year)));
  const unpaid = lines.filter((l) => l.status !== "paid");
  if (!unpaid.length) {
    res.status(409).json({ error: "There are no unpaid salary lines for that month. Generate the month in Staff Payroll first." });
    return;
  }
  const total = Math.round(unpaid.reduce((s, l) => s + Number(l.netAmount), 0) * 100) / 100;
  try {
    const [row] = await db.transaction(async (tx) => {
      const rows = await tx.insert(salarySchedulesTable).values({
        periodMonth: p.data.month, periodYear: p.data.year, totalAmount: total.toFixed(2), staffCount: unpaid.length,
        preparedBy: req.user!.userId, note: p.data.note || null,
      }).returning();
      await audit(tx, { ...actorOf(req), action: "salary.schedule_submitted", entity: "salary_schedule", entityId: rows[0]!.id, detail: { ...p.data, total, staff: unpaid.length } });
      return rows;
    });
    const provision = (await fundBalances()).find((f) => f.code === "SALARY")?.balance ?? 0;
    const short = total - provision;
    await notifyRoles(["director"], req.user!.userId, `Salary schedule to approve — ${p.data.month}/${p.data.year}`,
      `${unpaid.length} salaries, GH₵${total.toFixed(2)}. Approve it in Finance & Statements › Payroll.${short > 0.005 ? ` The Salary Provision Fund holds GH₵${provision.toFixed(2)} - GH₵${short.toFixed(2)} short.` : ""}`);
    res.status(201).json(row);
  } catch {
    res.status(409).json({ error: "That month already has a schedule waiting or approved" });
  }
});

const decideSchema = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(500).optional().nullable() });

router.post("/finance/salary-schedules/:id/decide", requireAuth, requireRole("director"), async (req, res) => {
  const p = decideSchema.safeParse(req.body);
  if (!p.success || (p.data.decision === "reject" && !p.data.note)) {
    res.status(400).json({ error: "Approve, or reject with a reason" });
    return;
  }
  const id = String(req.params["id"]);
  const [s] = await db.select().from(salarySchedulesTable).where(eq(salarySchedulesTable.id, id)).limit(1);
  if (!s || s.status !== "submitted") {
    res.status(409).json({ error: "This schedule is not waiting for a decision" });
    return;
  }
  if (s.preparedBy === req.user!.userId) {
    res.status(403).json({ error: "The person who prepared a schedule cannot approve it" });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.update(salarySchedulesTable).set({
      status: p.data.decision === "approve" ? "approved" : "rejected", decidedBy: req.user!.userId, decidedAt: new Date(), decisionNote: p.data.note || null,
    }).where(eq(salarySchedulesTable.id, id));
    await audit(tx, { ...actorOf(req), action: `salary.schedule_${p.data.decision === "approve" ? "approved" : "rejected"}`, entity: "salary_schedule", entityId: id, note: p.data.note ?? null });
  });
  await notifyRoles(["administrator", "cashier"], req.user!.userId, `Salary schedule ${p.data.decision === "approve" ? "approved" : "rejected"} — ${s.periodMonth}/${s.periodYear}`,
    p.data.decision === "approve" ? `GH₵${Number(s.totalAmount).toFixed(2)} approved. Salaries for the month can now be paid from Staff Payroll.` : `Rejected: ${p.data.note}`);
  res.json({ ok: true });
});

export default router;
