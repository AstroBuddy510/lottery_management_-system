import { Router } from "express";
import {
  db, agentsTable, writersTable, usersTable, agentDebtReductionsTable,
  posTerminalsTable, terminalAssignmentsTable, ticketsTable,
} from "@workspace/db";
import { eq, and, desc, isNull, sql } from "drizzle-orm";
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
  GetWriterProfileParams,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { composeWriterFullCode, generatePin, hashPin } from "../lib/writer-onboarding";

const ORG_PREFIX = "VS";
const router = Router();

/**
 * Geocoded coordinates from the client, checked before they reach the map.
 *
 * Returns null when neither was supplied (a location that did not geocode),
 * "invalid" when they are unusable, or the pair as strings for the numeric
 * columns. Ghana sits near 0 degrees longitude, so a swapped pair looks
 * plausible on casual inspection and only range checks catch it.
 */
function parseCoords(
  lat: string | undefined,
  lng: string | undefined,
): { lat: string; lng: string } | null | "invalid" {
  if (lat === undefined && lng === undefined) return null;
  if (lat === undefined || lng === undefined) return "invalid";
  if (lat.trim() === "" && lng.trim() === "") return null;
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return "invalid";
  if (latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) return "invalid";
  // 0,0 is the null island a failed geocode produces, not a place in Ghana.
  if (latNum === 0 && lngNum === 0) return "invalid";
  return { lat: latNum.toFixed(6), lng: lngNum.toFixed(6) };
}

/**
 * Fold a writer's location and coordinates into an update set.
 *
 * This lived only inside PATCH /agents/:agentId/writers/:id. The other route -
 * PATCH /writers/:id, which is the one every writer edit form in the web app
 * actually calls - accepted location, lat and lng in its body schema and then
 * wrote neither, so a pin set in the UI was answered with 200 OK and silently
 * dropped. That is why writers ended up with an address and no coordinates and
 * nothing the operator did could fix it.
 *
 * Returns an error message when the input is unusable, or null on success,
 * having mutated `updates`. Shared rather than copied, so the next change
 * cannot fix one route and leave the other behind.
 */
function applyLocationUpdates(
  data: { location?: string | undefined; lat?: string | undefined; lng?: string | undefined },
  updates: Record<string, unknown>,
): string | null {
  if (data.location !== undefined) {
    const trimmed = data.location.trim();
    // Empty clears it; one or two characters is a typo, not a place.
    if (trimmed.length > 0 && trimmed.length < 3) return "Location is too short";
    updates.location = trimmed || null;
  }
  if (data.lat !== undefined || data.lng !== undefined) {
    const coords = parseCoords(data.lat, data.lng);
    if (coords === "invalid") return "Latitude and longitude are out of range";
    updates.lat = coords ? coords.lat : null;
    updates.lng = coords ? coords.lng : null;
  }
  return null;
}

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
    const { writerCode, fullName, phone, operationModel } = bodyResult.data;

    /*
     * Where the writer sells from. Required on creation, because the terminal
     * map is only as useful as its coverage, and a field that is optional at
     * the one moment someone is already typing the writer's details never gets
     * filled in afterwards.
     *
     * Coordinates are geocoded client-side from this text and are optional: a
     * place that does not geocode still gets recorded, it just cannot be
     * mapped yet. They are validated rather than trusted - a swapped lat/lng
     * or a stray zero puts a pin in the Gulf of Guinea, and silent nonsense on
     * a map is worse than a blank.
     */
    const location = bodyResult.data.location.trim();
    if (location.length < 3) {
      res.status(400).json({ error: "Location is required" });
      return;
    }
    const coords = parseCoords(bodyResult.data.lat, bodyResult.data.lng);
    if (coords === "invalid") {
      res.status(400).json({ error: "Latitude and longitude are out of range" });
      return;
    }
    const upperWriterCode = writerCode.toUpperCase();
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId)).limit(1);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    const fullCode = composeWriterFullCode(agent.fullCode, upperWriterCode);
    if (!fullCode) {
      res.status(400).json({ error: "Writer code is too long for this agent" });
      return;
    }
    const [existing] = await db.select({ id: writersTable.id }).from(writersTable).where(eq(writersTable.fullCode, fullCode)).limit(1);
    if (existing) {
      res.status(409).json({ error: "Writer code already in use for this agent" });
      return;
    }
    if (phone) {
      const [phoneTaken] = await db.select({ id: writersTable.id }).from(writersTable).where(eq(writersTable.phone, phone)).limit(1);
      if (phoneTaken) {
        res.status(409).json({ error: "Phone number already in use" });
        return;
      }
    }
    // Agent-led onboarding is pre-approved, so the PIN is issued immediately.
    // Without this the writer has no credential and cannot sign in at all.
    const pin = generatePin();
    const [writer] = await db
      .insert(writersTable)
      .values({
        agentId,
        writerCode: upperWriterCode,
        fullCode,
        fullName,
        ...(phone ? { phone } : {}),
        ...(operationModel ? { operationModel } : {}),
        location,
        ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
        pinHash: await hashPin(pin),
        registrationSource: "agent",
        approvalStatus: "approved",
      })
      .returning();
    // Plaintext PIN returned exactly once; only the hash is stored.
    res.status(201).json({ ...writer, pinHash: undefined, pin });
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
    // Lets the writers who predate the location field be filled in without
    // forcing it on someone who only came here to toggle isActive.
    const nestedLocationError = applyLocationUpdates(bodyResult.data, updates);
    if (nestedLocationError) {
      res.status(400).json({ error: nestedLocationError });
      return;
    }
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

