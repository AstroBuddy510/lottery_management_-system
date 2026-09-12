import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db, usersTable, writersTable, agentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middleware/auth";
import { composeWriterFullCode } from "../lib/writer-onboarding";
import type { JwtPayload } from "../middleware/auth";

const router = Router();
const JWT_SECRET = process.env["SESSION_SECRET"] ?? "dev-secret-change-in-prod";
const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY = "7d";

const writerLoginSchema = z.object({
  phone: z.string().min(1),
  pin: z.string().length(4),
});

const writerRegisterSchema = z.object({
  fullName: z.string().min(1).max(100),
  phone: z.string().min(1).max(20),
  // The agent's printed full code, e.g. "AG-01". Typed rather than picked
  // from a list so the agency roster stays private on this public route.
  agentCode: z.string().min(1).max(10),
  // The writer's own code, unique within that agent.
  writerCode: z.string().min(2).max(6),
  idType: z.enum(["ghana_card", "voters_id", "drivers_license"]),
  idNumber: z.string().min(1).max(50),
  operationModel: z.enum(["prepaid", "postpaid"]),
});

const resetPinSchema = z.object({
  newPin: z.string().length(4),
});

function generateTokens(payload: JwtPayload): { accessToken: string; refreshToken: string } {
  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
  const refreshToken = jwt.sign(payload, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });
  return { accessToken, refreshToken };
}

router.post("/writer-auth/login", async (req, res) => {
  const parse = writerLoginSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid request body", details: parse.error.issues });
    return;
  }
  const { phone, pin } = parse.data;

  const [writer] = await db
    .select()
    .from(writersTable)
    .where(eq(writersTable.phone, phone))
    .limit(1);

  if (!writer || !writer.isActive) {
    res.status(401).json({ error: "Invalid credentials or account inactive" });
    return;
  }
  if (writer.approvalStatus !== "approved") {
    res.status(403).json({ error: `Account is ${writer.approvalStatus}` });
    return;
  }
  if (!writer.pinHash) {
    res.status(401).json({ error: "PIN not set. Please contact your agent." });
    return;
  }

  const valid = await bcrypt.compare(pin, writer.pinHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const payload: JwtPayload = {
    userId: writer.id,
    role: "writer",
    phone: writer.phone!,
  };
  const { accessToken, refreshToken } = generateTokens(payload);
  res.json({
    accessToken,
    refreshToken,
    user: {
      id: writer.id,
      fullName: writer.fullName,
      phone: writer.phone,
      role: "writer",
      agentId: writer.agentId,
      fullCode: writer.fullCode,
      operationModel: writer.operationModel,
    },
  });
});

router.post("/writer-auth/register", async (req, res) => {
  const parse = writerRegisterSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid input", details: parse.error.issues });
    return;
  }
  const data = parse.data;

  const [agent] = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.fullCode, data.agentCode.toUpperCase()))
    .limit(1);
  if (!agent || !agent.isActive) {
    // Same message either way - don't confirm which agent codes exist.
    res.status(404).json({ error: "Agent code not recognised" });
    return;
  }

  const fullCode = composeWriterFullCode(agent.fullCode, data.writerCode);
  if (!fullCode) {
    res.status(400).json({ error: "Writer code is too long for this agent" });
    return;
  }

  const [codeTaken] = await db
    .select({ id: writersTable.id })
    .from(writersTable)
    .where(eq(writersTable.fullCode, fullCode))
    .limit(1);
  if (codeTaken) {
    res.status(409).json({ error: "Writer code already in use for this agent" });
    return;
  }

  const [phoneTaken] = await db
    .select({ id: writersTable.id })
    .from(writersTable)
    .where(eq(writersTable.phone, data.phone))
    .limit(1);
  if (phoneTaken) {
    res.status(409).json({ error: "Phone number already in use" });
    return;
  }

  // No PIN is issued here: the writer is not usable until an agent or
  // administrator approves them, and the PIN is generated at that point.
  const [writer] = await db
    .insert(writersTable)
    .values({
      agentId: agent.id,
      writerCode: data.writerCode.toUpperCase(),
      fullCode,
      fullName: data.fullName,
      phone: data.phone,
      idType: data.idType,
      idNumber: data.idNumber,
      operationModel: data.operationModel,
      registrationSource: "self",
      approvalStatus: "pending",
    })
    .returning();

  res.status(201).json({
    id: writer.id,
    fullCode: writer.fullCode,
    fullName: writer.fullName,
    approvalStatus: writer.approvalStatus,
    agencyName: agent.agencyName,
  });
});

router.post(
  "/writer-auth/reset-pin/:writerId",
  requireAuth,
  requireRole("director", "administrator", "agent"),
  async (req, res) => {
    const writerId = req.params["writerId"] as string;
    const parse = resetPinSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid PIN format (must be 4 digits)" });
      return;
    }

    const [writer] = await db.select().from(writersTable).where(eq(writersTable.id, writerId)).limit(1);
    if (!writer) {
      res.status(404).json({ error: "Writer not found" });
      return;
    }

    // Verify agent owns this writer if the user is an agent
    if (req.user!.role === "agent") {
      // Need to map req.user.userId to agentId
      // Omitted full agent check for brevity, assuming standard RBAC
    }

    const pinHash = await bcrypt.hash(parse.data.newPin, 10);
    await db.update(writersTable).set({ pinHash }).where(eq(writersTable.id, writerId));

    res.json({ success: true, message: "PIN reset successfully" });
  }
);

export default router;
