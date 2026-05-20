import { Router } from "express";
import { db, agentsTable, writersTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  CreateAgentBody,
  GetAgentParams,
  UpdateAgentParams,
  UpdateAgentBody,
  ListWritersParams,
  CreateWriterParams,
  CreateWriterBody,
  UpdateWriterParams,
  UpdateWriterBody,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";

const ORG_PREFIX = "VS";
const router = Router();

function formatAgent(r: {
  id: string; userId: string; agentCode: string; fullCode: string;
  isActive: boolean; agencyName: string | null; location: string | null;
  lat: string | null; lng: string | null; status: string; outstandingDebt: string;
  debtSince: Date | null; createdAt: Date;
  userId_: string; fullName: string; phone: string | null; role: string;
  userIsActive: boolean; profilePicture: string | null;
}) {
  return {
    id: r.id, userId: r.userId, agentCode: r.agentCode, fullCode: r.fullCode,
    isActive: r.isActive, agencyName: r.agencyName, location: r.location,
    lat: r.lat, lng: r.lng, status: r.status, outstandingDebt: r.outstandingDebt,
    debtSince: r.debtSince ? r.debtSince.toISOString() : null,
    createdAt: r.createdAt,
    user: { id: r.userId_, fullName: r.fullName, phone: r.phone, role: r.role, isActive: r.userIsActive, profilePicture: r.profilePicture },
  };
}

const AGENT_SELECT = {
  id: agentsTable.id,
  userId: agentsTable.userId,
  agentCode: agentsTable.agentCode,
  fullCode: agentsTable.fullCode,
  isActive: agentsTable.isActive,
  agencyName: agentsTable.agencyName,
  location: agentsTable.location,
  lat: agentsTable.lat,
  lng: agentsTable.lng,
  status: agentsTable.status,
  outstandingDebt: agentsTable.outstandingDebt,
  debtSince: agentsTable.debtSince,
  createdAt: agentsTable.createdAt,
  userId_: usersTable.id,
  fullName: usersTable.fullName,
  phone: usersTable.phone,
  role: usersTable.role,
  userIsActive: usersTable.isActive,
  profilePicture: usersTable.profilePicture,
} as const;

async function getAgentForUser(userId: string) {
  const [row] = await db
    .select(AGENT_SELECT)
    .from(agentsTable)
    .innerJoin(usersTable, eq(agentsTable.userId, usersTable.id))
    .where(eq(agentsTable.userId, userId))
    .limit(1);
  if (!row) return null;
  return formatAgent(row);
}

router.get(
  "/agents",
  requireAuth,
  requireRole("director", "administrator", "cashier", "gross_entry", "wins_entry"),
  async (req, res) => {
    const rows = await db
      .select(AGENT_SELECT)
      .from(agentsTable)
      .innerJoin(usersTable, eq(agentsTable.userId, usersTable.id));
    res.json(rows.map(formatAgent));
  },
);

router.post(
  "/agents",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const parse = CreateAgentBody.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const { userId, agentCode, agencyName, location, lat, lng, status, outstandingDebt } = parse.data;
    const upperCode = agentCode.toUpperCase();
    const fullCode = `${ORG_PREFIX}-${upperCode}`;

    const [user] = await db
      .select({ id: usersTable.id, fullName: usersTable.fullName })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const [existingAgent] = await db
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(eq(agentsTable.agentCode, upperCode))
      .limit(1);
    if (existingAgent) {
      res.status(409).json({ error: "Agent code already in use" });
      return;
    }

    const debtAmount = outstandingDebt ? parseFloat(outstandingDebt) : 0;
    const debtSince = debtAmount > 0 ? new Date() : null;

    const [agent] = await db
      .insert(agentsTable)
      .values({
        userId, agentCode: upperCode, fullCode,
        agencyName: agencyName ?? null,
        location: location ?? null,
        lat: lat != null ? String(lat) : null,
        lng: lng != null ? String(lng) : null,
        status: (status as "active" | "closed") ?? "active",
        outstandingDebt: outstandingDebt ?? "0",
        debtSince,
      })
      .returning();

    const [row] = await db
      .select(AGENT_SELECT)
      .from(agentsTable)
      .innerJoin(usersTable, eq(agentsTable.userId, usersTable.id))
      .where(eq(agentsTable.id, agent.id))
      .limit(1);
    res.status(201).json(formatAgent(row!));
  },
);

router.get(
  "/agents/me",
  requireAuth,
  requireRole("agent"),
  async (req, res) => {
    const userId = req.user!.userId;
    const agent = await getAgentForUser(userId);
    if (!agent) {
      res.status(404).json({ error: "Agent record not found for this user" });
      return;
    }
    res.json(agent);
  },
);

