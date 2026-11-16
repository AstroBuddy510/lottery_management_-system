import { Router } from "express";
import { randomUUID } from "node:crypto";
import {
  db,
  finMoneyAccountsTable,
  finCashBookTable,
  finFundsTable,
  finFundMovementsTable,
  finBalanceChecksTable,
  finPaymentFeesTable,
} from "@workspace/db";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  syncBooks, moneyAccountBalances, fundBalances, financialPosition, audit, toNum, round2,
} from "../lib/finance/books";
import { syncFeesFromPaystack } from "../lib/finance/fees";
import { livePaystackBalance } from "../lib/finance/paystack-balance";
import { readWallet } from "../lib/master-wallet";

/**
 * Finance: the company's money accounts, its cash book, the earmarks inside
 * that money, Paystack's fees, and the checks that hold them together.
 *
 * Every read brings the books up to date first (syncBooks), so nothing here
 * ever shows a cash book that is behind the records it is generated from.
 */

const router = Router();

const MGMT = ["director", "administrator"] as const;
const CASH_READERS = ["director", "administrator", "cashier"] as const;

const money = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d{1,11}(\.\d{1,2})?$/.test(v) && Number(v) > 0, "Enter an amount above zero, to the pesewa");
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function synced() {
  await syncBooks();
}

const actorOf = (req: { user?: { userId: string; role: string } }) => ({
  actorUserId: req.user?.userId ?? null,
  actorRole: req.user?.role ?? null,
});

/* ── Position ─────────────────────────────────────────────────────────────── */

router.get("/finance/position", requireAuth, requireRole(...MGMT), async (_req, res) => {
  await synced();
  res.json(await financialPosition());
});

/* ── Money accounts ───────────────────────────────────────────────────────── */

router.get("/finance/accounts", requireAuth, requireRole(...CASH_READERS), async (_req, res) => {
  await synced();
  res.json(await moneyAccountBalances());
});

const accountSchema = z.object({
  name: z.string().trim().min(2).max(120),
  kind: z.enum(["bank", "cash", "momo", "other"]),
  institution: z.string().trim().max(120).optional().nullable(),
  accountRef: z.string().trim().max(60).optional().nullable(),
  openingBalance: z.union([z.string(), z.number()]).optional(),
  openingDate: dateOnly.optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

router.post("/finance/accounts", requireAuth, requireRole("director"), async (req, res) => {
  const p = accountSchema.safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: "Give the account a name and a type" });
    return;
  }
  const opening = p.data.openingBalance === undefined || p.data.openingBalance === "" ? "0" : String(p.data.openingBalance);
  if (!/^-?\d{1,11}(\.\d{1,2})?$/.test(opening)) {
    res.status(400).json({ error: "The opening balance must be an amount to the pesewa" });
    return;
  }
  if (Number(opening) !== 0 && !p.data.openingDate) {
    res.status(400).json({ error: "Say which date the opening balance is as at" });
    return;
  }
  const code = `${p.data.kind.toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`;
  const [row] = await db.transaction(async (tx) => {
    const rows = await tx.insert(finMoneyAccountsTable).values({
      code, name: p.data.name, kind: p.data.kind,
      institution: p.data.institution || null, accountRef: p.data.accountRef || null,
      openingBalance: Number(opening).toFixed(2), openingDate: p.data.openingDate || null,
      notes: p.data.notes || null, createdBy: req.user!.userId,
    }).returning();
    await audit(tx, { ...actorOf(req), action: "account.created", entity: "fin_money_account", entityId: rows[0]!.id,
      detail: { name: p.data.name, kind: p.data.kind, openingBalance: opening, openingDate: p.data.openingDate } });
    return rows;
  });
  res.status(201).json(row);
});

const accountPatch = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  institution: z.string().trim().max(120).optional().nullable(),
  accountRef: z.string().trim().max(60).optional().nullable(),
  isActive: z.boolean().optional(),
  notes: z.string().trim().max(500).optional().nullable(),
});

