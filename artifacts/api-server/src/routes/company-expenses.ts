import { Router } from "express";
import { db, companyExpensesTable, usersTable } from "@workspace/db";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import {
  CreateCompanyExpenseBody,
  ListCompanyExpensesQueryParams,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

router.get(
  "/company-expenses",
  requireAuth,
  requireRole("director", "administrator", "cashier"),
  async (req, res) => {
    const parseQuery = ListCompanyExpensesQueryParams.safeParse(req.query);
    if (!parseQuery.success) {
      res.status(400).json({ error: "Invalid query parameters" });
      return;
    }

    const conditions = [];
    if (parseQuery.data.startDate) {
      const start = new Date(parseQuery.data.startDate);
      start.setHours(0, 0, 0, 0);
      conditions.push(gte(companyExpensesTable.createdAt, start));
    }
    if (parseQuery.data.endDate) {
      const end = new Date(parseQuery.data.endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(companyExpensesTable.createdAt, end));
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

      res.status(201).json({
        ...inserted,
        cashierName: cashier?.fullName ?? "Unknown Cashier",
      });
    } catch (error) {
      console.error("Error creating company expense:", error);
      res.status(500).json({ error: "Failed to record company expense" });
    }
  },
);

export default router;
