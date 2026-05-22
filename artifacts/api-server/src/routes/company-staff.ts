import { Router } from "express";
import { db, companyStaffTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateCompanyStaffBody,
  UpdateCompanyStaffParams,
  UpdateCompanyStaffBody,
  DeleteCompanyStaffParams,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

// GET /company-staff (List all internal company staff)
router.get(
  "/company-staff",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (_req, res) => {
    try {
      const staff = await db
        .select()
        .from(companyStaffTable)
        .orderBy(companyStaffTable.fullName);
      res.json(staff);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /company-staff (Add new company staff member)
router.post(
  "/company-staff",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (req, res) => {
    const bodyResult = CreateCompanyStaffBody.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    try {
      const [staff] = await db
        .insert(companyStaffTable)
        .values({
          fullName: bodyResult.data.fullName.trim(),
          position: bodyResult.data.position.trim(),
          profilePicture: bodyResult.data.profilePicture ?? null,
          salary: bodyResult.data.salary,
          allowances: bodyResult.data.allowances ?? "0",
          bonuses: bodyResult.data.bonuses ?? "0",
          status: bodyResult.data.status ?? "active",
        })
        .returning();

      res.status(201).json(staff);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// PATCH /company-staff/:id (Update company staff details / suspend)
router.patch(
  "/company-staff/:id",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (req, res) => {
    const paramsResult = UpdateCompanyStaffParams.safeParse(req.params);
    if (!paramsResult.success) {
      res.status(400).json({ error: "Invalid parameters" });
      return;
    }
    const bodyResult = UpdateCompanyStaffBody.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    try {
      const [existing] = await db
        .select()
        .from(companyStaffTable)
        .where(eq(companyStaffTable.id, paramsResult.data.id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Company staff member not found" });
        return;
      }

      const updates: Partial<typeof companyStaffTable.$inferInsert> = {};
      if (bodyResult.data.fullName !== undefined) updates.fullName = bodyResult.data.fullName.trim();
      if (bodyResult.data.position !== undefined) updates.position = bodyResult.data.position.trim();
      if (bodyResult.data.profilePicture !== undefined) updates.profilePicture = bodyResult.data.profilePicture;
      if (bodyResult.data.salary !== undefined) updates.salary = bodyResult.data.salary;
      if (bodyResult.data.allowances !== undefined) updates.allowances = bodyResult.data.allowances;
      if (bodyResult.data.bonuses !== undefined) updates.bonuses = bodyResult.data.bonuses;
      if (bodyResult.data.status !== undefined) updates.status = bodyResult.data.status;

      const [staff] = await db
        .update(companyStaffTable)
        .set(updates)
        .where(eq(companyStaffTable.id, paramsResult.data.id))
        .returning();

      res.json(staff);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// DELETE /company-staff/:id (Delete company staff member)
router.delete(
  "/company-staff/:id",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (req, res) => {
    const paramsResult = DeleteCompanyStaffParams.safeParse(req.params);
    if (!paramsResult.success) {
      res.status(400).json({ error: "Invalid parameters" });
      return;
    }

    try {
      const [existing] = await db
        .select()
        .from(companyStaffTable)
        .where(eq(companyStaffTable.id, paramsResult.data.id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Company staff member not found" });
        return;
      }

      await db.delete(companyStaffTable).where(eq(companyStaffTable.id, paramsResult.data.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
