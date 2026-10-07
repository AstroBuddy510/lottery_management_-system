import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable, writersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { LoginBody, RefreshTokenBody } from "@workspace/api-zod";
import { requireAuth } from "../middleware/auth";
import type { JwtPayload } from "../middleware/auth";
import { clientIp } from "../lib/login-throttle";
import { issuedBeforeRevocation, mintTokens, verifyToken } from "../lib/tokens";
import {
  checkLoginAllowed,
  registerLoginFailure,
  registerLoginSuccess,
} from "../lib/login-throttle-db";

const router = Router();

/** See the note in writer-auth.ts. */
const DUMMY_HASH = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY = "7d";


router.post("/auth/login", async (req, res) => {
  const parse = LoginBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { phone, role, pin } = parse.data;

  const ip = clientIp(req.headers as Record<string, unknown>, req.ip);
  const gate = await checkLoginAllowed(phone, ip);
  if (!gate.allowed) {
    res.setHeader("Retry-After", String(gate.retryAfterSeconds));
    res.status(429).json({
      error:
        gate.scope === "ip"
          ? "Too many sign-in attempts from this network. Try again shortly."
          : "Too many wrong PINs. This account is locked for a moment.",
      retryAfterSeconds: gate.retryAfterSeconds,
    });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.phone, phone), eq(usersTable.role, role)))
    .limit(1);

  // Same single answer, for the same reason as the writer route - and the
  // role is part of the lookup, so differing replies would also have told an
  // attacker which role a number belongs to.
  const refuse = async () => {
    await registerLoginFailure(phone, ip);
    res.status(401).json({
      error:
        "That phone number and PIN do not match. If your account is new, ask your administrator.",
    });
  };

  if (!user || !user.isActive || !user.pinHash) {
    await bcrypt.compare(pin, DUMMY_HASH);
    await refuse();
    return;
  }

  const valid = await bcrypt.compare(pin, user.pinHash);
  if (!valid) {
    await refuse();
    return;
  }

  await registerLoginSuccess(phone, ip);

  await db
    .update(usersTable)
    .set({ lastLogin: new Date() })
    .where(eq(usersTable.id, user.id));

  const payload = {
    userId: user.id,
    role: user.role,
    phone: user.phone!,
  };
  const { accessToken, refreshToken } = mintTokens(payload);
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

/**
 * Exchange a refresh token for a fresh pair.
 *
 * This is the one point where a live session meets the database, so it is
 * where account state is enforced. It used to re-mint straight from the old
 * token's claims: an account could be deactivated, rejected or demoted and
 * roll its session forward for ever, because nothing ever asked.
 *
 * The role is taken from the database, not from the token, so a demotion
 * takes hold at the next refresh rather than never. Writers live in their own
 * table and are resolved there.
 */
router.post("/auth/refresh", async (req, res) => {
  const parse = RefreshTokenBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  // Must be a refresh token. An access token presented here is refused.
  const claims = verifyToken(parse.data.refreshToken, "refresh");
  if (!claims) {
    res.status(401).json({ error: "Invalid or expired refresh token" });
    return;
  }

  const denied = () => {
    res.status(401).json({ error: "Session is no longer valid" });
  };

  if (claims.role === "writer") {
    const [writer] = await db
      .select()
      .from(writersTable)
      .where(eq(writersTable.id, claims.userId))
      .limit(1);
    if (
      !writer ||
      !writer.isActive ||
      writer.approvalStatus !== "approved" ||
      issuedBeforeRevocation(claims, writer.sessionsValidFrom)
    ) {
      denied();
      return;
    }
    res.json(mintTokens({ userId: writer.id, role: "writer", phone: writer.phone! }));
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, claims.userId))
    .limit(1);
  if (!user || !user.isActive || issuedBeforeRevocation(claims, user.sessionsValidFrom)) {
    denied();
    return;
  }

  // user.role, not claims.role - this is what makes a demotion stick.
  res.json(mintTokens({ userId: user.id, role: user.role, phone: user.phone! }));
});

/**
 * Sign out, and mean it.
 *
 * This used to return success and do nothing: both tokens stayed valid for
 * their full life, so signing out of a shared terminal left a working session
 * behind. Stamping the account revokes every refresh token issued up to now,
 * so the session cannot be rolled forward.
 *
 * The access token already in hand still works until it expires - at most
 * fifteen minutes. Closing that too would mean a database read on every
 * request, which this deployment cannot afford; the short expiry is what
 * bounds it.
 */
router.post("/auth/logout", requireAuth, async (req, res) => {
  const now = new Date();
  if (req.user!.role === "writer") {
    await db
      .update(writersTable)
      .set({ sessionsValidFrom: now })
      .where(eq(writersTable.id, req.user!.userId));
  } else {
    await db
      .update(usersTable)
      .set({ sessionsValidFrom: now })
      .where(eq(usersTable.id, req.user!.userId));
  }
  res.json({ success: true });
});

router.get("/auth/time", (req, res) => {
  res.json({ utcTime: new Date().toISOString() });
});

router.get("/auth/me", requireAuth, async (req, res) => {
  // Writers live in writersTable, not usersTable. Their JWT carries a
  // writers.id, so resolve them separately or session hydration 404s on
  // every page reload.
  if (req.user!.role === "writer") {
    const [writer] = await db
      .select()
      .from(writersTable)
      .where(eq(writersTable.id, req.user!.userId))
      .limit(1);
    if (!writer || !writer.isActive) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({
      id: writer.id,
      fullName: writer.fullName,
      phone: writer.phone,
      role: "writer",
      isActive: writer.isActive,
      profilePicture: null,
      createdAt: writer.createdAt,
      lastLogin: null,
      agentId: writer.agentId,
      fullCode: writer.fullCode,
      operationModel: writer.operationModel,
    });
    return;
  }

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