/** Descriptive fields only. An opening balance, once set, is corrected by an entry, never edited. */
router.patch("/finance/accounts/:id", requireAuth, requireRole("director"), async (req, res) => {
  const p = accountPatch.safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: "Nothing valid to change" });
    return;
  }
  const id = String(req.params["id"]);
  const [before] = await db.select().from(finMoneyAccountsTable).where(eq(finMoneyAccountsTable.id, id)).limit(1);
  if (!before) {
    res.status(404).json({ error: "No such account" });
    return;
  }
  if (before.isSystem && p.data.isActive === false) {
    res.status(409).json({ error: "Cash on hand and the Paystack balance cannot be closed" });
    return;
  }
  const [after] = await db.transaction(async (tx) => {
    const rows = await tx.update(finMoneyAccountsTable).set(p.data).where(eq(finMoneyAccountsTable.id, id)).returning();
    await audit(tx, { ...actorOf(req), action: "account.updated", entity: "fin_money_account", entityId: id,
      detail: { before: { name: before.name, institution: before.institution, accountRef: before.accountRef, isActive: before.isActive }, after: p.data } });
    return rows;
  });
  res.json(after);
});

/* ── Cash book ────────────────────────────────────────────────────────────── */

router.get("/finance/cash-book", requireAuth, requireRole(...CASH_READERS), async (req, res) => {
  await synced();
  const q = req.query as Record<string, string | undefined>;
  const from = q["from"] && /^\d{4}-\d{2}-\d{2}$/.test(q["from"]) ? q["from"] : null;
  const to = q["to"] && /^\d{4}-\d{2}-\d{2}$/.test(q["to"]) ? q["to"] : null;
  const where: SQL[] = [];
  if (from) where.push(sql`b.occurred_at >= ${from}::date`);
  if (to) where.push(sql`b.occurred_at < (${to}::date + 1)`);
  if (q["account"]) where.push(sql`b.account_id = ${q["account"]}::uuid`);
  if (q["category"]) where.push(sql`b.category = ${q["category"]}`);
  if (q["direction"] === "in" || q["direction"] === "out") where.push(sql`b.direction = ${q["direction"]}`);
  if (q["method"]) where.push(sql`b.method = ${q["method"]}`);
  const filter = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;

  const rows = await db.execute(sql`
    SELECT b.id, b.occurred_at, b.direction, b.amount, b.method, b.category, b.source_type, b.source_id, b.leg,
           b.party_type, b.party_label, b.reference, b.memo, b.reverses_id,
           a.code AS account_code, a.name AS account_name, u.full_name AS handled_by_name
      FROM fin_cash_book b
      JOIN fin_money_accounts a ON a.id = b.account_id
      LEFT JOIN users u ON u.id = b.handled_by
      ${filter}
     ORDER BY b.occurred_at DESC, b.created_at DESC
     LIMIT 5000`);

  // Opening balance for the period: the account opening figures plus every
  // movement before it. Only meaningful for one account or for all together.
  const accFilter = q["account"] ? sql`AND a.id = ${q["account"]}::uuid` : sql``;
  const before = from
    ? await db.execute(sql`
        SELECT coalesce((SELECT sum(opening_balance) FROM fin_money_accounts a WHERE true ${accFilter}), 0)
             + coalesce((SELECT sum(CASE WHEN b.direction = 'in' THEN b.amount ELSE -b.amount END)
                           FROM fin_cash_book b JOIN fin_money_accounts a ON a.id = b.account_id
                          WHERE b.occurred_at < ${from}::date ${accFilter}), 0) AS opening`)
    : await db.execute(sql`SELECT coalesce(sum(opening_balance), 0) AS opening FROM fin_money_accounts a WHERE true ${accFilter}`);

  const list = rows.rows as Array<Record<string, unknown>>;
  const totalIn = round2(list.filter((r) => r.direction === "in").reduce((s, r) => s + toNum(r.amount), 0));
  const totalOut = round2(list.filter((r) => r.direction === "out").reduce((s, r) => s + toNum(r.amount), 0));
  const opening = round2(toNum((before.rows[0] as Record<string, unknown>).opening));
  const filtered = Boolean(q["category"] || q["direction"] || q["method"]);
  res.json({
    rows: list,
    totals: { opening, in: totalIn, out: totalOut, closing: filtered ? null : round2(opening + totalIn - totalOut) },
    truncated: list.length === 5000,
  });
});

const MANUAL_CATEGORIES = {
  owner_capital: "in",
  loan_received: "in",
  other_income: "in",
  director_withdrawal: "out",
  loan_repayment: "out",
  bank_charge: "out",
  other_expense: "out",
} as const;

