import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Exec = { execute: (q: SQL) => Promise<any> };

const n = (v: unknown) => {
  const x = parseFloat(String(v ?? "0"));
  return Number.isFinite(x) ? x : 0;
};
const r2 = (x: number) => Math.round(x * 100) / 100;

/*
 * Stock at cost.
 *
 * Accounting policy, as implemented:
 *  - A purchase is inventory at its invoice cost, and a supplier payable
 *    until it is paid.
 *  - Booklets are expensed as they are used: a booklet counts as consumed
 *    when a gross entry records it (the booklets_count on each entry).
 *    Thermal rolls are expensed when an agent hands them to a writer.
 *  - Damaged and lost booklets are written off when recorded.
 *  - Cost is the weighted average of every batch bought. Batches whose cost
 *    has not been checked against the invoice are flagged, and so is every
 *    figure that depends on them.
 */

export async function bookletStock(exec: Exec = db) {
  const batches = (await exec.execute(sql`
    SELECT b.id, b.batch_date, b.quantity, b.total_cost, b.cost_per_booklet, b.description, b.supplier, b.invoice_ref,
           b.serial_from, b.serial_to, b.cost_confirmed, b.cost_confirmed_at, u.full_name AS cost_confirmed_by_name,
           coalesce((SELECT sum(amount) FROM inventory_supplier_payments p WHERE p.item_type = 'booklet_batch' AND p.item_id = b.id), 0) AS paid
      FROM booklet_batches b LEFT JOIN users u ON u.id = b.cost_confirmed_by
     ORDER BY b.batch_date DESC, b.created_at DESC`)).rows as Array<Record<string, unknown>>;
  const q = (await exec.execute(sql`
    SELECT (SELECT coalesce(sum(quantity), 0) FROM booklet_allocations) AS issued_to_agents,
           (SELECT coalesce(sum(booklets_count), 0) FROM gross_entries) AS consumed,
           (SELECT coalesce(sum(quantity) FILTER (WHERE adjustment_type = 'return_to_store'), 0) FROM booklet_adjustments) AS returned,
           (SELECT coalesce(sum(quantity) FILTER (WHERE adjustment_type = 'damaged'), 0) FROM booklet_adjustments) AS damaged,
           (SELECT coalesce(sum(quantity) FILTER (WHERE adjustment_type = 'lost'), 0) FROM booklet_adjustments) AS lost,
           (SELECT coalesce(sum(quantity) FILTER (WHERE adjustment_type = 'count_correction'), 0) FROM booklet_adjustments) AS corrections,
           (SELECT coalesce(sum(quantity) FILTER (WHERE adjustment_type IN ('damaged', 'lost') AND agent_id IS NULL), 0) FROM booklet_adjustments) AS written_off_in_store,
           (SELECT coalesce(sum(quantity) FILTER (WHERE adjustment_type = 'count_correction' AND agent_id IS NULL), 0) FROM booklet_adjustments) AS store_corrections`)).rows[0] as Record<string, unknown>;

  const purchased = batches.reduce((s, b) => s + n(b.quantity), 0);
  const totalCost = r2(batches.reduce((s, b) => s + n(b.total_cost), 0));
  const avgCost = purchased > 0 ? totalCost / purchased : 0;
  const consumed = n(q.consumed);
  const damaged = n(q.damaged);
  const lost = n(q.lost);
  const corrections = n(q.corrections);
  const remaining = purchased - consumed - damaged - lost + corrections;
  const inStore = purchased - n(q.issued_to_agents) + n(q.returned) - n(q.written_off_in_store) + n(q.store_corrections);
  const paid = r2(batches.reduce((s, b) => s + n(b.paid), 0));
  return {
    batches: batches.map((b) => ({
      id: String(b.id), batchDate: String(b.batch_date).slice(0, 10), quantity: n(b.quantity), totalCost: n(b.total_cost),
      unitCost: n(b.quantity) > 0 ? n(b.total_cost) / n(b.quantity) : 0, description: (b.description as string) ?? null,
      supplier: (b.supplier as string) ?? null, invoiceRef: (b.invoice_ref as string) ?? null,
      serialFrom: (b.serial_from as string) ?? null, serialTo: (b.serial_to as string) ?? null,
      costConfirmed: Boolean(b.cost_confirmed), costConfirmedAt: (b.cost_confirmed_at as string) ?? null, costConfirmedBy: (b.cost_confirmed_by_name as string) ?? null,
      paid: n(b.paid), payable: r2(n(b.total_cost) - n(b.paid)),
    })),
    quantities: {
      purchased, issuedToAgents: n(q.issued_to_agents), returned: n(q.returned), consumed, damaged, lost, corrections,
      remaining, inStore, withAgents: remaining - inStore,
    },
    avgCost,
    totalCost,
    consumedCost: r2(consumed * avgCost),
    writtenOffCost: r2((damaged + lost) * avgCost),
    stockValue: r2(remaining * avgCost),
    paid,
    payable: r2(totalCost - paid),
    unconfirmedBatches: batches.filter((b) => !b.cost_confirmed).length,
  };
}

export async function thermalStock(exec: Exec = db) {
  const purchases = (await exec.execute(sql`
    SELECT p.id, p.purchase_date, p.boxes, p.rolls_per_box, p.total_rolls, p.total_cost, p.supplier, p.invoice_ref,
           coalesce((SELECT sum(amount) FROM inventory_supplier_payments s WHERE s.item_type = 'thermal_purchase' AND s.item_id = p.id), 0) AS paid
      FROM thermal_roll_purchases p ORDER BY p.purchase_date DESC, p.created_at DESC`)).rows as Array<Record<string, unknown>>;
  const q = (await exec.execute(sql`
    SELECT (SELECT coalesce(sum(quantity), 0) FROM thermal_roll_allotments) AS allotted,
           (SELECT coalesce(sum(quantity), 0) FROM thermal_roll_distributions) AS distributed`)).rows[0] as Record<string, unknown>;
  const rolls = purchases.reduce((s, p) => s + n(p.total_rolls), 0);
  const totalCost = r2(purchases.reduce((s, p) => s + n(p.total_cost), 0));
  const avgCost = rolls > 0 ? totalCost / rolls : 0;
  const distributed = n(q.distributed);
  const paid = r2(purchases.reduce((s, p) => s + n(p.paid), 0));
  return {
    purchases: purchases.map((p) => ({
      id: String(p.id), purchaseDate: String(p.purchase_date).slice(0, 10), boxes: n(p.boxes), rollsPerBox: n(p.rolls_per_box),
      totalRolls: n(p.total_rolls), totalCost: n(p.total_cost), supplier: (p.supplier as string) ?? null, invoiceRef: (p.invoice_ref as string) ?? null,
      paid: n(p.paid), payable: r2(n(p.total_cost) - n(p.paid)),
    })),
    quantities: { purchased: rolls, allotted: n(q.allotted), distributed, inStore: rolls - n(q.allotted), withAgents: n(q.allotted) - distributed, remaining: rolls - distributed },
    avgCost,
    totalCost,
    usedCost: r2(distributed * avgCost),
    stockValue: r2((rolls - distributed) * avgCost),
    paid,
    payable: r2(totalCost - paid),
  };
}
