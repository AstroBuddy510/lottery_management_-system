import { Router } from "express";
import {
  db,
  tokenPoolTable,
  tokenPoolTransactionsTable,
  cashierTokenWalletsTable,
  cashierTokenTransactionsTable,
  usersTable,
  writersTable,
  writerTokenWalletsTable,
} from "@workspace/db";
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

/**
 * E-token supply: pool -> cashier float -> writer wallet.
 *
 * Tokens are created only by minting into the company pool. Everything after
 * that is a transfer, so the totals always reconcile:
 *
 *   minted = pool balance + sum(cashier floats) + disbursed to writers
 */

const amountSchema = z.object({
  amount: z.number().positive().max(10_000_000),
  notes: z.string().max(500).optional(),
});

/** The pool is a single row; create it on first use rather than by migration. */
async function getOrCreatePool(tx: any) {
  const [existing] = await tx.select().from(tokenPoolTable).limit(1);
  if (existing) return existing;
  const [created] = await tx.insert(tokenPoolTable).values({}).returning();
  return created;
}

async function getOrCreateCashierWallet(tx: any, cashierId: string) {
  const [existing] = await tx
    .select()
    .from(cashierTokenWalletsTable)
    .where(eq(cashierTokenWalletsTable.cashierId, cashierId))
    .limit(1);
  if (existing) return existing;
  const [created] = await tx
    .insert(cashierTokenWalletsTable)
    .values({ cashierId })
    .returning();
  return created;
}

/** Pool state plus every cashier float, for the admin supply screen. */
router.get(
  "/tokens/supply",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (_req, res) => {
    const pool = await db.transaction((tx) => getOrCreatePool(tx));

    const floats = await db
      .select({
        cashierId: cashierTokenWalletsTable.cashierId,
        cashierName: usersTable.fullName,
        balance: cashierTokenWalletsTable.balance,
        totalReceived: cashierTokenWalletsTable.totalReceived,
        totalDisbursed: cashierTokenWalletsTable.totalDisbursed,
      })
      .from(cashierTokenWalletsTable)
      .innerJoin(usersTable, eq(cashierTokenWalletsTable.cashierId, usersTable.id))
      .orderBy(desc(cashierTokenWalletsTable.balance));

    // Cashiers who have never been issued anything still need to be selectable.
    const cashiers = await db
      .select({ id: usersTable.id, fullName: usersTable.fullName, role: usersTable.role })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.isActive, true),
          sql`${usersTable.role} in ('cashier', 'administrator', 'director')`,
        ),
      );

    const heldByCashiers = floats.reduce((s, f) => s + Number(f.balance), 0);
    const disbursed = floats.reduce((s, f) => s + Number(f.totalDisbursed), 0);

    res.json({
      pool,
      floats,
      cashiers,
      reconciliation: {
        totalMinted: pool.totalMinted,
        poolBalance: pool.balance,
        heldByCashiers: heldByCashiers.toFixed(2),
        disbursedToWriters: disbursed.toFixed(2),
        // Should be 0.00. Anything else means a ledger row is missing.
        variance: (
          Number(pool.totalMinted) -
          Number(pool.balance) -
          heldByCashiers -
          disbursed
        ).toFixed(2),
      },
    });
  },
);

/** Create new supply. This is the only thing that brings tokens into existence. */
router.post(
  "/tokens/pool/mint",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const parse = amountSchema.safeParse({ ...req.body, amount: Number(req.body?.amount) });
    if (!parse.success) {
      res.status(400).json({ error: "Enter a valid amount" });
      return;
    }
    const { amount, notes } = parse.data;

    const result = await db.transaction(async (tx) => {
      const pool = await getOrCreatePool(tx);
      const balance = Number(pool.balance) + amount;
      const [updated] = await tx
        .update(tokenPoolTable)
        .set({
          balance: balance.toFixed(2),
          totalMinted: (Number(pool.totalMinted) + amount).toFixed(2),
        })
        .where(eq(tokenPoolTable.id, pool.id))
        .returning();

      await tx.insert(tokenPoolTransactionsTable).values({
        transactionType: "mint",
        amount: amount.toFixed(2),
        balanceAfter: balance.toFixed(2),
        createdBy: req.user!.userId,
        ...(notes ? { notes } : {}),
      });
      return updated;
    });

    res.json({ pool: result });
  },
);

