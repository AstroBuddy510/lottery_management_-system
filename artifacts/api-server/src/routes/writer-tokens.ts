import { Router } from "express";
import { db, writerTokenWalletsTable, writerTokenTransactionsTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middleware/auth";
import { adjustWallet } from "../lib/wallet";

const router = Router();

const adjustTokensSchema = z.object({
  writerId: z.string().uuid(),
  amount: z.number(), // positive or negative
  description: z.string().optional(),
});

router.get("/writer-tokens/balance", requireAuth, requireRole("writer"), async (req, res) => {
  const writerId = req.user!.userId;
  const [wallet] = await db.select().from(writerTokenWalletsTable).where(eq(writerTokenWalletsTable.writerId, writerId)).limit(1);
  
  if (!wallet) {
    res.json({ balance: "0.00", totalPurchased: "0.00", totalSpent: "0.00" });
    return;
  }
  res.json(wallet);
});

router.get("/writer-tokens/transactions", requireAuth, requireRole("writer", "administrator", "director"), async (req, res) => {
  // If writer, fetch own. If admin, fetch all (or support ?writerId query param)
  const writerId = req.user!.role === "writer" ? req.user!.userId : (req.query.writerId as string);
  
  if (!writerId && req.user!.role === "writer") {
    res.status(400).json({ error: "writerId required" });
    return;
  }

  const query = db.select().from(writerTokenTransactionsTable);
  if (writerId) {
    query.where(eq(writerTokenTransactionsTable.writerId, writerId));
  }
  const transactions = await query.orderBy(desc(writerTokenTransactionsTable.createdAt)).limit(100);
  res.json(transactions);
});

/**
 * The writer's own wallet history for the Wallet page, split the way they
 * read it: today first, earlier days folded away and paged.
 *
 *   ?scope=today  Every transaction on the current Accra day.
 *   ?scope=past   Earlier days, newest first, a page of whole days at a time
 *                 (?page=1&pageSize=7). Paging by day, not by row, keeps each
 *                 day's entries and total together on one page. The plain
 *                 list stopped at the latest hundred rows; this reaches back
 *                 to the first.
 */
const ACCRA_DAY = sql`(${writerTokenTransactionsTable.createdAt} AT TIME ZONE 'Africa/Accra')::date`;
const ACCRA_TODAY = sql`(now() AT TIME ZONE 'Africa/Accra')::date`;

router.get("/writer-tokens/transactions/mine", requireAuth, requireRole("writer"), async (req, res) => {
  const writerId = req.user!.userId;
  const mine = eq(writerTokenTransactionsTable.writerId, writerId);

  if (req.query["scope"] !== "past") {
    const rows = await db
      .select()
      .from(writerTokenTransactionsTable)
      .where(and(mine, sql`${ACCRA_DAY} = ${ACCRA_TODAY}`))
      .orderBy(desc(writerTokenTransactionsTable.createdAt))
      .limit(500);
    res.json({ rows });
    return;
  }

  const pageSize = Math.min(31, Math.max(1, Number.parseInt(String(req.query["pageSize"] ?? "7"), 10) || 7));
  const page = Math.max(1, Number.parseInt(String(req.query["page"] ?? "1"), 10) || 1);
  const earlier = and(mine, sql`${ACCRA_DAY} < ${ACCRA_TODAY}`);

  const [{ totalDays, totalEntries }] = await db
    .select({
      totalDays: sql<number>`count(DISTINCT ${ACCRA_DAY})::int`,
      totalEntries: sql<number>`count(*)::int`,
    })
    .from(writerTokenTransactionsTable)
    .where(earlier);
  const totalPages = Math.max(1, Math.ceil(totalDays / pageSize));
  const current = Math.min(page, totalPages);

  const days = await db
    .select({
      day: sql<string>`${ACCRA_DAY}::text`,
      entries: sql<number>`count(*)::int`,
      net: sql<string>`sum(${writerTokenTransactionsTable.amount})::text`,
    })
    .from(writerTokenTransactionsTable)
    .where(earlier)
    .groupBy(ACCRA_DAY)
    .orderBy(sql`${ACCRA_DAY} DESC`)
    .limit(pageSize)
    .offset((current - 1) * pageSize);

  const rows = days.length
    ? await db
        .select()
        .from(writerTokenTransactionsTable)
        .where(and(earlier, sql`${ACCRA_DAY} IN (${sql.join(days.map((d) => sql`${d.day}::date`), sql`, `)})`))
        .orderBy(desc(writerTokenTransactionsTable.createdAt))
    : [];

  res.json({ days, rows, totalDays, totalEntries, page: current, pageSize, totalPages });
});

// Admin endpoint to adjust tokens manually
router.post("/writer-tokens/adjust", requireAuth, requireRole("director", "administrator"), async (req, res) => {
  const parse = adjustTokensSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { writerId, amount, description } = parse.data;

  const result = await db.transaction(async (tx) => {
    // One statement, so a correction cannot be lost against a sale landing at
    // the same moment. Null means a deduction would take the float below
    // zero - refused here, with a sentence an administrator can act on,
    // rather than left to surface as a constraint violation.
    const newBalance = await adjustWallet(tx, writerId, amount);
    if (newBalance === null) {
      throw new Error("INSUFFICIENT_FUNDS");
    }

    const [transaction] = await tx.insert(writerTokenTransactionsTable)
      .values({
        writerId,
        transactionType: "admin_adjustment",
        amount: amount.toString(),
        balanceAfter: newBalance,
        description: description || "Manual adjustment",
        createdBy: req.user!.userId,
      })
      .returning();
      
    return transaction;
  });

  res.json(result);
});

export default router;
