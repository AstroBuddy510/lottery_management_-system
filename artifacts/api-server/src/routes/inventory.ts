import { Router } from "express";
import {
  db,
  bookletBatchesTable,
  bookletAllocationsTable,
  padlocksTable,
  padlockAssignmentsTable,
  posTerminalsTable,
  terminalAssignmentsTable,
  ticketsTable,
  agentsTable,
  writersTable,
  grossEntriesTable,
  usersTable,
} from "@workspace/db";
import { eq, and, sql, desc, isNull, inArray } from "drizzle-orm";
import {
  CreateBookletBatchBody,
  CreateBookletAllocationBody,
  CreatePadlockBody,
  AssignPadlockBody,
  ReturnPadlockAssignmentBody,
  UpdatePadlockAssignmentBody,
  CreateTerminalBody,
  AssignTerminalBody,
  ReturnTerminalAssignmentBody,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { uniqueViolation } from "../lib/pg-errors";

const router = Router();

// ─── BOOKLET ENDPOINTS ───

// List booklet print batches
router.get(
  "/inventory/booklets/batches",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (req, res) => {
    try {
      const batches = await db
        .select()
        .from(bookletBatchesTable)
        .orderBy(desc(bookletBatchesTable.batchDate));
      res.json(batches);
    } catch (error) {
      console.error("Error listing booklet batches:", error);
      res.status(500).json({ error: "Failed to list booklet batches" });
    }
  }
);

// Create booklet print batch restock
router.post(
  "/inventory/booklets/batches",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (req, res) => {
    const parse = CreateBookletBatchBody.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid request body", details: parse.error.format() });
      return;
    }

    const { batchDate, quantity, totalCost, description } = parse.data;
    if (quantity <= 0) {
      res.status(400).json({ error: "Quantity must be greater than zero" });
      return;
    }

    const costPerBooklet = (Number(totalCost) / quantity).toFixed(2);

    try {
      const [batch] = await db
        .insert(bookletBatchesTable)
        .values({
          batchDate,
          quantity,
          totalCost: String(totalCost),
          costPerBooklet,
          description: description || null,
          enteredBy: req.user!.userId,
        })
        .returning();
      res.status(201).json(batch);
    } catch (error) {
      console.error("Error creating booklet batch:", error);
      res.status(500).json({ error: "Failed to create booklet batch" });
    }
  }
);

// List booklet allocations
router.get(
  "/inventory/booklets/allocations",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (req, res) => {
    try {
      const allocations = await db
        .select()
        .from(bookletAllocationsTable)
        .orderBy(desc(bookletAllocationsTable.allocatedDate));
      res.json(allocations);
    } catch (error) {
      console.error("Error listing booklet allocations:", error);
      res.status(500).json({ error: "Failed to list booklet allocations" });
    }
  }
);

// Allocate booklets to an agent
router.post(
  "/inventory/booklets/allocations",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (req, res) => {
    const parse = CreateBookletAllocationBody.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid request body", details: parse.error.format() });
      return;
    }

    const { agentId, allocatedDate, quantity, notes } = parse.data;
    if (quantity <= 0) {
      res.status(400).json({ error: "Quantity must be greater than zero" });
      return;
    }

    try {
      // Check agent exists
      const [agent] = await db
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.id, agentId))
        .limit(1);

      if (!agent) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }

      const [allocation] = await db
        .insert(bookletAllocationsTable)
        .values({
          agentId,
          allocatedDate,
          quantity,
          notes: notes || null,
          enteredBy: req.user!.userId,
        })
        .returning();
      res.status(201).json(allocation);
    } catch (error) {
      console.error("Error creating booklet allocation:", error);
      res.status(500).json({ error: "Failed to create booklet allocation" });
    }
  }
);