router.patch(
  "/writers/:id",
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

    const [existing] = await db
      .select()
      .from(writersTable)
      .where(eq(writersTable.id, paramsResult.data.id))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Writer not found" });
      return;
    }

    if (req.user!.role === "agent") {
      const myAgent = await getAgentForUser(req.user!.userId);
      if (!myAgent || myAgent.id !== existing.agentId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
    }

    const updates: Record<string, unknown> = {};
    if (bodyResult.data.fullName) updates.fullName = bodyResult.data.fullName;
    if (bodyResult.data.isActive !== undefined) updates.isActive = bodyResult.data.isActive;
    // This is where a pin set from any of the writer edit forms arrives.
    const locationError = applyLocationUpdates(bodyResult.data, updates);
    if (locationError) {
      res.status(400).json({ error: locationError });
      return;
    }

    const [writer] = await db
      .update(writersTable)
      .set(updates)
      .where(eq(writersTable.id, paramsResult.data.id))
      .returning();

    res.json(writer);
  },
);

/**
 * Everything one writer's profile page shows, in one request.
 *
 * The map now sends a click here, and a supervisor arriving from a marker
 * wants the same four answers every time: who is this, where do they sell,
 * what device are they holding, and are they actually selling. Assembling
 * that client-side would have meant four round trips and a page that fills
 * in piecemeal, so it is one endpoint.
 *
 * The PIN hash never leaves - only whether one exists, because "this writer
 * cannot sign in" is the single most common reason a terminal sits idle.
 */
