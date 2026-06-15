import { Router } from "express";
import { db, companyExpensesTable, usersTable } from "@workspace/db";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import {
  CreateCompanyExpenseBody,
  ListCompanyExpensesQueryParams,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env["SESSION_SECRET"] ?? "dev-secret-change-in-prod";

interface SSEClient {
  id: string;
  res: any;
  role: string;
}

let clients: SSEClient[] = [];

export function broadcastExpenseUpdate(expense: any) {
  const ssePayload = JSON.stringify({
    type: "EXPENSE_ADDED",
    expense,
  });

  clients.forEach((client) => {
    try {
      client.res.write(`data: ${ssePayload}\n\n`);
    } catch (err) {
      console.error("Error broadcasting to SSE client:", err);
    }
  });
}

const router = Router();

router.get(
  "/company-expenses/sse",
  async (req, res) => {
    let token = req.query.token as string;
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        token = authHeader.slice(7);
      }
    }

    if (!token) {
      res.status(401).json({ error: "Unauthorized: Missing token" });
      return;
    }

    try {
      const payload = jwt.verify(token, JWT_SECRET) as { userId: string; role: string; phone: string };
      if (payload.role !== "director" && payload.role !== "administrator") {
        res.status(403).json({ error: "Forbidden: insufficient role" });
        return;
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      const clientId = Date.now().toString() + Math.random().toString();
      const newClient = { id: clientId, res, role: payload.role };
      clients.push(newClient);

      // Send initial connect acknowledgement
      res.write(`data: ${JSON.stringify({ type: "CONNECTED" })}\n\n`);

      // Heartbeat comment every 15 seconds to keep connection alive
      const intervalId = setInterval(() => {
        res.write(":\n\n");
      }, 15000);

      req.on("close", () => {
        clearInterval(intervalId);
        clients = clients.filter((c) => c.id !== clientId);
      });
    } catch {
      res.status(401).json({ error: "Unauthorized: Invalid token" });
    }
  }
);

router.get(
  "/company-expenses",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (req, res) => {
    const startDateQuery = typeof req.query.startDate === "string" ? req.query.startDate : undefined;
    const endDateQuery = typeof req.query.endDate === "string" ? req.query.endDate : undefined;

    const conditions = [];
    if (startDateQuery && startDateQuery.trim() !== "") {
      const start = new Date(startDateQuery);
      if (!isNaN(start.getTime())) {
        start.setHours(0, 0, 0, 0);
        conditions.push(gte(companyExpensesTable.createdAt, start));
      }
    }
    if (endDateQuery && endDateQuery.trim() !== "") {
      const end = new Date(endDateQuery);
      if (!isNaN(end.getTime())) {
        end.setHours(23, 59, 59, 999);
        conditions.push(lte(companyExpensesTable.createdAt, end));
      }
    }

    try {
      let query = db
        .select({
          id: companyExpensesTable.id,
          type: companyExpensesTable.type,
          recurringExpenseId: companyExpensesTable.recurringExpenseId,
          description: companyExpensesTable.description,
          amount: companyExpensesTable.amount,
          payeeName: companyExpensesTable.payeeName,
          authorizingOfficer: companyExpensesTable.authorizingOfficer,
          receiptImage: companyExpensesTable.receiptImage,
          cashierId: companyExpensesTable.cashierId,
          cashierName: usersTable.fullName,
          createdAt: companyExpensesTable.createdAt,
        })
        .from(companyExpensesTable)
        .leftJoin(usersTable, eq(companyExpensesTable.cashierId, usersTable.id))
        .orderBy(desc(companyExpensesTable.createdAt));

      const expenses = await (conditions.length > 0
        ? query.where(and(...conditions))
        : query);

      res.json(expenses);
    } catch (error) {
      console.error("Error fetching company expenses:", error);
      res.status(500).json({ error: "Failed to fetch company expenses" });
    }
  },
);

router.post(
  "/company-expenses",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (req, res) => {
    const parse = CreateCompanyExpenseBody.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "Invalid request body", details: parse.error.format() });
      return;
    }

    const {
      type,
      recurringExpenseId,
      description,
      amount,
      payeeName,
      authorizingOfficer,
      receiptImage,
    } = parse.data;

    // Additional validations based on expense type
    if (type === "non-recurring") {
      if (!authorizingOfficer || authorizingOfficer.trim() === "") {
        res.status(400).json({ error: "Authorizing Officer is required for non-recurring expenses" });
        return;
      }
      if (!receiptImage || receiptImage.trim() === "") {
        res.status(400).json({ error: "Receipt image upload is required for non-recurring expenses" });
        return;
      }
    }

    try {
      const [inserted] = await db
        .insert(companyExpensesTable)
        .values({
          type,
          recurringExpenseId: recurringExpenseId || null,
          description,
          amount: amount,
          payeeName,
          authorizingOfficer: authorizingOfficer || null,
          receiptImage: receiptImage || null,
          cashierId: req.user!.userId,
        })
        .returning();

      // Retrieve cashier's full name for response consistency
      const [cashier] = await db
        .select({ fullName: usersTable.fullName })
        .from(usersTable)
        .where(eq(usersTable.id, req.user!.userId))
        .limit(1);

      const responseData = {
        ...inserted,
        cashierName: cashier?.fullName ?? "Unknown Cashier",
      };

      // Broadcast update to all connected admins and directors
      broadcastExpenseUpdate(responseData);

      res.status(201).json(responseData);
    } catch (error) {
      console.error("Error creating company expense:", error);
      res.status(500).json({ error: "Failed to record company expense" });
    }
  },
);

export default router;
