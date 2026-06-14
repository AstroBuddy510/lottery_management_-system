import { Router } from "express";
import { z } from "zod/v4";
import {
  db,
  entryChangeRequestsTable,
  grossEntriesTable,
  winsEntriesTable,
  writersTable,
  agentsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";
import { dispatchSystemNotification } from "../lib/notify";
import { verifyLedgerAndEscalate } from "../lib/accountant";

const router = Router();

const CreateSchema = z.object({
  entryType: z.enum(["gross", "wins"]),
  entryId: z.string().uuid(),
  requestedAmount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  reason: z.string().min(5),
});

const AdminReviewSchema = z.object({
  action: z.enum(["approve", "reject"]),
  note: z.string().optional(),
});

const DirectorReviewSchema = z.object({
  action: z.enum(["approve", "reject"]),
  note: z.string().optional(),
});

async function enrichRequests(rows: (typeof entryChangeRequestsTable.$inferSelect)[]) {
  if (rows.length === 0) return [];

  const writerIds = [...new Set(rows.map((r) => r.writerId))];
  const writerRows = await db
    .select({ id: writersTable.id, fullCode: writersTable.fullCode, fullName: writersTable.fullName, agentId: writersTable.agentId })
    .from(writersTable)
    .where(inArray(writersTable.id, writerIds));
  const writerMap = new Map(writerRows.map((w) => [w.id, w]));

  const agentIds = [...new Set(writerRows.map((w) => w.agentId))];
  const agentRows = agentIds.length
    ? await db
        .select({ id: agentsTable.id, fullCode: agentsTable.fullCode, userId: agentsTable.userId })
        .from(agentsTable)
        .where(inArray(agentsTable.id, agentIds))
    : [];
  const agentMap = new Map(agentRows.map((a) => [a.id, a]));

  const userIds = [...new Set([
    ...rows.map((r) => r.requestedBy),
    ...rows.filter((r) => r.reviewedByAdmin).map((r) => r.reviewedByAdmin!),
    ...rows.filter((r) => r.reviewedByDirector).map((r) => r.reviewedByDirector!),
    ...agentRows.map((a) => a.userId),
  ])];
  const userRows = userIds.length
    ? await db
        .select({ id: usersTable.id, fullName: usersTable.fullName })
        .from(usersTable)
        .where(inArray(usersTable.id, userIds))
    : [];
  const userMap = new Map(userRows.map((u) => [u.id, u.fullName]));

  return rows.map((r) => {
    const writer = writerMap.get(r.writerId);
    const agent = writer ? agentMap.get(writer.agentId) : undefined;
    return {
      ...r,
      writerFullCode: writer?.fullCode ?? null,
      writerFullName: writer?.fullName ?? null,
      agentFullCode: agent?.fullCode ?? null,
      agentName: agent ? userMap.get(agent.userId) ?? null : null,
      requestedByName: userMap.get(r.requestedBy) ?? null,
      reviewedByAdminName: r.reviewedByAdmin ? (userMap.get(r.reviewedByAdmin) ?? null) : null,
      reviewedByDirectorName: r.reviewedByDirector ? (userMap.get(r.reviewedByDirector) ?? null) : null,
    };
  });
}

// ── GET /entries/change-requests ─────────────────────────────────────────────
router.get(
  "/entries/change-requests",
  requireAuth,
  requireRole("agent", "administrator", "director"),
  async (req, res) => {
    const { status } = req.query as Record<string, string>;

    let rows = await db.select().from(entryChangeRequestsTable);

    // Agent sees only their own requests
    if (req.user!.role === "agent") {
      rows = rows.filter((r) => r.requestedBy === req.user!.userId);
    }

    if (status) {
      rows = rows.filter((r) => r.status === status);
    }

    rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    res.json(await enrichRequests(rows));
  },
);

// ── POST /entries/change-requests ─────────────────────────────────────────────
router.post(
  "/entries/change-requests",
  requireAuth,
  requireRole("agent"),
  async (req, res) => {
    const parse = CreateSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid request body", issues: parse.error.issues });
      return;
    }
    const { entryType, entryId, requestedAmount, reason } = parse.data;

    // Fetch the entry and verify it is locked (query each table separately for type safety)
    let entryWriterId: string;
    let entryDate: string;
    let currentAmount: string;

    if (entryType === "gross") {
      const [grossEntry] = await db
        .select()
        .from(grossEntriesTable)
        .where(eq(grossEntriesTable.id, entryId))
        .limit(1);
      if (!grossEntry) { res.status(404).json({ error: "Entry not found" }); return; }
      if (!grossEntry.locked) { res.status(400).json({ error: "Entry is not locked — edit it directly" }); return; }
      entryWriterId = grossEntry.writerId;
      entryDate = grossEntry.entryDate;
      currentAmount = grossEntry.grossAmount;
    } else {
      const [winsEntry] = await db
        .select()
        .from(winsEntriesTable)
        .where(eq(winsEntriesTable.id, entryId))
        .limit(1);
      if (!winsEntry) { res.status(404).json({ error: "Entry not found" }); return; }
      if (!winsEntry.locked) { res.status(400).json({ error: "Entry is not locked — edit it directly" }); return; }
      entryWriterId = winsEntry.writerId;
      entryDate = winsEntry.entryDate;
      currentAmount = winsEntry.winsAmount;
    }

    // Verify writer belongs to the requesting agent
    const [agentRow] = await db
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(eq(agentsTable.userId, req.user!.userId))
      .limit(1);
    if (!agentRow) {
      res.status(403).json({ error: "No agent profile found" });
      return;
    }
    const [writer] = await db
      .select({ id: writersTable.id })
      .from(writersTable)
      .where(and(eq(writersTable.id, entryWriterId), eq(writersTable.agentId, agentRow.id)))
      .limit(1);
    if (!writer) {
      res.status(403).json({ error: "Writer does not belong to your account" });
      return;
    }

    // Block duplicate pending requests for same entry
    const existing = await db
      .select({ id: entryChangeRequestsTable.id })
      .from(entryChangeRequestsTable)
      .where(
        and(
          eq(entryChangeRequestsTable.entryId, entryId),
          inArray(entryChangeRequestsTable.status, ["pending_admin", "pending_director"]),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: "A pending change request already exists for this entry" });
      return;
    }

    const [row] = await db
      .insert(entryChangeRequestsTable)
      .values({
        requestedBy: req.user!.userId,
        entryType,
        entryId,
        writerId: entryWriterId,
        entryDate: entryDate,
        currentAmount,
        requestedAmount,
        reason,
        status: "pending_admin",
      })
      .returning();

    // Notify all administrators
    const admins = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.role, "administrator"));

    if (admins.length > 0) {
      const [requestingUser] = await db
        .select({ fullName: usersTable.fullName })
        .from(usersTable)
        .where(eq(usersTable.id, req.user!.userId))
        .limit(1);

      await dispatchSystemNotification({
        sentBy: req.user!.userId,
        messageType: "change_request",
        title: `Entry Change Request — ${entryType === "gross" ? "Gross" : "Wins"} · ${entryDate}`,
        body: `${requestingUser?.fullName ?? "An agent"} is requesting a change on a locked ${entryType} entry. Current: GH₵${currentAmount} → Requested: GH₵${requestedAmount}. Reason: ${reason}`,
        targetType: "system",
        targetId: row.id,
        recipientUserIds: admins.map((a) => a.id),
      });
    }

    const [enriched] = await enrichRequests([row]);
    res.status(201).json(enriched);
  },
);