/** Move tokens from the pool into a cashier's float. */
router.post(
  "/tokens/pool/issue",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const parse = amountSchema
      .extend({ cashierId: z.string().min(1) })
      .safeParse({ ...req.body, amount: Number(req.body?.amount) });
    if (!parse.success) {
      res.status(400).json({ error: "Enter a valid cashier and amount" });
      return;
    }
    const { amount, cashierId, notes } = parse.data;

    const [cashier] = await db
      .select({ id: usersTable.id, fullName: usersTable.fullName })
      .from(usersTable)
      .where(eq(usersTable.id, cashierId))
      .limit(1);
    if (!cashier) {
      res.status(404).json({ error: "Cashier not found" });
      return;
    }

    try {
      const out = await db.transaction(async (tx) => {
        const pool = await getOrCreatePool(tx);
        if (Number(pool.balance) < amount) {
          // Issuing more than exists would break the reconciliation.
          throw new Error(`Pool has only ${Number(pool.balance).toFixed(2)} available`);
        }

        const poolBalance = Number(pool.balance) - amount;
        await tx
          .update(tokenPoolTable)
          .set({
            balance: poolBalance.toFixed(2),
            totalIssued: (Number(pool.totalIssued) + amount).toFixed(2),
          })
          .where(eq(tokenPoolTable.id, pool.id));

        await tx.insert(tokenPoolTransactionsTable).values({
          transactionType: "issue_to_cashier",
          amount: amount.toFixed(2),
          balanceAfter: poolBalance.toFixed(2),
          cashierId,
          createdBy: req.user!.userId,
          ...(notes ? { notes } : {}),
        });

        const wallet = await getOrCreateCashierWallet(tx, cashierId);
        const floatBalance = Number(wallet.balance) + amount;
        await tx
          .update(cashierTokenWalletsTable)
          .set({
            balance: floatBalance.toFixed(2),
            totalReceived: (Number(wallet.totalReceived) + amount).toFixed(2),
          })
          .where(eq(cashierTokenWalletsTable.cashierId, cashierId));

        await tx.insert(cashierTokenTransactionsTable).values({
          cashierId,
          transactionType: "receipt",
          amount: amount.toFixed(2),
          balanceAfter: floatBalance.toFixed(2),
          createdBy: req.user!.userId,
          ...(notes ? { notes } : {}),
        });

        return { poolBalance: poolBalance.toFixed(2), floatBalance: floatBalance.toFixed(2) };
      });

      res.json({ ...out, cashier: cashier.fullName });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  },
);

/** The signed-in cashier's own float and recent movements. */
router.get(
  "/tokens/my-float",
  requireAuth,
  requireRole("cashier", "administrator", "director"),
  async (req, res) => {
    const wallet = await db.transaction((tx) =>
      getOrCreateCashierWallet(tx, req.user!.userId),
    );
    const movements = await db
      .select()
      .from(cashierTokenTransactionsTable)
      .where(eq(cashierTokenTransactionsTable.cashierId, req.user!.userId))
      .orderBy(desc(cashierTokenTransactionsTable.createdAt))
      .limit(50);
    res.json({ wallet, movements });
  },
);

/**
 * Full-chain report: what was created, who holds it, where it went.
 * Optional from/to bounds the transaction lists; balances are always current.
 */