// Get booklet stock summary
router.get(
  "/inventory/booklets/summary",
  requireAuth,
  requireRole("director", "administrator", "cashier", "agent"),
  async (req, res) => {
    try {
      // Stocked booklets
      const [stockedRes] = await db
        .select({ total: sql<number>`sum(${bookletBatchesTable.quantity})::int` })
        .from(bookletBatchesTable);
      const totalStocked = stockedRes?.total ?? 0;

      // Allocated booklets
      const [allocatedRes] = await db
        .select({ total: sql<number>`sum(${bookletAllocationsTable.quantity})::int` })
        .from(bookletAllocationsTable);
      const totalAllocated = allocatedRes?.total ?? 0;

      // Used by agents
      const [usedRes] = await db
        .select({ total: sql<number>`sum(${grossEntriesTable.bookletsCount})::int` })
        .from(grossEntriesTable);
      const totalUsedByAgents = usedRes?.total ?? 0;

      res.json({
        totalStocked,
        totalAllocated,
        cashierStockRemaining: Math.max(0, totalStocked - totalAllocated),
        totalUsedByAgents,
        agentStockRemaining: Math.max(0, totalAllocated - totalUsedByAgents),
      });
    } catch (error) {
      console.error("Error getting booklet summary:", error);
      res.status(500).json({ error: "Failed to load booklet inventory summary" });
    }
  }
);

// Get booklet balances per agent
router.get(
  "/inventory/booklets/agent-balances",
  requireAuth,
  requireRole("director", "administrator", "cashier", "agent"),
  async (req, res) => {
    try {
      let agentId: string | null = null;
      if (req.user!.role === "agent") {
        const [agentRecord] = await db
          .select({ id: agentsTable.id })
          .from(agentsTable)
          .where(eq(agentsTable.userId, req.user!.userId))
          .limit(1);
        if (!agentRecord) {
          res.status(403).json({ error: "No agent profile found for this user" });
          return;
        }
        agentId = agentRecord.id;
      }

      const agentsQuery = db
        .select({
          id: agentsTable.id,
          agentCode: agentsTable.agentCode,
          agencyName: agentsTable.agencyName,
        })
        .from(agentsTable);

      const agents = await (agentId ? agentsQuery.where(eq(agentsTable.id, agentId)) : agentsQuery);

      const allocationsQuery = db
        .select({
          agentId: bookletAllocationsTable.agentId,
          qty: sql<number>`sum(${bookletAllocationsTable.quantity})::int`,
        })
        .from(bookletAllocationsTable)
        .groupBy(bookletAllocationsTable.agentId);

      const allocations = await (agentId ? allocationsQuery.where(eq(bookletAllocationsTable.agentId, agentId)) : allocationsQuery);

      const usagesQuery = db
        .select({
          agentId: writersTable.agentId,
          qty: sql<number>`sum(${grossEntriesTable.bookletsCount})::int`,
        })
        .from(grossEntriesTable)
        .innerJoin(writersTable, eq(grossEntriesTable.writerId, writersTable.id))
        .groupBy(writersTable.agentId);

      const usages = await (agentId ? usagesQuery.where(eq(writersTable.agentId, agentId)) : usagesQuery);

      const allocationMap = new Map(allocations.map(a => [a.agentId, a.qty ?? 0]));
      const usageMap = new Map(usages.map(u => [u.agentId, u.qty ?? 0]));

      const balances = agents.map(agent => {
        const allocated = allocationMap.get(agent.id) ?? 0;
        const used = usageMap.get(agent.id) ?? 0;
        return {
          agentId: agent.id,
          agentCode: agent.agentCode,
          agencyName: agent.agencyName,
          totalAllocated: allocated,
          totalUsed: used,
          balance: allocated - used,
        };
      });

      res.json(balances);
    } catch (error) {
      console.error("Error fetching agent booklet balances:", error);
      res.status(500).json({ error: "Failed to load agent booklet balances" });
    }
  }
);


// ─── PADLOCK ENDPOINTS ───

// List padlocks
router.get(
  "/inventory/padlocks",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (req, res) => {
    try {
      const padlocks = await db
        .select()
        .from(padlocksTable)
        .orderBy(desc(padlocksTable.createdAt));
      res.json(padlocks);
    } catch (error) {
      console.error("Error listing padlocks:", error);
      res.status(500).json({ error: "Failed to list padlocks" });
    }
  }
);

// Register a new padlock
router.post(
  "/inventory/padlocks",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (req, res) => {
    const parse = CreatePadlockBody.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid request body", details: parse.error.format() });
      return;
    }

    const { serialNumber, brandName, lockType, condition } = parse.data;

    try {
      // Check unique serial number
      const [existing] = await db
        .select()
        .from(padlocksTable)
        .where(eq(padlocksTable.serialNumber, serialNumber))
        .limit(1);

      if (existing) {
        res.status(409).json({ error: `Padlock with serial number ${serialNumber} is already registered` });
        return;
      }

      const [padlock] = await db
        .insert(padlocksTable)
        .values({
          serialNumber,
          brandName,
          lockType: lockType || "new",
          condition: condition || "good",
          status: "available",
        })
        .returning();
      res.status(201).json(padlock);
    } catch (error) {
      console.error("Error registering padlock:", error);
      res.status(500).json({ error: "Failed to register padlock" });
    }
  }
);