// ── PATCH /entries/change-requests/:id/admin-review ──────────────────────────
router.patch(
  "/entries/change-requests/:id/admin-review",
  requireAuth,
  requireRole("administrator", "director"),
  async (req, res) => {
    const id = String(req.params["id"]);
    const parse = AdminReviewSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const { action, note } = parse.data;

    const [existing] = await db
      .select()
      .from(entryChangeRequestsTable)
      .where(eq(entryChangeRequestsTable.id, id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Change request not found" });
      return;
    }
    if (existing.status !== "pending_admin") {
      res.status(400).json({ error: `Request is already in status: ${existing.status}` });
      return;
    }

    const newStatus = action === "approve" ? "approved" : "rejected";

    // If approved, apply the change to the actual entry
    if (action === "approve") {
      if (existing.entryType === "gross") {
        await db
          .update(grossEntriesTable)
          .set({ grossAmount: existing.requestedAmount })
          .where(eq(grossEntriesTable.id, existing.entryId));
      } else {
        await db
          .update(winsEntriesTable)
          .set({ winsAmount: existing.requestedAmount })
          .where(eq(winsEntriesTable.id, existing.entryId));
      }

      // Fetch writer to find agentId
      const [writer] = await db
        .select({ agentId: writersTable.agentId })
        .from(writersTable)
        .where(eq(writersTable.id, existing.writerId))
        .limit(1);

      if (writer) {
        verifyLedgerAndEscalate(writer.agentId, req.user!.userId).catch(console.error);
      }
    }

    const [updated] = await db
      .update(entryChangeRequestsTable)
      .set({
        status: newStatus,
        adminNote: note ?? null,
        reviewedByAdmin: req.user!.userId,
        adminReviewedAt: new Date(),
      })
      .where(eq(entryChangeRequestsTable.id, id))
      .returning();

    // Notify the agent
    await dispatchSystemNotification({
      sentBy: req.user!.userId,
      messageType: "change_request_update",
      title: action === "approve"
        ? "Entry Change Applied — Admin Approved"
        : "Change Request Rejected by Admin",
      body: action === "approve"
        ? `The Administrator has approved the ${existing.entryType} entry change for ${existing.entryDate}. The entry has been updated from GH₵${existing.currentAmount} to GH₵${existing.requestedAmount}.${note ? ` Note: ${note}` : ""}`
        : `Your ${existing.entryType} entry change request for ${existing.entryDate} was rejected by the administrator.${note ? ` Reason: ${note}` : ""}`,
      targetType: "system",
      targetId: id,
      recipientUserIds: [existing.requestedBy],
    });

    const [enriched] = await enrichRequests([updated]);
    res.json(enriched);
  },
);

// ── PATCH /entries/change-requests/:id/director-review ───────────────────────
router.patch(
  "/entries/change-requests/:id/director-review",
  requireAuth,
  requireRole("director"),
  async (req, res) => {
    const id = String(req.params["id"]);
    const parse = DirectorReviewSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const { action, note } = parse.data;

    const [existing] = await db
      .select()
      .from(entryChangeRequestsTable)
      .where(eq(entryChangeRequestsTable.id, id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Change request not found" });
      return;
    }
    if (existing.status !== "pending_director") {
      res.status(400).json({ error: `Request is in status: ${existing.status} — cannot director-review` });
      return;
    }

    const newStatus = action === "approve" ? "approved" : "rejected";

    // If approved, apply the change to the actual entry
    if (action === "approve") {
      if (existing.entryType === "gross") {
        await db
          .update(grossEntriesTable)
          .set({ grossAmount: existing.requestedAmount })
          .where(eq(grossEntriesTable.id, existing.entryId));
      } else {
        await db
          .update(winsEntriesTable)
          .set({ winsAmount: existing.requestedAmount })
          .where(eq(winsEntriesTable.id, existing.entryId));
      }

      // Fetch writer to find agentId
      const [writer] = await db
        .select({ agentId: writersTable.agentId })
        .from(writersTable)
        .where(eq(writersTable.id, existing.writerId))
        .limit(1);

      if (writer) {
        verifyLedgerAndEscalate(writer.agentId, req.user!.userId).catch(console.error);
      }
    }

    const [updated] = await db
      .update(entryChangeRequestsTable)
      .set({
        status: newStatus,
        directorNote: note ?? null,
        reviewedByDirector: req.user!.userId,
        directorReviewedAt: new Date(),
      })
      .where(eq(entryChangeRequestsTable.id, id))
      .returning();

    // Notify agent and admin
    const notifyIds = [existing.requestedBy];
    if (existing.reviewedByAdmin) notifyIds.push(existing.reviewedByAdmin);

    await dispatchSystemNotification({
      sentBy: req.user!.userId,
      messageType: "change_request_update",
      title: action === "approve"
        ? "Entry Change Applied — Director Approved"
        : "Change Request Rejected by Director",
      body: action === "approve"
        ? `The Director has approved the ${existing.entryType} entry change for ${existing.entryDate}. The entry has been updated from GH₵${existing.currentAmount} to GH₵${existing.requestedAmount}.${note ? ` Note: ${note}` : ""}`
        : `The Director rejected the ${existing.entryType} entry change request for ${existing.entryDate}.${note ? ` Reason: ${note}` : ""}`,
      targetType: "system",
      targetId: id,
      recipientUserIds: [...new Set(notifyIds)],
    });

    const [enriched] = await enrichRequests([updated]);
    res.json(enriched);
  },
);

export default router;
