import { Router } from "express";
import { db, writerTokenWalletsTable, writerTokenTransactionsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
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