const manualSchema = z.object({
  accountId: z.string().uuid(),
  category: z.enum(Object.keys(MANUAL_CATEGORIES) as [keyof typeof MANUAL_CATEGORIES, ...Array<keyof typeof MANUAL_CATEGORIES>]),
  amount: money,
  occurredOn: dateOnly,
  method: z.enum(["cash", "bank", "momo", "cheque", "transfer"]),
  reference: z.string().trim().max(120).optional().nullable(),
  memo: z.string().trim().min(5, "Say what this money was").max(500),
  partyLabel: z.string().trim().max(160).optional().nullable(),
});

/**
 * Money that no other screen records: the director putting capital in, a
 * bank charge, a loan. Everything else is generated from its own record and
 * cannot be entered here, which is what stops the same cedi being booked twice.
 */
router.post("/finance/cash-book/manual", requireAuth, requireRole(...MGMT), async (req, res) => {
  const p = manualSchema.safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: p.error.issues[0]?.message ?? "Check the entry" });
    return;
  }
  const id = randomUUID();
  const [row] = await db.transaction(async (tx) => {
    const rows = await tx.insert(finCashBookTable).values({
      occurredAt: new Date(`${p.data.occurredOn}T12:00:00Z`),
      direction: MANUAL_CATEGORIES[p.data.category],
      amount: p.data.amount,
      accountId: p.data.accountId,
      method: p.data.method,
      category: p.data.category,
      sourceType: "manual",
      sourceId: id,
      partyLabel: p.data.partyLabel || null,
      reference: p.data.reference || null,
      memo: p.data.memo,
      handledBy: req.user!.userId,
      createdBy: req.user!.userId,
    }).returning();
    await audit(tx, { ...actorOf(req), action: "cash_book.manual_entry", entity: "fin_cash_book", entityId: rows[0]!.id, detail: p.data });
    return rows;
  });
  res.status(201).json(row);
});

const transferSchema = z.object({
  fromAccountId: z.string().uuid(),
  toAccountId: z.string().uuid(),
  amount: money,
  occurredOn: dateOnly,
  reference: z.string().trim().max(120).optional().nullable(),
  memo: z.string().trim().min(5, "Say what the transfer was for").max(500),
});

/** Money moving between two of the company's own accounts: one out, one in, same source. */
router.post("/finance/cash-book/transfer", requireAuth, requireRole(...MGMT), async (req, res) => {
  const p = transferSchema.safeParse(req.body);
  if (!p.success || p.data.fromAccountId === p.data.toAccountId) {
    res.status(400).json({ error: p.success ? "Choose two different accounts" : (p.error.issues[0]?.message ?? "Check the transfer") });
    return;
  }
  const balances = await moneyAccountBalances();
  const from = balances.find((a) => a.id === p.data.fromAccountId);
  const to = balances.find((a) => a.id === p.data.toAccountId);
  if (!from || !to) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  if (Number(p.data.amount) > from.balance + 0.005) {
    res.status(409).json({ error: `${from.name} holds GH₵${from.balance.toFixed(2)} on the books; it cannot send GH₵${p.data.amount}.` });
    return;
  }
  const id = randomUUID();
  const at = new Date(`${p.data.occurredOn}T12:00:00Z`);
  const common = {
    occurredAt: at, amount: p.data.amount, method: "transfer", category: "internal_transfer", sourceType: "transfer", sourceId: id,
    reference: p.data.reference || null, memo: p.data.memo, handledBy: req.user!.userId, createdBy: req.user!.userId,
  };
  await db.transaction(async (tx) => {
    await tx.insert(finCashBookTable).values([
      { ...common, direction: "out", accountId: from.id, leg: "out", partyLabel: `To ${to.name}` },
      { ...common, direction: "in", accountId: to.id, leg: "in", partyLabel: `From ${from.name}` },
    ]);
    await audit(tx, { ...actorOf(req), action: "cash_book.transfer", entity: "transfer", entityId: id, detail: p.data });
  });
  res.status(201).json({ ok: true, id });
});

const reverseSchema = z.object({ reason: z.string().trim().min(5).max(300) });

/**
 * Undo a manual entry or a transfer with an equal and opposite one. Entries
 * generated from another record are corrected at that record (void the
 * payment, and so on); the cash book follows.
 */
