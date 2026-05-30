import { Router } from "express";
import {
  db,
  bookletBatchesTable,
  bookletAllocationsTable,
  padlocksTable,
  padlockAssignmentsTable,
  agentsTable,
  writersTable,
  grossEntriesTable,
  usersTable,
} from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import {
  CreateBookletBatchBody,
  CreateBookletAllocationBody,
  CreatePadlockBody,
  AssignPadlockBody,
  ReturnPadlockAssignmentBody,
  UpdatePadlockAssignmentBody,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";

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

    const { agentId, destination, conditionBefore } = parse.data;

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

      // Query randomly for an available padlock
      const [availablePadlock] = await db
        .select()
        .from(padlocksTable)
        .where(eq(padlocksTable.status, "available"))
        .orderBy(sql`random()`)
        .limit(1);

      if (!availablePadlock) {
        res.status(409).json({ error: "No available padlocks in inventory" });
        return;
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
  "/inventory/padlocks/assignments",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (req, res) => {
    try {
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
          openedAt: padlockAssignmentsTable.openedAt,
          returnedAt: padlockAssignmentsTable.returnedAt,
          enteredBy: padlockAssignmentsTable.enteredBy,
          createdAt: padlockAssignmentsTable.createdAt,
        })
        .from(padlockAssignmentsTable)
        .innerJoin(padlocksTable, eq(padlockAssignmentsTable.padlockId, padlocksTable.id))
        .innerJoin(agentsTable, eq(padlockAssignmentsTable.agentId, agentsTable.id))
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
  requireRole("director", "administrator", "cashier"),
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

      const data = parse.data;
      const updates: any = {};
      if (data.padlockId !== undefined) updates.padlockId = data.padlockId;
      if (data.agentId !== undefined) updates.agentId = data.agentId;
      if (data.destination !== undefined) updates.destination = data.destination;
      if (data.conditionBefore !== undefined) updates.conditionBefore = data.conditionBefore;
      if (data.conditionAfter !== undefined) updates.conditionAfter = data.conditionAfter;
      if (data.assignedAt !== undefined) updates.assignedAt = data.assignedAt ? new Date(data.assignedAt) : null;
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

export default router;
