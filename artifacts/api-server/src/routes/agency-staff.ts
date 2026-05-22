import { Router } from "express";
import { db, agencyStaffTable, agentsTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  ListAgencyStaffParams,
  CreateAgencyStaffParams,
  CreateAgencyStaffBody,
  UpdateAgencyStaffParams,
  UpdateAgencyStaffBody,
  DeleteAgencyStaffParams,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

// GET /agents/staff-expenses (Cashier/Admin view for overview of operational spending)
router.get(
  "/agents/staff-expenses",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (_req, res) => {
    try {
      const agentsList = await db
        .select({
          agentId: agentsTable.id,
          agentCode: agentsTable.agentCode,
          fullCode: agentsTable.fullCode,
          agencyName: agentsTable.agencyName,
          agentName: usersTable.fullName,
        })
        .from(agentsTable)
        .innerJoin(usersTable, eq(agentsTable.userId, usersTable.id));

      const staffList = await db.select().from(agencyStaffTable);

      const result = agentsList.map((a) => {
        const myStaff = staffList.filter((s) => s.agentId === a.agentId);
        const totalSalary = myStaff.reduce((sum, s) => sum + parseFloat(s.salary || "0"), 0);
        const totalAllowances = myStaff.reduce((sum, s) => sum + parseFloat(s.allowances || "0"), 0);
        const totalBonuses = myStaff.reduce((sum, s) => sum + parseFloat(s.bonuses || "0"), 0);
        const totalExpenses = totalSalary + totalAllowances + totalBonuses;

        return {
          agentId: a.agentId,
          agentCode: a.agentCode,
          fullCode: a.fullCode,
          agencyName: a.agencyName ?? null,
          agentName: a.agentName,
          totalSalary: totalSalary.toFixed(2),
          totalAllowances: totalAllowances.toFixed(2),
          totalBonuses: totalBonuses.toFixed(2),
          totalExpenses: totalExpenses.toFixed(2),
        };
      });

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /agents/:agentId/staff (List staff for agency)
router.get(
  "/agents/:agentId/staff",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const paramsResult = ListAgencyStaffParams.safeParse(req.params);
    if (!paramsResult.success) {
      res.status(400).json({ error: "Invalid agentId parameter" });
      return;
    }
    try {
      const staff = await db
        .select()
        .from(agencyStaffTable)
        .where(eq(agencyStaffTable.agentId, paramsResult.data.agentId))
        .orderBy(agencyStaffTable.name);
      res.json(staff);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /agents/:agentId/staff (Create agency staff)
router.post(
  "/agents/:agentId/staff",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const paramsResult = CreateAgencyStaffParams.safeParse(req.params);
    if (!paramsResult.success) {
      res.status(400).json({ error: "Invalid agentId parameter" });
      return;
    }
    const bodyResult = CreateAgencyStaffBody.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    try {
      const [agent] = await db
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.id, paramsResult.data.agentId))
        .limit(1);

      if (!agent) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }

      const [staff] = await db
        .insert(agencyStaffTable)
        .values({
          agentId: paramsResult.data.agentId,
          name: bodyResult.data.name.trim(),
          salary: bodyResult.data.salary,
          allowances: bodyResult.data.allowances ?? "0",
          bonuses: bodyResult.data.bonuses ?? "0",
        })
        .returning();

      res.status(201).json(staff);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// PATCH /agents/:agentId/staff/:id (Update agency staff)
router.patch(
  "/agents/:agentId/staff/:id",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const paramsResult = UpdateAgencyStaffParams.safeParse(req.params);
    if (!paramsResult.success) {
      res.status(400).json({ error: "Invalid parameters" });
      return;
    }
    const bodyResult = UpdateAgencyStaffBody.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    try {
      const [existing] = await db
        .select()
        .from(agencyStaffTable)
        .where(
          and(
            eq(agencyStaffTable.id, paramsResult.data.id),
            eq(agencyStaffTable.agentId, paramsResult.data.agentId)
          )
        )
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Agency staff member not found" });
        return;
      }

      const updates: Partial<typeof agencyStaffTable.$inferInsert> = {};
      if (bodyResult.data.name !== undefined) updates.name = bodyResult.data.name.trim();
      if (bodyResult.data.salary !== undefined) updates.salary = bodyResult.data.salary;
      if (bodyResult.data.allowances !== undefined) updates.allowances = bodyResult.data.allowances;
      if (bodyResult.data.bonuses !== undefined) updates.bonuses = bodyResult.data.bonuses;

      const [staff] = await db
        .update(agencyStaffTable)
        .set(updates)
        .where(eq(agencyStaffTable.id, paramsResult.data.id))
        .returning();

      res.json(staff);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// DELETE /agents/:agentId/staff/:id (Delete agency staff)
router.delete(
  "/agents/:agentId/staff/:id",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const paramsResult = DeleteAgencyStaffParams.safeParse(req.params);
    if (!paramsResult.success) {
      res.status(400).json({ error: "Invalid parameters" });
      return;
    }

    try {
      const [existing] = await db
        .select()
        .from(agencyStaffTable)
        .where(
          and(
            eq(agencyStaffTable.id, paramsResult.data.id),
            eq(agencyStaffTable.agentId, paramsResult.data.agentId)
          )
        )
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Agency staff member not found" });
        return;
      }

      await db.delete(agencyStaffTable).where(eq(agencyStaffTable.id, paramsResult.data.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