// Randomly assign padlock to agent
router.post(
  "/inventory/padlocks/assign",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (req, res) => {
    const parse = AssignPadlockBody.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid request body", details: parse.error.format() });
      return;
    }

    const { agentId, padlockId, destination, conditionBefore } = parse.data;

    try {
      // Check agent exists
      const [agent] = await db
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.id, agentId))
        .limit(1);

      if (!agent) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }

      let availablePadlock;
      if (padlockId) {
        // Query specific padlock and ensure it's available
        const [specificLock] = await db
          .select()
          .from(padlocksTable)
          .where(and(eq(padlocksTable.id, padlockId), eq(padlocksTable.status, "available")))
          .limit(1);
        
        if (!specificLock) {
          res.status(409).json({ error: "Selected padlock is not available" });
          return;
        }
        availablePadlock = specificLock;
      } else {
        // Query randomly for an available padlock
        const [randomLock] = await db
          .select()
          .from(padlocksTable)
          .where(eq(padlocksTable.status, "available"))
          .orderBy(sql`random()`)
          .limit(1);

        if (!randomLock) {
          res.status(409).json({ error: "No available padlocks in inventory" });
          return;
        }
        availablePadlock = randomLock;
      }

      // Update padlock status to assigned
      await db
        .update(padlocksTable)
        .set({ status: "assigned", condition: conditionBefore })
        .where(eq(padlocksTable.id, availablePadlock.id));

      // Create padlock assignment record
      const [assignment] = await db
        .insert(padlockAssignmentsTable)
        .values({
          padlockId: availablePadlock.id,
          agentId,
          destination,
          conditionBefore,
          assignedAt: new Date(),
          enteredBy: req.user!.userId,
        })
        .returning();

      res.status(201).json({
        ...assignment,
        padlockSerialNumber: availablePadlock.serialNumber,
        agentCode: agent.agentCode,
        agencyName: agent.agencyName,
      });
    } catch (error) {
      console.error("Error assigning padlock:", error);
      res.status(500).json({ error: "Failed to assign padlock" });
    }
  }
);

// List padlock assignments history
router.get(
  "/inventory/padlock-assignments",
  requireAuth,
  requireRole("director", "administrator", "cashier", "agent"),
  async (req, res) => {
    try {
      const conditions = [];

      if (req.user?.role === "agent") {
        const [agent] = await db
          .select()
          .from(agentsTable)
          .where(eq(agentsTable.userId, req.user.userId))
          .limit(1);

        if (agent) {
          conditions.push(eq(padlockAssignmentsTable.agentId, agent.id));
        } else {
          res.json([]);
          return;
        }
      }

      const assignments = await db
        .select({
          id: padlockAssignmentsTable.id,
          padlockId: padlockAssignmentsTable.padlockId,
          padlockSerialNumber: padlocksTable.serialNumber,
          agentId: padlockAssignmentsTable.agentId,
          agentCode: agentsTable.agentCode,
          agencyName: agentsTable.agencyName,
          destination: padlockAssignmentsTable.destination,
          conditionBefore: padlockAssignmentsTable.conditionBefore,
          conditionAfter: padlockAssignmentsTable.conditionAfter,
          assignedAt: padlockAssignmentsTable.assignedAt,
          lockedAt: padlockAssignmentsTable.lockedAt,
          openedAt: padlockAssignmentsTable.openedAt,
          returnedAt: padlockAssignmentsTable.returnedAt,
          enteredBy: padlockAssignmentsTable.enteredBy,
          createdAt: padlockAssignmentsTable.createdAt,
        })
        .from(padlockAssignmentsTable)
        .innerJoin(padlocksTable, eq(padlockAssignmentsTable.padlockId, padlocksTable.id))
        .innerJoin(agentsTable, eq(padlockAssignmentsTable.agentId, agentsTable.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(padlockAssignmentsTable.assignedAt));

      res.json(assignments);
    } catch (error) {
      console.error("Error listing padlock assignments:", error);
      res.status(500).json({ error: "Failed to list padlock assignments" });
    }
  }
);

// Mark padlock assignment as opened
router.post(
  "/inventory/padlock-assignments/:id/open",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (req, res) => {
    const id = req.params.id as string;

    try {
      const [existing] = await db
        .select()
        .from(padlockAssignmentsTable)
        .where(eq(padlockAssignmentsTable.id, id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Padlock assignment not found" });
        return;
      }

      const [updated] = await db
        .update(padlockAssignmentsTable)
        .set({ openedAt: new Date() })
        .where(eq(padlockAssignmentsTable.id, id))
        .returning();

      // Get metadata for response
      const [padlock] = await db.select().from(padlocksTable).where(eq(padlocksTable.id, updated.padlockId)).limit(1);
      const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, updated.agentId)).limit(1);

      res.json({
        ...updated,
        padlockSerialNumber: padlock?.serialNumber ?? "",
        agentCode: agent?.agentCode ?? "",
        agencyName: agent?.agencyName ?? "",
      });
    } catch (error) {
      console.error("Error opening padlock:", error);
      res.status(500).json({ error: "Failed to record padlock opening" });
    }
  }
);

