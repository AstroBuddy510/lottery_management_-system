import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  CreateUserBody,
  UpdateUserBody,
  UpdateUserParams,
  DeactivateUserParams,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

router.get(
  "/users",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const { role, isActive } = req.query as Record<string, string>;
    const conditions = [];
    if (role) conditions.push(eq(usersTable.role, role as "director" | "administrator" | "cashier" | "gross_entry" | "wins_entry" | "agent"));
    if (isActive !== undefined)
      conditions.push(eq(usersTable.isActive, isActive === "true"));

    const users = await db
      .select({
        id: usersTable.id,
        fullName: usersTable.fullName,
        email: usersTable.email,
        role: usersTable.role,
        isActive: usersTable.isActive,
        createdAt: usersTable.createdAt,
        lastLogin: usersTable.lastLogin,
      })
      .from(usersTable)
      .where(conditions.length ? and(...conditions) : undefined);
    res.json(users);
  },
);

router.post(
  "/users",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const parse = CreateUserBody.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const { fullName, email, password, role } = parse.data;
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: "Email already in use" });
      return;
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const [user] = await db
      .insert(usersTable)
      .values({ fullName, email, passwordHash, role })
      .returning();
    res.status(201).json({
      id: user!.id,
      fullName: user!.fullName,
      email: user!.email,
      role: user!.role,
      isActive: user!.isActive,
      createdAt: user!.createdAt,
    });
  },
);

router.patch(
  "/users/:id",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const paramsResult = UpdateUserParams.safeParse(req.params);
    if (!paramsResult.success) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }
    const bodyResult = UpdateUserBody.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const updates: Record<string, unknown> = {};
    if (bodyResult.data.fullName) updates.fullName = bodyResult.data.fullName;
    if (bodyResult.data.email) updates.email = bodyResult.data.email;
    if (bodyResult.data.role) updates.role = bodyResult.data.role;
    if (bodyResult.data.isActive !== undefined)
      updates.isActive = bodyResult.data.isActive;
    if (bodyResult.data.password)
      updates.passwordHash = await bcrypt.hash(bodyResult.data.password, 12);

    const [user] = await db
      .update(usersTable)
      .set(updates)
      .where(eq(usersTable.id, paramsResult.data.id))
      .returning();
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
    });
  },
);

router.delete(
  "/users/:id",
  requireAuth,
  requireRole("director"),
  async (req, res) => {
    const parse = DeactivateUserParams.safeParse(req.params);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }
    const [user] = await db
      .update(usersTable)
      .set({ isActive: false })
      .where(eq(usersTable.id, parse.data.id))
      .returning({ id: usersTable.id });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ success: true, id: user.id });
  },
);

export default router;
