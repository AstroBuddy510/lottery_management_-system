import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  CreateUserBody,
  UpdateUserBody,
  UpdateUserParams,
  DeactivateUserParams,
  RegeneratePinParams,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

function generatePin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

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
        phone: usersTable.phone,
        role: usersTable.role,
        isActive: usersTable.isActive,
        profilePicture: usersTable.profilePicture,
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
    const { fullName, phone, role } = parse.data;

    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.phone, phone))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: "Phone number already in use" });
      return;
    }

    const pin = generatePin();
    const pinHash = await bcrypt.hash(pin, 10);

    const [user] = await db
      .insert(usersTable)
      .values({ fullName, phone, pinHash, role })
      .returning();

    res.status(201).json({
      id: user!.id,
      fullName: user!.fullName,
      phone: user!.phone,
      role: user!.role,
      isActive: user!.isActive,
      createdAt: user!.createdAt,
      pin,
    });
  },
);

router.post(
  "/users/:id/regenerate-pin",
  requireAuth,
  requireRole("director", "administrator"),
  async (req, res) => {
    const parse = RegeneratePinParams.safeParse(req.params);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }

    const pin = generatePin();
    const pinHash = await bcrypt.hash(pin, 10);

    const [user] = await db
      .update(usersTable)
      .set({ pinHash })
      .where(eq(usersTable.id, parse.data.id))
      .returning({ id: usersTable.id });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({ pin });
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
    if (bodyResult.data.phone) updates.phone = bodyResult.data.phone;
    if (bodyResult.data.role) updates.role = bodyResult.data.role;
    if (bodyResult.data.isActive !== undefined) updates.isActive = bodyResult.data.isActive;
    if ("profilePicture" in bodyResult.data) updates.profilePicture = bodyResult.data.profilePicture;

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
      phone: user.phone,
      role: user.role,
      isActive: user.isActive,
    });
  },
);

router.patch(
  "/users/me/photo",
  requireAuth,
  async (req, res) => {
    const { profilePicture } = (req.body ?? {}) as { profilePicture?: string | null };
    const [user] = await db
      .update(usersTable)
      .set({ profilePicture: profilePicture ?? null })
      .where(eq(usersTable.id, req.user!.userId))
      .returning();
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({
      id: user.id,
      fullName: user.fullName,
      phone: user.phone,
      role: user.role,
      isActive: user.isActive,
      profilePicture: user.profilePicture ?? null,
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