router.post("/finance/cash-book/:id/reverse", requireAuth, requireRole("director"), async (req, res) => {
  const p = reverseSchema.safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: "Give a reason for the reversal" });
    return;
  }
  const id = String(req.params["id"]);
  const [orig] = await db.select().from(finCashBookTable).where(eq(finCashBookTable.id, id)).limit(1);
  if (!orig) {
    res.status(404).json({ error: "No such entry" });
    return;
  }
  if (orig.sourceType !== "manual" && orig.sourceType !== "transfer") {
    res.status(409).json({ error: "This entry comes from another record. Correct that record and the cash book follows." });
    return;
  }
  if (orig.reversesId || orig.leg.startsWith("rev")) {
    res.status(409).json({ error: "A reversal cannot itself be reversed" });
    return;
  }
  const legs = await db.select().from(finCashBookTable)
    .where(and(eq(finCashBookTable.sourceType, orig.sourceType), eq(finCashBookTable.sourceId, orig.sourceId)));
  const originals = legs.filter((l) => !l.reversesId);
  if (legs.some((l) => l.reversesId)) {
    res.status(409).json({ error: "Already reversed" });
    return;
  }
  await db.transaction(async (tx) => {
    for (const l of originals) {
      await tx.insert(finCashBookTable).values({
        occurredAt: new Date(), direction: l.direction === "in" ? "out" : "in", amount: l.amount, accountId: l.accountId,
        method: l.method, category: l.category, sourceType: l.sourceType, sourceId: l.sourceId, leg: `rev-${l.leg}`,
        partyLabel: l.partyLabel, reference: l.reference, memo: `Reversal: ${p.data.reason}`, handledBy: req.user!.userId,
        createdBy: req.user!.userId, reversesId: l.id,
      });
    }
    await audit(tx, { ...actorOf(req), action: "cash_book.reversed", entity: "fin_cash_book", entityId: id, note: p.data.reason });
  });
  res.json({ ok: true });
});

/* ── Funds (earmarks) ─────────────────────────────────────────────────────── */

router.get("/finance/funds", requireAuth, requireRole(...CASH_READERS), async (_req, res) => {
  await synced();
  const funds = await fundBalances();
  const movements = await db.execute(sql`
    SELECT m.id, m.fund_code, m.entry_type, m.delta, m.reason, m.reference, m.source_type, m.occurred_at, u.full_name AS authorised_by_name
      FROM fin_fund_movements m LEFT JOIN users u ON u.id = m.authorised_by
     ORDER BY m.occurred_at DESC LIMIT 1000`);
  res.json({ funds, movements: movements.rows });
});

const fundSchema = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(500).optional().nullable(),
});

router.post("/finance/funds", requireAuth, requireRole("director"), async (req, res) => {
  const p = fundSchema.safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: "Give the fund a name" });
    return;
  }
  const code = p.data.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "FUND";
  const exists = await db.select().from(finFundsTable).where(eq(finFundsTable.code, code)).limit(1);
  if (exists.length) {
    res.status(409).json({ error: "A fund with that name already exists" });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.insert(finFundsTable).values({ code, name: p.data.name, description: p.data.description || null, createdBy: req.user!.userId });
    await audit(tx, { ...actorOf(req), action: "fund.created", entity: "fin_fund", entityId: code, detail: p.data });
  });
  res.status(201).json({ code });
});

const movementSchema = z.object({
  entryType: z.enum(["allocate", "release"]),
  amount: money,
  reason: z.string().trim().min(5).max(300),
  reference: z.string().trim().max(120).optional().nullable(),
});

/**
 * Set money aside in a custom fund, or let it go again. The Salary Provision
 * Fund is allocated from Staff Payroll, where its spending happens; the
 * Reserve is derived from the draws. Neither is moved by hand here.
 *
 * An allocation is refused when it would earmark more than the company
 * actually holds: a fund divides real money and cannot create any.
 */