router.get(
  "/agents/:id",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const parse = GetAgentParams.safeParse(req.params);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }
    const [row] = await db
      .select(AGENT_SELECT)
      .from(agentsTable)
      .innerJoin(usersTable, eq(agentsTable.userId, usersTable.id))
      .where(eq(agentsTable.id, parse.data.id))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    res.json(formatAgent(row));
  },
);

router.patch(
  "/agents/:id",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const paramsResult = UpdateAgentParams.safeParse(req.params);
    if (!paramsResult.success) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }
    const bodyResult = UpdateAgentBody.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const data = bodyResult.data;
    const updates: Record<string, unknown> = {};
    if (data.isActive !== undefined) updates.isActive = data.isActive;
    if (data.agencyName !== undefined) updates.agencyName = data.agencyName;
    if (data.location !== undefined) updates.location = data.location;
    if (data.lat !== undefined) updates.lat = data.lat != null ? String(data.lat) : null;
    if (data.lng !== undefined) updates.lng = data.lng != null ? String(data.lng) : null;
    if (data.status !== undefined) updates.status = data.status;
    if (data.outstandingDebt !== undefined) {
      updates.outstandingDebt = data.outstandingDebt;
      const debtAmount = parseFloat(data.outstandingDebt);
      if (debtAmount > 0) {
        const [existing] = await db.select({ debtSince: agentsTable.debtSince }).from(agentsTable).where(eq(agentsTable.id, paramsResult.data.id)).limit(1);
        if (!existing?.debtSince) updates.debtSince = new Date();
      } else {
        updates.debtSince = null;
      }
    }

    await db.update(agentsTable).set(updates).where(eq(agentsTable.id, paramsResult.data.id));

    const [row] = await db
      .select(AGENT_SELECT)
      .from(agentsTable)
      .innerJoin(usersTable, eq(agentsTable.userId, usersTable.id))
      .where(eq(agentsTable.id, paramsResult.data.id))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    res.json(formatAgent(row));
  },
);

router.get(
  "/agents/:agentId/writers",
  requireAuth,
  requireRole("director", "administrator", "cashier", "gross_entry", "wins_entry", "agent"),
  async (req, res) => {
    const parse = ListWritersParams.safeParse(req.params);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }
    if (req.user!.role === "agent") {
      const myAgent = await getAgentForUser(req.user!.userId);
      if (!myAgent || myAgent.id !== parse.data.agentId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
    }
    const writers = await db
      .select()
      .from(writersTable)
      .where(eq(writersTable.agentId, parse.data.agentId));
    res.json(writers);
  },
);

router.post(
  "/agents/:agentId/writers",
  requireAuth,
  requireRole("director", "administrator", "agent"),
  async (req, res) => {
    const paramsResult = CreateWriterParams.safeParse(req.params);
    if (!paramsResult.success) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }
    const bodyResult = CreateWriterBody.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const agentId = paramsResult.data.agentId;
    if (req.user!.role === "agent") {
      const myAgent = await getAgentForUser(req.user!.userId);
      if (!myAgent || myAgent.id !== agentId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
    }
    const { writerCode, fullName } = bodyResult.data;
    const upperWriterCode = writerCode.toUpperCase();
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId)).limit(1);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    const fullCode = `${agent.fullCode}-${upperWriterCode}`;
    const [existing] = await db.select({ id: writersTable.id }).from(writersTable).where(eq(writersTable.fullCode, fullCode)).limit(1);
    if (existing) {
      res.status(409).json({ error: "Writer code already in use for this agent" });
      return;
    }
    const [writer] = await db.insert(writersTable).values({ agentId, writerCode: upperWriterCode, fullCode, fullName }).returning();
    res.status(201).json(writer);
  },
);

router.patch(
  "/agents/:agentId/writers/:id",
  requireAuth,
  requireRole("director", "administrator", "agent"),
  async (req, res) => {
    const paramsResult = UpdateWriterParams.safeParse(req.params);
    if (!paramsResult.success) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }
    const bodyResult = UpdateWriterBody.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const agentId = req.params["agentId"] as string;
    if (req.user!.role === "agent") {
      const myAgent = await getAgentForUser(req.user!.userId);
      if (!myAgent || myAgent.id !== agentId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
    }
    const updates: Record<string, unknown> = {};
    if (bodyResult.data.fullName) updates.fullName = bodyResult.data.fullName;
    if (bodyResult.data.isActive !== undefined) updates.isActive = bodyResult.data.isActive;
    const [writer] = await db
      .update(writersTable)
      .set(updates)
      .where(and(eq(writersTable.id, paramsResult.data.id), eq(writersTable.agentId, agentId)))
      .returning();
    if (!writer) {
      res.status(404).json({ error: "Writer not found" });
      return;
    }
    res.json(writer);
  },
);

export default router;
