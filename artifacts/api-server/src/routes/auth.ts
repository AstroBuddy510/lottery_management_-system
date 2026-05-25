import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { LoginBody, RefreshTokenBody } from "@workspace/api-zod";
import { requireAuth } from "../middleware/auth";
import type { JwtPayload } from "../middleware/auth";

const router = Router();
const JWT_SECRET = process.env["SESSION_SECRET"] ?? "dev-secret-change-in-prod";
const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY = "7d";

function generateTokens(payload: JwtPayload): {
  accessToken: string;
  refreshToken: string;
} {
  const accessToken = jwt.sign(payload, JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });
  const refreshToken = jwt.sign(payload, JWT_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });
  return { accessToken, refreshToken };
}

router.post("/auth/login", async (req, res) => {
  const parse = LoginBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { phone, role, pin } = parse.data;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.phone, phone), eq(usersTable.role, role)))
    .limit(1);

  if (!user || !user.isActive) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  if (!user.pinHash) {
    res.status(401).json({ error: "Account not configured — contact your administrator" });
    return;
  }

  const valid = await bcrypt.compare(pin, user.pinHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  await db
    .update(usersTable)
    .set({ lastLogin: new Date() })
    .where(eq(usersTable.id, user.id));

  const payload: JwtPayload = {
    userId: user.id,
    role: user.role,
    phone: user.phone!,
  };
  const { accessToken, refreshToken } = generateTokens(payload);
  res.json({
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      fullName: user.fullName,
      phone: user.phone,
      role: user.role,
    },
  });
});

router.post("/auth/refresh", (req, res) => {
  const parse = RefreshTokenBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { refreshToken } = parse.data;
  try {
    const decoded = jwt.verify(refreshToken, JWT_SECRET) as JwtPayload;
    const payload: JwtPayload = {
      userId: decoded.userId,
      role: decoded.role,
      phone: decoded.phone,
    };
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(payload);
    res.json({ accessToken, refreshToken: newRefreshToken });
  } catch {
    res.status(401).json({ error: "Invalid or expired refresh token" });
  }
});

router.post("/auth/logout", (req, res) => {
  res.json({ success: true });
});

router.get("/auth/time", (req, res) => {
  res.json({ utcTime: new Date().toISOString() });
});

router.get("/auth/me", requireAuth, async (req, res) => {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user!.userId))
    .limit(1);
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
    lastLogin: user.lastLogin,
  });
});

export default router;
