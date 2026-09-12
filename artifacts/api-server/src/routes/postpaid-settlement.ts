import { Router } from "express";
import { db, postpaidDailyLedgerTable, writersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

const settleSchema = z.object({
  settlementMethod: z.enum(["momo", "cashier", "token_credit"]),
  settlementReference: z.string().optional(),
});

router.get("/postpaid/ledger", requireAuth, requireRole("director", "administrator", "cashier", "writer"), async (req, res) => {
  const writerId = req.user!.role === "writer" ? req.user!.userId : (req.query.writerId as string);
  const query = db.select().from(postpaidDailyLedgerTable);
  if (writerId) query.where(eq(postpaidDailyLedgerTable.writerId, writerId));
  
  const ledgers = await query.orderBy(desc(postpaidDailyLedgerTable.ledgerDate)).limit(100);
  res.json(ledgers);
});

router.get("/postpaid/outstanding", requireAuth, requireRole("director", "administrator", "cashier"), async (req, res) => {
  const ledgers = await db.select({
    ledger: postpaidDailyLedgerTable,
    writer: {
      fullName: writersTable.fullName,
      fullCode: writersTable.fullCode,
    }
  })
  .from(postpaidDailyLedgerTable)
  .leftJoin(writersTable, eq(postpaidDailyLedgerTable.writerId, writersTable.id))
  .where(eq(postpaidDailyLedgerTable.settlementStatus, "open"))
  .orderBy(desc(postpaidDailyLedgerTable.ledgerDate));
  
  res.json(ledgers);
});

router.post("/postpaid/settle/:ledgerId", requireAuth, requireRole("director", "administrator", "cashier"), async (req, res) => {
  const ledgerId = req.params["ledgerId"] as string;
  const parse = settleSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid data" });
    return;
  }
  
  const [ledger] = await db.select().from(postpaidDailyLedgerTable).where(eq(postpaidDailyLedgerTable.id, ledgerId)).limit(1);
  if (!ledger) {
    res.status(404).json({ error: "Ledger not found" });
    return;
  }

  const [updated] = await db.update(postpaidDailyLedgerTable)
    .set({
      settlementStatus: "settled",
      settledAt: new Date(),
      settlementMethod: parse.data.settlementMethod,
      settlementReference: parse.data.settlementReference
    })
    .where(eq(postpaidDailyLedgerTable.id, ledgerId))
    .returning();

  res.json(updated);
});

export default router;