router.post("/finance/funds/:code/movements", requireAuth, requireRole("director"), async (req, res) => {
  const code = String(req.params["code"]);
  const p = movementSchema.safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: p.error.issues[0]?.message ?? "Check the amount and reason" });
    return;
  }
  if (code === "SALARY" || code === "RESERVE") {
    res.status(409).json({ error: code === "SALARY" ? "Allocate salary money from Staff Payroll › Salary Provision" : "The reserve is set by the draw calculations" });
    return;
  }
  await synced();
  const pos = await financialPosition();
  const fund = pos.funds.find((f) => f.code === code);
  if (!fund) {
    res.status(404).json({ error: "No such fund" });
    return;
  }
  const amount = Number(p.data.amount);
  if (p.data.entryType === "allocate" && amount > pos.unallocated + 0.005) {
    res.status(409).json({ error: `Only GH₵${pos.unallocated.toFixed(2)} of the company's money is not already set aside.` });
    return;
  }
  if (p.data.entryType === "release" && amount > fund.balance + 0.005) {
    res.status(409).json({ error: `${fund.name} holds GH₵${fund.balance.toFixed(2)}.` });
    return;
  }
  await db.transaction(async (tx) => {
    const [m] = await tx.insert(finFundMovementsTable).values({
      fundCode: code, entryType: p.data.entryType,
      delta: (p.data.entryType === "allocate" ? amount : -amount).toFixed(2),
      reason: p.data.reason, reference: p.data.reference || null,
      sourceType: "manual", sourceId: randomUUID(), authorisedBy: req.user!.userId,
    }).returning();
    await audit(tx, { ...actorOf(req), action: `fund.${p.data.entryType}`, entity: "fin_fund_movement", entityId: m!.id, detail: { code, ...p.data } });
  });
  res.status(201).json({ ok: true });
});

/* ── Payment processing fees ──────────────────────────────────────────────── */

router.get("/finance/fees", requireAuth, requireRole(...MGMT), async (req, res) => {
  await synced();
  const q = req.query as Record<string, string | undefined>;
  const where: SQL[] = [];
  if (q["from"] && /^\d{4}-\d{2}-\d{2}$/.test(q["from"])) where.push(sql`occurred_at >= ${q["from"]}::date`);
  if (q["to"] && /^\d{4}-\d{2}-\d{2}$/.test(q["to"])) where.push(sql`occurred_at < (${q["to"]}::date + 1)`);
  const filter = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;
  const r = await db.execute(sql`
    SELECT f.*, u.full_name AS fee_set_by_name FROM fin_payment_fees f LEFT JOIN users u ON u.id = f.fee_set_by
    ${filter} ORDER BY occurred_at DESC LIMIT 5000`);
  const rows = r.rows as Array<Record<string, unknown>>;
  const known = rows.filter((x) => x.fee !== null);
  res.json({
    rows,
    totals: {
      count: rows.length,
      gross: round2(rows.reduce((s, x) => s + toNum(x.gross), 0)),
      fees: round2(known.reduce((s, x) => s + toNum(x.fee), 0)),
      unknown: rows.length - known.length,
      collectionFees: round2(known.filter((x) => x.kind === "collection").reduce((s, x) => s + toNum(x.fee), 0)),
      transferFees: round2(known.filter((x) => x.kind === "transfer").reduce((s, x) => s + toNum(x.fee), 0)),
    },
  });
});

router.post("/finance/fees/sync", requireAuth, requireRole(...MGMT), async (req, res) => {
  const result = await syncFeesFromPaystack(40);
  await audit(db, { ...actorOf(req), action: "fees.synced", entity: "fin_payment_fee", detail: result });
  await syncBooks(true);
  res.json(result);
});

const feeSetSchema = z.object({
  fee: z.union([z.string(), z.number()]).transform((v) => String(v).trim())
    .refine((v) => /^\d{1,9}(\.\d{1,2})?$/.test(v), "Enter the fee to the pesewa"),
  note: z.string().trim().min(5, "Say where the figure comes from (settlement report date, line)").max(300),
});

/**
 * The fee from Paystack's settlement report, for a reference whose fee
 * Paystack's API did not give. Only ever fills a blank: a known fee is
 * never overwritten.
 */
router.post("/finance/fees/:id/set", requireAuth, requireRole(...MGMT), async (req, res) => {
  const p = feeSetSchema.safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: p.error.issues[0]?.message ?? "Check the fee" });
    return;
  }
  const id = String(req.params["id"]);
  const updated = await db.transaction(async (tx) => {
    const rows = await tx.update(finPaymentFeesTable)
      .set({ fee: Number(p.data.fee).toFixed(2), capturedFrom: "settlement", feeSetBy: req.user!.userId, feeSetAt: new Date(), note: p.data.note })
      .where(and(eq(finPaymentFeesTable.id, id), sql`${finPaymentFeesTable.fee} IS NULL`))
      .returning();
    if (rows.length) {
      await audit(tx, { ...actorOf(req), action: "fees.set_from_settlement", entity: "fin_payment_fee", entityId: id, detail: p.data });
    }
    return rows[0];
  });
  if (!updated) {
    res.status(409).json({ error: "This fee is already recorded and cannot be changed" });
    return;
  }
  await syncBooks(true);
  res.json(updated);
});