router.get(
  "/reports/tokens",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const from = typeof req.query["from"] === "string" ? req.query["from"] : undefined;
    const to = typeof req.query["to"] === "string" ? req.query["to"] : undefined;

    const poolWhere = [
      from ? gte(tokenPoolTransactionsTable.createdAt, new Date(from)) : undefined,
      to ? lte(tokenPoolTransactionsTable.createdAt, new Date(`${to}T23:59:59.999Z`)) : undefined,
    ].filter(Boolean);

    const poolTxns = await db
      .select({
        id: tokenPoolTransactionsTable.id,
        transactionType: tokenPoolTransactionsTable.transactionType,
        amount: tokenPoolTransactionsTable.amount,
        balanceAfter: tokenPoolTransactionsTable.balanceAfter,
        notes: tokenPoolTransactionsTable.notes,
        createdAt: tokenPoolTransactionsTable.createdAt,
        byName: usersTable.fullName,
      })
      .from(tokenPoolTransactionsTable)
      .innerJoin(usersTable, eq(tokenPoolTransactionsTable.createdBy, usersTable.id))
      .where(poolWhere.length ? and(...(poolWhere as never[])) : undefined)
      .orderBy(desc(tokenPoolTransactionsTable.createdAt))
      .limit(500);

    const cashierWhere = [
      from ? gte(cashierTokenTransactionsTable.createdAt, new Date(from)) : undefined,
      to ? lte(cashierTokenTransactionsTable.createdAt, new Date(`${to}T23:59:59.999Z`)) : undefined,
    ].filter(Boolean);

    const disbursements = await db
      .select({
        id: cashierTokenTransactionsTable.id,
        transactionType: cashierTokenTransactionsTable.transactionType,
        amount: cashierTokenTransactionsTable.amount,
        balanceAfter: cashierTokenTransactionsTable.balanceAfter,
        createdAt: cashierTokenTransactionsTable.createdAt,
        cashierName: usersTable.fullName,
        writerName: writersTable.fullName,
        writerCode: writersTable.fullCode,
      })
      .from(cashierTokenTransactionsTable)
      .innerJoin(usersTable, eq(cashierTokenTransactionsTable.cashierId, usersTable.id))
      .leftJoin(writersTable, eq(cashierTokenTransactionsTable.writerId, writersTable.id))
      .where(cashierWhere.length ? and(...(cashierWhere as never[])) : undefined)
      .orderBy(desc(cashierTokenTransactionsTable.createdAt))
      .limit(500);

    const pool = await db.transaction((tx) => getOrCreatePool(tx));

    const floats = await db
      .select({
        cashierName: usersTable.fullName,
        balance: cashierTokenWalletsTable.balance,
        totalReceived: cashierTokenWalletsTable.totalReceived,
        totalDisbursed: cashierTokenWalletsTable.totalDisbursed,
      })
      .from(cashierTokenWalletsTable)
      .innerJoin(usersTable, eq(cashierTokenWalletsTable.cashierId, usersTable.id))
      .orderBy(desc(cashierTokenWalletsTable.totalDisbursed));

    // What writers are actually holding right now.
    const [writerHoldings] = await db
      .select({
        held: sql<string>`coalesce(sum(${writerTokenWalletsTable.balance}), 0)::text`,
        purchased: sql<string>`coalesce(sum(${writerTokenWalletsTable.totalPurchased}), 0)::text`,
        spent: sql<string>`coalesce(sum(${writerTokenWalletsTable.totalSpent}), 0)::text`,
      })
      .from(writerTokenWalletsTable);

    const heldByCashiers = floats.reduce((s, f) => s + Number(f.balance), 0);
    const disbursedTotal = floats.reduce((s, f) => s + Number(f.totalDisbursed), 0);

    res.json({
      pool,
      floats,
      writerHoldings,
      summary: {
        totalMinted: pool.totalMinted,
        poolBalance: pool.balance,
        heldByCashiers: heldByCashiers.toFixed(2),
        disbursedToWriters: disbursedTotal.toFixed(2),
        variance: (
          Number(pool.totalMinted) -
          Number(pool.balance) -
          heldByCashiers -
          disbursedTotal
        ).toFixed(2),
      },
      poolTransactions: poolTxns,
      cashierTransactions: disbursements,
    });
  },
);

export default router;
