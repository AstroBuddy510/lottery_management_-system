import { Router } from "express";
import { db, writersTable, agentsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

const decisionSchema = z.object({
  reason: z.string().max(500).optional(),
});

/**
 * Writers awaiting approval, newest first. Joined to the agent so the review
 * screen can show who the writer is attached to.
 */
router.get(
  "/writers/pending",
  requireAuth,
  requireRole("director", "administrator", "agent"),
  async (req, res) => {
    const rows = await db
      .select({
        id: writersTable.id,
        fullName: writersTable.fullName,
        phone: writersTable.phone,
        fullCode: writersTable.fullCode,
        idType: writersTable.idType,
        idNumber: writersTable.idNumber,
        operationModel: writersTable.operationModel,
        registrationSource: writersTable.registrationSource,
        approvalStatus: writersTable.approvalStatus,
        createdAt: writersTable.createdAt,
        agentId: writersTable.agentId,
        agencyName: agentsTable.agencyName,
        agentFullCode: agentsTable.fullCode,
      })
      .from(writersTable)
      .leftJoin(agentsTable, eq(writersTable.agentId, agentsTable.id))
      .where(eq(writersTable.approvalStatus, "pending"))
      .orderBy(desc(writersTable.createdAt));

    // An agent may only review writers attached to their own agency.
    if (req.user!.role === "agent") {
      const [myAgent] = await db
        .select({ id: agentsTable.id })
        .from(agentsTable)
        .where(eq(agentsTable.userId, req.user!.userId))
        .limit(1);
      if (!myAgent) {
        res.json([]);
        return;
      }
      res.json(rows.filter((r) => r.agentId === myAgent.id));
      return;
    }

    res.json(rows);
  },
);

async function decide(
  writerId: string,
  nextStatus: "approved" | "rejected",
  reviewerId: string,
  reviewerRole: string,
): Promise<{ ok: true; writer: typeof writersTable.$inferSelect } | { ok: false; status: number; error: string }> {
  const [writer] = await db
    .select()
    .from(writersTable)
    .where(eq(writersTable.id, writerId))
    .limit(1);

  if (!writer) {
    return { ok: false, status: 404, error: "Writer not found" };
  }
  if (writer.approvalStatus !== "pending") {
    // Already decided - don't silently flip an existing decision.
    return {
      ok: false,
      status: 409,
      error: `Writer is already ${writer.approvalStatus}`,
    };
  }

  if (reviewerRole === "agent") {
    const [myAgent] = await db
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(eq(agentsTable.userId, reviewerId))
      .limit(1);
    if (!myAgent || myAgent.id !== writer.agentId) {
      return { ok: false, status: 403, error: "Access denied" };
    }
  }

  const [updated] = await db
    .update(writersTable)
    .set({
      approvalStatus: nextStatus,
      // Directors, administrators and agents all have a users.id, which is
      // what approved_by references.
      approvedBy: reviewerId,
      isActive: nextStatus === "approved" ? writer.isActive : false,
    })
    .where(
      // Re-check status in the WHERE so two concurrent reviewers can't both win.
      and(eq(writersTable.id, writerId), eq(writersTable.approvalStatus, "pending")),
    )
    .returning();

  if (!updated) {
    return { ok: false, status: 409, error: "Writer was reviewed by someone else" };
  }
  return { ok: true, writer: updated };
}

router.patch(
  "/writers/:writerId/approve",
  requireAuth,
  requireRole("director", "administrator", "agent"),
  async (req, res) => {
    const writerId = req.params["writerId"] as string;
    const result = await decide(writerId, "approved", req.user!.userId, req.user!.role);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json(result.writer);
  },
);

router.patch(
  "/writers/:writerId/reject",
  requireAuth,
  requireRole("director", "administrator", "agent"),
  async (req, res) => {
    const writerId = req.params["writerId"] as string;
    const parse = decisionSchema.safeParse(req.body ?? {});
    if (!parse.success) {
      res.status(400).json({ error: "Invalid data", details: parse.error.issues });
      return;
    }
    const result = await decide(writerId, "rejected", req.user!.userId, req.user!.role);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json(result.writer);
  },
);

export default router;