/* ── Reconciliation against Paystack and counted cash ─────────────────────── */

/**
 * Three figures that must agree, side by side: what Paystack says it holds,
 * what the cash book says the Paystack account holds, and what the Master
 * Wallet claims of it.
 */
router.get("/finance/reconcile/paystack", requireAuth, requireRole(...MGMT), async (_req, res) => {
  await synced();
  const [live, accounts, wallet] = await Promise.all([livePaystackBalance(), moneyAccountBalances(), readWallet(db)]);
  const book = accounts.find((a) => a.code === "PAYSTACK")?.balance ?? 0;
  const walletClaims = round2(Number(wallet.available) + Number(wallet.held));
  const unknownFees = await db.execute(sql`SELECT count(*)::int AS n FROM fin_payment_fees WHERE fee IS NULL`);
  res.json({
    paystackLive: live,
    bookBalance: book,
    walletClaims,
    walletAvailable: Number(wallet.available),
    walletHeld: Number(wallet.held),
    differenceLiveVsBook: live === null ? null : round2(live - book),
    walletCovered: live === null ? null : walletClaims <= live + 0.005,
    feesAwaitingFigures: (unknownFees.rows[0] as { n: number }).n,
  });
});

router.get("/finance/balance-checks", requireAuth, requireRole(...CASH_READERS), async (_req, res) => {
  const r = await db.execute(sql`
    SELECT c.*, a.name AS account_name, a.code AS account_code, u.full_name AS entered_by_name
      FROM fin_balance_checks c JOIN fin_money_accounts a ON a.id = c.account_id LEFT JOIN users u ON u.id = c.entered_by
     ORDER BY c.as_of DESC LIMIT 500`);
  res.json(r.rows);
});

const checkSchema = z.object({
  accountId: z.string().uuid(),
  statementBalance: z.union([z.string(), z.number()]).transform((v) => String(v).trim())
    .refine((v) => /^-?\d{1,11}(\.\d{1,2})?$/.test(v), "Enter the balance to the pesewa"),
  note: z.string().trim().max(300).optional().nullable(),
});

/**
 * Record what an account actually holds - cash counted in the till, a bank
 * statement's closing figure - against the book. The difference is stored
 * with it, so a shortage is on record the day it was found.
 */
router.post("/finance/balance-checks", requireAuth, requireRole(...CASH_READERS), async (req, res) => {
  const p = checkSchema.safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: p.error.issues[0]?.message ?? "Check the figures" });
    return;
  }
  await syncBooks(true);
  const accounts = await moneyAccountBalances();
  const acc = accounts.find((a) => a.id === p.data.accountId);
  if (!acc) {
    res.status(404).json({ error: "No such account" });
    return;
  }
  if (req.user!.role === "cashier" && acc.code !== "CASH") {
    res.status(403).json({ error: "Cashiers record cash counts only" });
    return;
  }
  const statement = Number(p.data.statementBalance);
  const [row] = await db.transaction(async (tx) => {
    const rows = await tx.insert(finBalanceChecksTable).values({
      accountId: acc.id, asOf: new Date(), statementBalance: statement.toFixed(2), bookBalance: acc.balance.toFixed(2),
      difference: round2(statement - acc.balance).toFixed(2), source: "manual", note: p.data.note || null, enteredBy: req.user!.userId,
    }).returning();
    await audit(tx, { ...actorOf(req), action: "balance_check.recorded", entity: "fin_balance_check", entityId: rows[0]!.id,
      detail: { account: acc.code, statement, book: acc.balance } });
    return rows;
  });
  res.status(201).json(row);
});

/* ── Audit trail ──────────────────────────────────────────────────────────── */

router.get("/finance/audit", requireAuth, requireRole(...MGMT), async (_req, res) => {
  const r = await db.execute(sql`
    SELECT l.*, u.full_name AS actor_name FROM fin_audit_log l LEFT JOIN users u ON u.id = l.actor_user_id
     ORDER BY l.at DESC LIMIT 1000`);
  res.json(r.rows);
});

export default router;