// Mark padlock assignment as returned
router.post(
  "/inventory/padlock-assignments/:id/return",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (req, res) => {
    const id = req.params.id as string;
    const parse = ReturnPadlockAssignmentBody.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid request body", details: parse.error.format() });
      return;
    }

    const { conditionAfter } = parse.data;

    try {
      const [existing] = await db
        .select()
        .from(padlockAssignmentsTable)
        .where(eq(padlockAssignmentsTable.id, id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Padlock assignment not found" });
        return;
      }

      const [updated] = await db
        .update(padlockAssignmentsTable)
        .set({
          returnedAt: new Date(),
          conditionAfter,
        })
        .where(eq(padlockAssignmentsTable.id, id))
        .returning();

      // Update padlock registry status back to available or broken/damaged based on condition
      const padlockStatus = conditionAfter === "good" ? "available" : conditionAfter; // "damaged" or "broken"
      await db
        .update(padlocksTable)
        .set({
          status: padlockStatus,
          condition: conditionAfter,
        })
        .where(eq(padlocksTable.id, existing.padlockId));

      // Get metadata for response
      const [padlock] = await db.select().from(padlocksTable).where(eq(padlocksTable.id, updated.padlockId)).limit(1);
      const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, updated.agentId)).limit(1);

      res.json({
        ...updated,
        padlockSerialNumber: padlock?.serialNumber ?? "",
        agentCode: agent?.agentCode ?? "",
        agencyName: agent?.agencyName ?? "",
      });
    } catch (error) {
      console.error("Error returning padlock:", error);
      res.status(500).json({ error: "Failed to record padlock return" });
    }
  }
);

