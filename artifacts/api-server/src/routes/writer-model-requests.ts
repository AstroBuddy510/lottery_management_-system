import { Router } from "express";
import {
  db,
  writerModelRequestsTable,
  writersTable,
  agentsTable,
  usersTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

/**
 * Who may decide a postpaid request.
 *
 * The agent owns the relationship and normally decides. Administrators and
 * cashiers can too - an agent may be unreachable, and a writer should not be
 * stuck because of it. Whoever decides is recorded, so the agent's agreement
 * being arranged off the platform is still traceable to the person who acted.
 */
const DECIDER_ROLES = ["agent", "administrator", "director", "cashier"] as const;

/** The agent row for a signed-in agent, or null for staff who see everything. */
async function agentScope(role: string, userId: string): Promise<string | null> {
  if (role !== "agent") return null;
  const [agent] = await db
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(eq(agentsTable.userId, userId))
    .limit(1);
  return agent?.id ?? "__none__";
}

/** Requests awaiting a decision, plus recent history. */
router.get(
  "/writer-model-requests",
  requireAuth,
  requireRole(...DECIDER_ROLES),
  async (req, res) => {
    const status = typeof req.query["status"] === "string" ? req.query["status"] : "pending";
    const scopedAgentId = await agentScope(req.user!.role, req.user!.userId);

    const conditions = [
      status === "all" ? undefined : eq(writerModelRequestsTable.status, status),
      scopedAgentId ? eq(writersTable.agentId, scopedAgentId) : undefined,
    ].filter(Boolean);

    const rows = await db
      .select({
        id: writerModelRequestsTable.id,
        requestedModel: writerModelRequestsTable.requestedModel,
        currentModel: writerModelRequestsTable.currentModel,
        status: writerModelRequestsTable.status,
        reason: writerModelRequestsTable.reason,
        decisionNote: writerModelRequestsTable.decisionNote,
        decidedByRole: writerModelRequestsTable.decidedByRole,
        decidedAt: writerModelRequestsTable.decidedAt,
        createdAt: writerModelRequestsTable.createdAt,
        decidedByName: usersTable.fullName,
        writerId: writersTable.id,
        writerName: writersTable.fullName,
        writerCode: writersTable.fullCode,
        writerPhone: writersTable.phone,
        agentCode: agentsTable.fullCode,
        agencyName: agentsTable.agencyName,
      })
      .from(writerModelRequestsTable)
      .innerJoin(writersTable, eq(writerModelRequestsTable.writerId, writersTable.id))
      .innerJoin(agentsTable, eq(writersTable.agentId, agentsTable.id))
      .leftJoin(usersTable, eq(writerModelRequestsTable.decidedBy, usersTable.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(writerModelRequestsTable.createdAt))
      .limit(200);

    res.json(rows);
  },
);

/**
 * Decide one request. Approving is what actually moves the writer onto
 * postpaid - the decision and the change are one transaction, so a writer can
 * never be told "approved" while still selling prepaid, or the reverse.
 */
router.patch(
  "/writer-model-requests/:id",
  requireAuth,
  requireRole(...DECIDER_ROLES),
  async (req, res) => {
    const id = req.params["id"] as string;
    const parse = z
      .object({
        decision: z.enum(["approved", "rejected"]),
        note: z.string().trim().max(500).optional(),
      })
      .safeParse(req.body);

    if (!parse.success) {
      res.status(400).json({ error: "Invalid decision", issues: parse.error.issues });
      return;
    }

    const [request] = await db
      .select({
        id: writerModelRequestsTable.id,
        status: writerModelRequestsTable.status,
        requestedModel: writerModelRequestsTable.requestedModel,
        writerId: writerModelRequestsTable.writerId,
        agentId: writersTable.agentId,
      })
      .from(writerModelRequestsTable)
      .innerJoin(writersTable, eq(writerModelRequestsTable.writerId, writersTable.id))
      .where(eq(writerModelRequestsTable.id, id))
      .limit(1);

    if (!request) {
      res.status(404).json({ error: "Request not found" });
      return;
    }

    // An agent may only decide their own writers'.
    const scopedAgentId = await agentScope(req.user!.role, req.user!.userId);
    if (scopedAgentId && request.agentId !== scopedAgentId) {
      res.status(404).json({ error: "Request not found" });
      return;
    }

    const result = await db.transaction(async (tx) => {
      // Re-checked inside the UPDATE so two deciders cannot both settle it.
      const [claimed] = await tx
        .update(writerModelRequestsTable)
        .set({
          status: parse.data.decision,
          decidedBy: req.user!.userId,
          decidedByRole: req.user!.role,
          decisionNote: parse.data.note ?? null,
          decidedAt: new Date(),
        })
        .where(
          and(
            eq(writerModelRequestsTable.id, id),
            eq(writerModelRequestsTable.status, "pending"),
          ),
        )
        .returning();

      if (!claimed) return null;

      if (parse.data.decision === "approved") {
        await tx
          .update(writersTable)
          .set({ operationModel: claimed.requestedModel })
          .where(eq(writersTable.id, claimed.writerId));
      }

      return claimed;
    });

    if (!result) {
      res.status(409).json({ error: `Request is already ${request.status}` });
      return;
    }

    res.json(result);
  },
);

export default router;
