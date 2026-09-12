import { Router } from "express";
import { db, riskFlagsTable, writersTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

router.get("/risk/flags", requireAuth, requireRole("director", "administrator"), async (req, res) => {
  const flags = await db.select({
    flag: riskFlagsTable,
    writer: {
      fullName: writersTable.fullName,
      fullCode: writersTable.fullCode,
    }
  })
  .from(riskFlagsTable)
  .leftJoin(writersTable, eq(riskFlagsTable.writerId, writersTable.id))
  .orderBy(desc(riskFlagsTable.createdAt))
  .limit(100);
  
  res.json(flags);
});

router.patch("/risk/flags/:id", requireAuth, requireRole("director", "administrator"), async (req, res) => {
  const id = req.params["id"] as string;
  const parse = z.object({
    status: z.enum(["open", "reviewed", "dismissed", "escalated"]),
    reviewNotes: z.string().optional(),
  }).safeParse(req.body);
  
  if (!parse.success) {
    res.status(400).json({ error: "Invalid data" });
    return;
  }

  const [updated] = await db.update(riskFlagsTable)
    .set({
      status: parse.data.status,
      reviewNotes: parse.data.reviewNotes,
      reviewedBy: req.user!.userId,
      updatedAt: new Date(),
    })
    .where(eq(riskFlagsTable.id, id))
    .returning();

  res.json(updated);
});

router.get("/risk/dashboard", requireAuth, requireRole("director", "administrator"), async (req, res) => {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(riskFlagsTable).where(eq(riskFlagsTable.status, "open"));
  res.json({
    openFlags: count,
    // Add more stats as needed
  });
});

export default router;