// Update details of a padlock assignment
router.patch(
  "/inventory/padlock-assignments/:id",
  requireAuth,
  requireRole("director", "administrator", "cashier", "agent"),
  async (req, res) => {
    const id = req.params.id as string;
    const parse = UpdatePadlockAssignmentBody.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid request body", details: parse.error.format() });
      return;
    }

    try {
      const [existing] = await db
        .select()
        .from(padlockAssignmentsTable)
        .where(eq(padlockAssignmentsTable.id, id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Padlock assignment not found" });
        return;
      }

      if (req.user?.role === "agent") {
        const [agent] = await db
          .select()
          .from(agentsTable)
          .where(eq(agentsTable.userId, req.user.userId))
          .limit(1);

        if (!agent || existing.agentId !== agent.id) {
          res.status(403).json({ error: "You are not authorized to update this padlock assignment" });
          return;
        }
      }

      const data = parse.data;
      const updates: any = {};
      if (data.padlockId !== undefined) updates.padlockId = data.padlockId;
      if (data.agentId !== undefined) updates.agentId = data.agentId;
      if (data.destination !== undefined) updates.destination = data.destination;
      if (data.conditionBefore !== undefined) updates.conditionBefore = data.conditionBefore;
      if (data.conditionAfter !== undefined) updates.conditionAfter = data.conditionAfter;
      if (data.assignedAt !== undefined) updates.assignedAt = data.assignedAt ? new Date(data.assignedAt) : null;
      if (data.lockedAt !== undefined) updates.lockedAt = data.lockedAt ? new Date(data.lockedAt) : null;
      if (data.openedAt !== undefined) updates.openedAt = data.openedAt ? new Date(data.openedAt) : null;
      if (data.returnedAt !== undefined) updates.returnedAt = data.returnedAt ? new Date(data.returnedAt) : null;

      const [updated] = await db
        .update(padlockAssignmentsTable)
        .set(updates)
        .where(eq(padlockAssignmentsTable.id, id))
        .returning();

      // Manage old/new padlock status in registry
      if (data.padlockId && data.padlockId !== existing.padlockId) {
        await db
          .update(padlocksTable)
          .set({ status: "available" })
          .where(eq(padlocksTable.id, existing.padlockId));
        
        await db
          .update(padlocksTable)
          .set({ status: "assigned" })
          .where(eq(padlocksTable.id, data.padlockId));
      }

      const finalPadlockId = updated.padlockId;
      if (updated.returnedAt) {
        const finalCondition = updated.conditionAfter || "good";
        let status = "available";
        let padlockCondition = "good";
        
        if (finalCondition === "Intact") {
          status = "available";
          padlockCondition = "good";
        } else if (
          finalCondition === "Tampered with" || 
          finalCondition === "Tempered with" || 
          finalCondition === "damage" || 
          finalCondition === "damaged"
        ) {
          status = "damaged";
          padlockCondition = "damaged";
        } else if (finalCondition === "Damaged" || finalCondition === "broken") {
          status = "broken";
          padlockCondition = "broken";
        } else {
          status = finalCondition === "good" ? "available" : finalCondition;
          padlockCondition = finalCondition === "good" ? "good" : finalCondition;
        }

        await db
          .update(padlocksTable)
          .set({ status, condition: padlockCondition })
          .where(eq(padlocksTable.id, finalPadlockId));
      } else {
        await db
          .update(padlocksTable)
          .set({ status: "assigned" })
          .where(eq(padlocksTable.id, finalPadlockId));
      }

      // Get metadata for response
      const [padlock] = await db.select().from(padlocksTable).where(eq(padlocksTable.id, updated.padlockId)).limit(1);
      const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, updated.agentId)).limit(1);

      res.json({
        ...updated,
        padlockSerialNumber: padlock?.serialNumber ?? "",
        agentCode: agent?.agentCode ?? "",
        agencyName: agent?.agencyName ?? "",
      });
    } catch (error) {
      console.error("Error updating padlock assignment:", error);
      res.status(500).json({ error: "Failed to update padlock assignment" });
    }
  }
);

// ─── POS TERMINAL ENDPOINTS ───

/**
 * IMEI shape check.
 *
 * Fifteen digits is the standard; a few devices report a 16- or 17-digit
 * IMEISV. Deliberately NOT a Luhn check: the check digit is right on most
 * devices and wrong on enough cheap ones that rejecting on it would block
 * legitimate stock, and a clerk who cannot register a device they are holding
 * will write it down somewhere else instead. Length and digits-only catch the
 * realistic typo - a short paste or a serial pasted into the wrong field.
 */
const IMEI_SHAPE = /^\d{14,17}$/;

