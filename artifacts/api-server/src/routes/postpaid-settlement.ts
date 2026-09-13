import { Router } from "express";
import { db, postpaidDailyLedgerTable, writersTable, gamesTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
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

/**
 * What a postpaid writer owes for a closed draw.
 *
 * Stakes they took are the company's money; wins they paid out come back off
 * that. The difference is what they hand in. Only draws that have actually
 * closed are reported - quoting a settlement figure mid-draw would be wrong
 * the moment the next ticket is sold.
 */
router.get("/postpaid/my-settlement", requireAuth, requireRole("writer"), async (req, res) => {
  const writerId = req.user!.userId;
  const gameId = typeof req.query["gameId"] === "string" ? req.query["gameId"] : undefined;

  const [writer] = await db
    .select({ operationModel: writersTable.operationModel, fullName: writersTable.fullName })
    .from(writersTable)
    .where(eq(writersTable.id, writerId))
    .limit(1);

  if (!writer || writer.operationModel !== "postpaid") {
    res.json({ applicable: false, settlements: [] });
    return;
  }

  const conditions = [
    eq(postpaidDailyLedgerTable.writerId, writerId),
    eq(postpaidDailyLedgerTable.settlementStatus, "open"),
    // A draw only settles once it is closed.
    sql`${gamesTable.status} = 'closed'`,
  ];
  if (gameId) conditions.push(eq(postpaidDailyLedgerTable.gameId, gameId));

  const rows = await db
    .select({
      ledgerId: postpaidDailyLedgerTable.id,
      ledgerDate: postpaidDailyLedgerTable.ledgerDate,
      totalStakes: postpaidDailyLedgerTable.totalStakes,
      totalWinnings: postpaidDailyLedgerTable.totalWinnings,
      netBalance: postpaidDailyLedgerTable.netBalance,
      gameId: postpaidDailyLedgerTable.gameId,
      gameName: gamesTable.name,
      eventNumber: gamesTable.eventNumber,
      closedAt: gamesTable.closedAt,
    })
    .from(postpaidDailyLedgerTable)
    .innerJoin(gamesTable, eq(postpaidDailyLedgerTable.gameId, gamesTable.id))
    .where(and(...(conditions as never[])))
    .orderBy(desc(postpaidDailyLedgerTable.ledgerDate));

  const totalPayable = rows.reduce((sum, r) => sum + Number(r.netBalance), 0);

  res.json({
    applicable: true,
    writerName: writer.fullName,
    totalPayable: totalPayable.toFixed(2),
    settlements: rows,
  });
});

export default router;
