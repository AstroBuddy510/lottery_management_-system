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

async function getAgentForUser(userId: string) {
  const [row] = await db
    .select({
      id: agentsTable.id,
      userId: agentsTable.userId,
      agentCode: agentsTable.agentCode,
      fullCode: agentsTable.fullCode,
      isActive: agentsTable.isActive,
      createdAt: agentsTable.createdAt,
      userId_: usersTable.id,
      fullName: usersTable.fullName,
      phone: usersTable.phone,
      role: usersTable.role,
      userIsActive: usersTable.isActive,
      profilePicture: usersTable.profilePicture,
    })
    .from(agentsTable)
    .innerJoin(usersTable, eq(agentsTable.userId, usersTable.id))
    .where(eq(agentsTable.userId, userId))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id, userId: row.userId, agentCode: row.agentCode, fullCode: row.fullCode,
    isActive: row.isActive, createdAt: row.createdAt,
    user: { id: row.userId_, fullName: row.fullName, phone: row.phone, role: row.role, isActive: row.userIsActive, profilePicture: row.profilePicture },
  };
}

router.get(
  "/agents",
  requireAuth,
  requireRole("director", "administrator", "cashier", "gross_entry", "wins_entry"),
  async (req, res) => {
    const rows = await db
      .select({
        id: agentsTable.id,
        userId: agentsTable.userId,
        agentCode: agentsTable.agentCode,
        fullCode: agentsTable.fullCode,
        isActive: agentsTable.isActive,
        createdAt: agentsTable.createdAt,
        userId_: usersTable.id,
        fullName: usersTable.fullName,
        phone: usersTable.phone,
        role: usersTable.role,
        userIsActive: usersTable.isActive,
        profilePicture: usersTable.profilePicture,
      })
      .from(agentsTable)
      .innerJoin(usersTable, eq(agentsTable.userId, usersTable.id));
    const agents = rows.map(r => ({
      id: r.id,
      userId: r.userId,
      agentCode: r.agentCode,
      fullCode: r.fullCode,
      isActive: r.isActive,
      createdAt: r.createdAt,
      user: { id: r.userId_, fullName: r.fullName, phone: r.phone, role: r.role, isActive: r.userIsActive, profilePicture: r.profilePicture },
    }));
    res.json(agents);
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
    const { userId, agentCode } = parse.data;
    const upperCode = agentCode.toUpperCase();
    const fullCode = `${ORG_PREFIX}-${upperCode}`;

    const [user] = await db
      .select({ id: usersTable.id, fullName: usersTable.fullName, email: usersTable.email })
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

    const [agent] = await db
      .insert(agentsTable)
      .values({ userId, agentCode: upperCode, fullCode })
      .returning();
    res.status(201).json({ ...agent, fullName: user.fullName, email: user.email });
  },
);

// GET /agents/me — must be BEFORE /:id so it doesn't get caught by that route
router.get(
  "/agents/me",
  requireAuth,
  requireRole("agent"),
  async (req, res) => {
    const userId = (req as any).user?.id as string;
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
      .select({
        id: agentsTable.id,
        userId: agentsTable.userId,
        agentCode: agentsTable.agentCode,
        fullCode: agentsTable.fullCode,
        isActive: agentsTable.isActive,
        createdAt: agentsTable.createdAt,
        userId_: usersTable.id,
        fullName: usersTable.fullName,
        phone: usersTable.phone,
        role: usersTable.role,
        userIsActive: usersTable.isActive,
        profilePicture: usersTable.profilePicture,
      })
      .from(agentsTable)
      .innerJoin(usersTable, eq(agentsTable.userId, usersTable.id))
      .where(eq(agentsTable.id, parse.data.id))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    const agent = {
      id: row.id, userId: row.userId, agentCode: row.agentCode, fullCode: row.fullCode,
      isActive: row.isActive, createdAt: row.createdAt,
      user: { id: row.userId_, fullName: row.fullName, phone: row.phone, role: row.role, isActive: row.userIsActive, profilePicture: row.profilePicture },
    };
    res.json(agent);
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
    const updates: Record<string, unknown> = {};
    if (bodyResult.data.isActive !== undefined)
      updates.isActive = bodyResult.data.isActive;

    const [agent] = await db
      .update(agentsTable)
      .set(updates)
      .where(eq(agentsTable.id, paramsResult.data.id))
      .returning();
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    res.json(agent);
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
    const user = (req as any).user as { id: string; role: string };
    // Agents can only see their own writers
    if (user.role === "agent") {
      const myAgent = await getAgentForUser(user.id);
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

    const user = (req as any).user as { id: string; role: string };
    const agentId = paramsResult.data.agentId;

    // Agents can only add writers to their own list
    if (user.role === "agent") {
      const myAgent = await getAgentForUser(user.id);
      if (!myAgent || myAgent.id !== agentId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
    }

    const { writerCode, fullName } = bodyResult.data;
    const upperWriterCode = writerCode.toUpperCase();

    const [agent] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId))
      .limit(1);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const fullCode = `${agent.fullCode}-${upperWriterCode}`;
    const [existing] = await db
      .select({ id: writersTable.id })
      .from(writersTable)
      .where(eq(writersTable.fullCode, fullCode))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: "Writer code already in use for this agent" });
      return;
    }

    const [writer] = await db
      .insert(writersTable)
      .values({ agentId, writerCode: upperWriterCode, fullCode, fullName })
      .returning();
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

    const user = (req as any).user as { id: string; role: string };
    const agentId = req.params["agentId"] as string;

    // Agents can only edit their own writers
    if (user.role === "agent") {
      const myAgent = await getAgentForUser(user.id);
      if (!myAgent || myAgent.id !== agentId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
    }

    const updates: Record<string, unknown> = {};
    if (bodyResult.data.fullName) updates.fullName = bodyResult.data.fullName;
    if (bodyResult.data.isActive !== undefined)
      updates.isActive = bodyResult.data.isActive;

    const [writer] = await db
      .update(writersTable)
      .set(updates)
      .where(
        and(
          eq(writersTable.id, paramsResult.data.id),
          eq(writersTable.agentId, agentId),
        ),
      )
      .returning();
    if (!writer) {
      res.status(404).json({ error: "Writer not found" });
      return;
    }
    res.json(writer);
  },
);

export default router;