/** Terminals a writer can be given, plus who holds what, plus whether it is selling. */
router.get(
  "/inventory/terminals",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (req, res) => {
    try {
      const rawWindow = Number(req.query["activeWindowMinutes"]);
      // Clamped: a caller asking for 0 would mark everything idle, and a huge
      // window would mark a terminal untouched since August "active".
      const windowMinutes =
        Number.isFinite(rawWindow) && rawWindow > 0 ? Math.min(Math.trunc(rawWindow), 1440) : 60;

      // Current holder only: the open assignment is the one with no returned_at.
      const rows = await db
        .select({
          id: posTerminalsTable.id,
          serialNumber: posTerminalsTable.serialNumber,
          brand: posTerminalsTable.brand,
          model: posTerminalsTable.model,
          imei: posTerminalsTable.imei,
          status: posTerminalsTable.status,
          notes: posTerminalsTable.notes,
          registeredAt: posTerminalsTable.registeredAt,
          assignmentId: terminalAssignmentsTable.id,
          assignedAt: terminalAssignmentsTable.assignedAt,
          writerId: writersTable.id,
          writerCode: writersTable.fullCode,
          writerName: writersTable.fullName,
          writerPhone: writersTable.phone,
          // Carried here so the terminal map has a position without a second
          // round trip: the pin belongs where the writer works.
          writerLocation: writersTable.location,
          writerLat: writersTable.lat,
          writerLng: writersTable.lng,
          agentId: agentsTable.id,
          agentCode: agentsTable.fullCode,
          agencyName: agentsTable.agencyName,
        })
        .from(posTerminalsTable)
        .leftJoin(
          terminalAssignmentsTable,
          and(
            eq(terminalAssignmentsTable.terminalId, posTerminalsTable.id),
            isNull(terminalAssignmentsTable.returnedAt),
          ),
        )
        .leftJoin(writersTable, eq(terminalAssignmentsTable.writerId, writersTable.id))
        .leftJoin(agentsTable, eq(writersTable.agentId, agentsTable.id))
        .orderBy(desc(posTerminalsTable.registeredAt));

      // Operational status comes from sales, because a ticket carries a writer
      // and not a device - there is no heartbeat to read. One grouped query for
      // every holder rather than one per terminal.
      const holderIds = rows.map((r) => r.writerId).filter((id): id is string => !!id);

      const activity = new Map<string, { lastSaleAt: Date | null; salesToday: number }>();
      if (holderIds.length > 0) {
        const sales = await db
          .select({
            writerId: ticketsTable.writerId,
            lastSaleAt: sql<Date | null>`max(${ticketsTable.createdAt})`,
            salesToday: sql<number>`count(*) filter (where date(${ticketsTable.createdAt}) = current_date)::int`,
          })
          .from(ticketsTable)
          .where(
            and(
              inArray(ticketsTable.writerId, holderIds),
              sql`${ticketsTable.status} not in ('cancelled', 'void')`,
            ),
          )
          .groupBy(ticketsTable.writerId);
        for (const r of sales) {
          activity.set(r.writerId, {
            lastSaleAt: r.lastSaleAt ? new Date(r.lastSaleAt) : null,
            salesToday: r.salesToday ?? 0,
          });
        }
      }

      const cutoff = Date.now() - windowMinutes * 60_000;

      res.json(
        rows.map((r) => {
          const act = r.writerId ? activity.get(r.writerId) : undefined;
          const lastSaleAt = act?.lastSaleAt ?? null;
          return {
            ...r,
            lastSaleAt,
            salesToday: act?.salesToday ?? 0,
            // An unheld terminal is not "inactive", it is in stock. The UI
            // shows that as its own state rather than colouring it red, so red
            // keeps meaning the one thing worth acting on: issued, and silent.
            isActive: !!r.writerId && !!lastSaleAt && lastSaleAt.getTime() >= cutoff,
          };
        }),
      );
    } catch (error) {
      console.error("Error listing terminals:", error);
      res.status(500).json({ error: "Failed to load terminals" });
    }
  },
);

router.post(
  "/inventory/terminals",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const parse = CreateTerminalBody.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid request body", details: parse.error.format() });
      return;
    }

    const serialNumber = parse.data.serialNumber.trim();
    const brand = parse.data.brand.trim();
    const model = parse.data.model.trim();
    const imei = parse.data.imei.replace(/[\s-]/g, "");

    if (!serialNumber || !brand || !model) {
      res.status(400).json({ error: "Serial number, brand and model are all required" });
      return;
    }
    if (!IMEI_SHAPE.test(imei)) {
      res.status(400).json({ error: "IMEI must be 14 to 17 digits, numbers only" });
      return;
    }

    try {
      const [created] = await db
        .insert(posTerminalsTable)
        .values({
          serialNumber,
          brand,
          model,
          imei,
          notes: parse.data.notes?.trim() || null,
          registeredBy: req.user!.userId,
        })
        .returning();
      res.status(201).json(created);
    } catch (error) {
      // Both columns are unique, and saying which one collided is the
      // difference between a clerk fixing a typo and re-entering everything.
      // The constraint name comes from the driver error underneath Drizzle's
      // wrapper; see lib/pg-errors for why the wrapper's own message must not
      // be sniffed for column names.
      const violated = uniqueViolation(error);
      if (violated === "pos_terminals_serial_number_unique") {
        res.status(409).json({ error: `Serial number ${serialNumber} is already registered` });
        return;
      }
      if (violated === "pos_terminals_imei_unique") {
        res.status(409).json({ error: `IMEI ${imei} is already registered` });
        return;
      }
      console.error("Error registering terminal:", error);
      res.status(500).json({ error: "Failed to register terminal" });
    }
  },
);

