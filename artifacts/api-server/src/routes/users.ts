import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable, agentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  CreateUserBody,
  UpdateUserBody,
  UpdateUserParams,
  DeactivateUserParams,
  RegeneratePinParams,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { clearLoginThrottle } from "../lib/login-throttle-db";
// The same cryptographic generator the writer flows use. The staff PIN was
// built from Math.random(), which is seeded and predictable - fine for a
// shuffle, not for a credential that is the whole of someone's login.
import { generatePin } from "../lib/writer-onboarding";

const router = Router();

/**
 * Who may act on whom.
 *
 * An administrator could promote themselves to director, create a director
 * outright, read back any director's PIN, or delete a director - four doors
 * into the role that is meant to supervise them. The rule is now stated once
 * and applied at all four: a director is touched only by a director.
 */
async function isDirector(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return row?.role === "director";
}

/** True when the caller may not act on this target, having said why. */
async function blockedByRank(
  req: { user?: { role: string; userId: string } },
  targetId: string,
  res: { status: (c: number) => { json: (b: unknown) => void } },
): Promise<boolean> {
  if (req.user!.role === "director") return false;
  if (await isDirector(targetId)) {
    res.status(403).json({ error: "Only a director may act on a director's account" });
    return true;
  }
  return false;
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

    // Creating a director is as good as becoming one: the PIN comes back in
    // this very response.
    if (role === "director" && req.user!.role !== "director") {
      res.status(403).json({ error: "Only a director may create a director" });
      return;
    }

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

    // The plaintext PIN comes back in this response, so resetting someone's
    // PIN is the same as taking their account.
    if (await blockedByRank(req, parse.data.id, res)) return;

    const pin = generatePin();
    const pinHash = await bcrypt.hash(pin, 10);

    const [user] = await db
      .update(usersTable)
      .set({ pinHash })
      .where(eq(usersTable.id, parse.data.id))
      .returning({ id: usersTable.id, phone: usersTable.phone });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Same reason as the writer reset: someone being given a new PIN has
    // usually just failed with the old one, and a lock left in place would
    // make the new PIN look wrong.
    if (user.phone) await clearLoginThrottle(user.phone);

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
    const targetId = paramsResult.data.id;

    // Nobody edits their own rank. This is the self-promotion door: an
    // administrator could set their own role to director and simply be one.
    if (targetId === req.user!.userId && bodyResult.data.role) {
      res.status(403).json({ error: "You cannot change your own role" });
      return;
    }
    if (await blockedByRank(req, targetId, res)) return;
    // Nor may an administrator mint a director by promotion rather than
    // creation - the same door, approached from the other side.
    if (bodyResult.data.role === "director" && req.user!.role !== "director") {
      res.status(403).json({ error: "Only a director may grant the director role" });
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
  requireRole("director", "administrator"),
  async (req, res) => {
    const parse = DeactivateUserParams.safeParse(req.params);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }
    const userId = parse.data.id;

    // Removing the role that supervises you is escalation by subtraction.
    if (await blockedByRank(req, userId, res)) return;
    // And deleting yourself is how an organisation locks itself out of its
    // own system - irreversibly, if you were the last director.
    if (userId === req.user!.userId) {
      res.status(403).json({ error: "You cannot delete your own account" });
      return;
    }

    try {
      // First, try deleting the agent associated with this user if they are an agent
      await db.delete(agentsTable).where(eq(agentsTable.userId, userId));

      // Then try physically deleting the user
      const [deletedUser] = await db
        .delete(usersTable)
        .where(eq(usersTable.id, userId))
        .returning({ id: usersTable.id });

      if (!deletedUser) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      res.json({ success: true, id: deletedUser.id, deleted: true });
    } catch (err) {
      // Catch foreign key constraint violation and fall back to deactivation
      const [user] = await db
        .update(usersTable)
        .set({ isActive: false })
        .where(eq(usersTable.id, userId))
        .returning({ id: usersTable.id });

      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      res.json({ success: true, id: user.id, deactivated: true });
    }
  },
);

export default router;