router.get(
  "/writers/:id/profile",
  requireAuth,
  requireRole("director", "administrator", "cashier", "agent"),
  async (req, res) => {
    const parsed = GetWriterProfileParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }
    const writerId = parsed.data.id;

    const [row] = await db
      .select({
        writer: writersTable,
        agentId: agentsTable.id,
        agentCode: agentsTable.fullCode,
        agencyName: agentsTable.agencyName,
        agencyLocation: agentsTable.location,
      })
      .from(writersTable)
      .innerJoin(agentsTable, eq(writersTable.agentId, agentsTable.id))
      .where(eq(writersTable.id, writerId))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Writer not found" });
      return;
    }

    // An agent sees their own writers and nobody else's.
    if (req.user!.role === "agent") {
      const myAgent = await getAgentForUser(req.user!.userId);
      if (!myAgent || myAgent.id !== row.agentId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
    }

    const [held] = await db
      .select({
        id: posTerminalsTable.id,
        serialNumber: posTerminalsTable.serialNumber,
        brand: posTerminalsTable.brand,
        model: posTerminalsTable.model,
        imei: posTerminalsTable.imei,
        status: posTerminalsTable.status,
        assignedAt: terminalAssignmentsTable.assignedAt,
      })
      .from(terminalAssignmentsTable)
      .innerJoin(posTerminalsTable, eq(posTerminalsTable.id, terminalAssignmentsTable.terminalId))
      .where(
        and(
          eq(terminalAssignmentsTable.writerId, writerId),
          isNull(terminalAssignmentsTable.unassignedAt),
        ),
      )
      .limit(1);

    const [history] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(terminalAssignmentsTable)
      .where(eq(terminalAssignmentsTable.writerId, writerId));

    // Cancelled and void tickets are excluded here exactly as they are in the
    // terminal list, so the profile and the map cannot disagree about whether
    // somebody has sold today.
    const [sales] = await db
      .select({
        ticketCount: sql<number>`count(*)::int`,
        salesToday: sql<number>`count(*) filter (where date(${ticketsTable.createdAt}) = current_date)::int`,
        stakesToday: sql<string>`coalesce(sum(${ticketsTable.stakeAmount}) filter (where date(${ticketsTable.createdAt}) = current_date), 0)::text`,
        totalStakes: sql<string>`coalesce(sum(${ticketsTable.stakeAmount}), 0)::text`,
        winningTickets: sql<number>`count(*) filter (where ${ticketsTable.isWinner})::int`,
        totalWins: sql<string>`coalesce(sum(${ticketsTable.winAmount}), 0)::text`,
        lastSaleAt: sql<Date | null>`max(${ticketsTable.createdAt})`,
      })
      .from(ticketsTable)
      .where(
        and(
          eq(ticketsTable.writerId, writerId),
          sql`${ticketsTable.status} not in ('cancelled', 'void')`,
        ),
      );

    const { pinHash, ...writer } = row.writer;

    res.json({
      writer,
      hasPin: pinHash !== null,
      isRedFlagged: row.writer.isRedFlagged,
      redFlagReason: row.writer.redFlagReason,
      registrationSource: row.writer.registrationSource,
      agency: {
        agentId: row.agentId,
        agentCode: row.agentCode,
        agencyName: row.agencyName,
        location: row.agencyLocation,
      },
      terminal: held ?? null,
      terminalHistoryCount: history?.n ?? 0,
      sales: {
        ticketCount: sales?.ticketCount ?? 0,
        salesToday: sales?.salesToday ?? 0,
        stakesToday: sales?.stakesToday ?? "0",
        totalStakes: sales?.totalStakes ?? "0",
        winningTickets: sales?.winningTickets ?? 0,
        totalWins: sales?.totalWins ?? "0",
        lastSaleAt: sales?.lastSaleAt ?? null,
      },
    });
  },
);

router.get(
  "/agents/:agentId/debt-reductions",
  requireAuth,
  requireRole("director", "administrator", "agent"),
  async (req, res) => {
    const agentId = String(req.params["agentId"]);

    if (req.user!.role === "agent") {
      const myAgent = await getAgentForUser(req.user!.userId);
      if (!myAgent || myAgent.id !== agentId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
    }

    const rows = await db
      .select()
      .from(agentDebtReductionsTable)
      .where(eq(agentDebtReductionsTable.agentId, agentId))
      .orderBy(desc(agentDebtReductionsTable.calcDate), desc(agentDebtReductionsTable.createdAt));

    res.json(rows);
  },
);

export default router;