/**
 * Hand a terminal to a writer.
 *
 * Closing the writer's previous holding and the terminal's previous holding
 * happens in the same transaction as the insert. Separately, the two partial
 * unique indexes mean a concurrent second request fails rather than creating a
 * device that is in two places.
 */
router.post(
  "/inventory/terminals/assign",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const parse = AssignTerminalBody.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid request body", details: parse.error.format() });
      return;
    }
    const { terminalId, writerId } = parse.data;

    try {
      const [terminal] = await db
        .select()
        .from(posTerminalsTable)
        .where(eq(posTerminalsTable.id, terminalId))
        .limit(1);
      if (!terminal) {
        res.status(404).json({ error: "Terminal not found" });
        return;
      }
      if (terminal.status === "lost" || terminal.status === "retired") {
        res.status(409).json({ error: `Terminal ${terminal.serialNumber} is marked ${terminal.status}` });
        return;
      }

      const [writer] = await db
        .select({ id: writersTable.id, isActive: writersTable.isActive, fullCode: writersTable.fullCode })
        .from(writersTable)
        .where(eq(writersTable.id, writerId))
        .limit(1);
      if (!writer) {
        res.status(404).json({ error: "Writer not found" });
        return;
      }
      if (!writer.isActive) {
        res.status(409).json({ error: `Writer ${writer.fullCode} is not active` });
        return;
      }

      const assignmentId = await db.transaction(async (tx) => {
        const now = new Date();

        /*
         * Lock the writer row, then the terminal row, always in that order.
         *
         * Without this the transaction took its locks in whatever order its
         * statements happened to touch rows - assignments by writer, then by
         * terminal, then pos_terminals - so two concurrent assignments sharing
         * a writer or a device could each hold what the other needed next. A
         * 20-request storm reliably produced SQLSTATE 40P01, deadlock
         * detected, and the loser got a 500. Acquiring both rows up front in a
         * fixed order means two conflicting assignments queue instead.
         */
        await tx.execute(sql`select 1 from ${writersTable} where ${writersTable.id} = ${writerId} for update`);
        await tx.execute(sql`select 1 from ${posTerminalsTable} where ${posTerminalsTable.id} = ${terminalId} for update`);

        // Whatever this writer was holding goes back, and we keep the id so the
        // device can be put back in stock without having to guess which it was.
        const freedByWriter = await tx
          .update(terminalAssignmentsTable)
          .set({ returnedAt: now })
          .where(
            and(
              eq(terminalAssignmentsTable.writerId, writerId),
              isNull(terminalAssignmentsTable.returnedAt),
            ),
          )
          .returning({ terminalId: terminalAssignmentsTable.terminalId });

        // And whoever was holding this terminal gives it up.
        await tx
          .update(terminalAssignmentsTable)
          .set({ returnedAt: now })
          .where(
            and(
              eq(terminalAssignmentsTable.terminalId, terminalId),
              isNull(terminalAssignmentsTable.returnedAt),
            ),
          );

        // Devices the writer just gave up return to stock. Taken from
        // RETURNING rather than re-derived: an earlier version matched rows on
        // returned_at equalling this statement's own timestamp, which is both
        // fragile and part of what made the lock order unpredictable.
        const freedIds = freedByWriter.map((r) => r.terminalId).filter((id) => id !== terminalId);
        if (freedIds.length > 0) {
          await tx
            .update(posTerminalsTable)
            .set({ status: "available" })
            .where(inArray(posTerminalsTable.id, freedIds));
        }

        const [inserted] = await tx
          .insert(terminalAssignmentsTable)
          .values({
            terminalId,
            writerId,
            notes: parse.data.notes?.trim() || null,
            assignedBy: req.user!.userId,
          })
          .returning({ id: terminalAssignmentsTable.id });

        await tx
          .update(posTerminalsTable)
          .set({ status: "assigned" })
          .where(eq(posTerminalsTable.id, terminalId));

        return inserted!.id;
      });

      const [record] = await db
        .select(terminalAssignmentSelection)
        .from(terminalAssignmentsTable)
        .innerJoin(posTerminalsTable, eq(terminalAssignmentsTable.terminalId, posTerminalsTable.id))
        .innerJoin(writersTable, eq(terminalAssignmentsTable.writerId, writersTable.id))
        .leftJoin(agentsTable, eq(writersTable.agentId, agentsTable.id))
        .where(eq(terminalAssignmentsTable.id, assignmentId))
        .limit(1);

      res.status(201).json(record);
    } catch (error) {
      // The two partial unique indexes are what catch a concurrent assignment.
      const violated = uniqueViolation(error);
      if (violated === "terminal_assignments_one_open_per_writer") {
        res.status(409).json({ error: "That writer was given a terminal by someone else just now" });
        return;
      }
      if (violated === "terminal_assignments_one_open_per_terminal") {
        res.status(409).json({ error: "That terminal was assigned by someone else just now" });
        return;
      }
      console.error("Error assigning terminal:", error);
      res.status(500).json({ error: "Failed to assign terminal" });
    }
  },
);

/** Columns every assignment response carries, so the shapes cannot drift apart. */
const terminalAssignmentSelection = {
  id: terminalAssignmentsTable.id,
  terminalId: terminalAssignmentsTable.terminalId,
  terminalSerialNumber: posTerminalsTable.serialNumber,
  terminalBrand: posTerminalsTable.brand,
  terminalModel: posTerminalsTable.model,
  writerId: terminalAssignmentsTable.writerId,
  writerCode: writersTable.fullCode,
  writerName: writersTable.fullName,
  writerPhone: writersTable.phone,
  agencyName: agentsTable.agencyName,
  assignedAt: terminalAssignmentsTable.assignedAt,
  returnedAt: terminalAssignmentsTable.returnedAt,
  notes: terminalAssignmentsTable.notes,
  assignedBy: terminalAssignmentsTable.assignedBy,
  createdAt: terminalAssignmentsTable.createdAt,
};

router.get(
  "/inventory/terminal-assignments",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (req, res) => {
    try {
      const terminalId = typeof req.query["terminalId"] === "string" ? req.query["terminalId"] : undefined;
      const rows = await db
        .select(terminalAssignmentSelection)
        .from(terminalAssignmentsTable)
        .innerJoin(posTerminalsTable, eq(terminalAssignmentsTable.terminalId, posTerminalsTable.id))
        .innerJoin(writersTable, eq(terminalAssignmentsTable.writerId, writersTable.id))
        .leftJoin(agentsTable, eq(writersTable.agentId, agentsTable.id))
        .where(terminalId ? eq(terminalAssignmentsTable.terminalId, terminalId) : undefined)
        .orderBy(desc(terminalAssignmentsTable.assignedAt));
      res.json(rows);
    } catch (error) {
      console.error("Error listing terminal assignments:", error);
      res.status(500).json({ error: "Failed to load terminal assignments" });
    }
  },
);

router.post(
  "/inventory/terminal-assignments/:id/return",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const id = req.params["id"] as string;
    const parse = ReturnTerminalAssignmentBody.safeParse(req.body ?? {});
    if (!parse.success) {
      res.status(400).json({ error: "Invalid request body", details: parse.error.format() });
      return;
    }

    try {
      const [existing] = await db
        .select()
        .from(terminalAssignmentsTable)
        .where(eq(terminalAssignmentsTable.id, id))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: "Terminal assignment not found" });
        return;
      }
      if (existing.returnedAt) {
        res.status(409).json({ error: "That terminal has already been handed back" });
        return;
      }

      await db.transaction(async (tx) => {
        await tx
          .update(terminalAssignmentsTable)
          .set({
            returnedAt: new Date(),
            // Keep the note written at assignment if no new one is given.
            notes: parse.data.notes?.trim() || existing.notes,
          })
          .where(eq(terminalAssignmentsTable.id, id));
        await tx
          .update(posTerminalsTable)
          .set({ status: "available" })
          .where(eq(posTerminalsTable.id, existing.terminalId));
      });

      const [record] = await db
        .select(terminalAssignmentSelection)
        .from(terminalAssignmentsTable)
        .innerJoin(posTerminalsTable, eq(terminalAssignmentsTable.terminalId, posTerminalsTable.id))
        .innerJoin(writersTable, eq(terminalAssignmentsTable.writerId, writersTable.id))
        .leftJoin(agentsTable, eq(writersTable.agentId, agentsTable.id))
        .where(eq(terminalAssignmentsTable.id, id))
        .limit(1);

      res.json(record);
    } catch (error) {
      console.error("Error returning terminal:", error);
      res.status(500).json({ error: "Failed to record terminal return" });
    }
  },
);

export default router;
