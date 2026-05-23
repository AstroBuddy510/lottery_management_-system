import { Router } from "express";
import { 
  db, 
  salaryPaymentsTable, 
  salaryWalletTable, 
  salaryWalletTransactionsTable,
  companyStaffTable,
  agencyStaffTable,
  agentsTable,
  usersTable,
  notificationsTable
} from "@workspace/db";
import { eq, and, desc, asc, gte, lte, sql } from "drizzle-orm";
import {
  CreateSalaryPaymentBody,
  FundSalaryWalletBody
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { addDays, endOfMonth, startOfMonth, format, isAfter, isBefore } from "date-fns";

const router = Router();

// Utility to get or create wallet
async function getWallet() {
  const [wallet] = await db.select().from(salaryWalletTable).limit(1);
  if (wallet) return wallet;
  const [newWallet] = await db.insert(salaryWalletTable).values({}).returning();
  return newWallet;
}

// GET /staff-payroll/summary
router.get("/staff-payroll/summary", requireAuth, requireRole("director", "administrator", "cashier"), async (req, res) => {
  try {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // Get staff counts
    const [{ count: companyCount }] = await db.select({ count: sql<number>`count(*)` }).from(companyStaffTable).where(eq(companyStaffTable.status, "active"));
    const [{ count: agencyCount }] = await db.select({ count: sql<number>`count(*)` }).from(agencyStaffTable);

    // Get payments for current month
    const currentPayments = await db.select()
      .from(salaryPaymentsTable)
      .where(and(
        eq(salaryPaymentsTable.periodMonth, currentMonth),
        eq(salaryPaymentsTable.periodYear, currentYear)
      ));

    let monthlyPayrollDue = 0;
    let paidThisMonth = 0;
    let accruedUnpaid = 0;

    for (const payment of currentPayments) {
      const net = parseFloat(payment.netAmount);
      monthlyPayrollDue += net;
      if (payment.status === "paid") {
        paidThisMonth += net;
      } else {
        accruedUnpaid += net;
      }
    }

    const wallet = await getWallet();
    const payrollCompletionPercent = monthlyPayrollDue > 0 ? (paidThisMonth / monthlyPayrollDue) * 100 : 0;

    const summary: PayrollSummary = {
      totalCompanyStaff: Number(companyCount) || 0,
      totalAgencyStaff: Number(agencyCount) || 0,
      monthlyPayrollDue: monthlyPayrollDue.toFixed(2),
      paidThisMonth: paidThisMonth.toFixed(2),
      accruedUnpaid: accruedUnpaid.toFixed(2),
      walletBalance: parseFloat(wallet.balance).toFixed(2),
      payrollCompletionPercent: parseFloat(payrollCompletionPercent.toFixed(1))
    };

    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /staff-payroll/payments
router.get("/staff-payroll/payments", requireAuth, requireRole("director", "administrator", "cashier"), async (req, res) => {
  try {
    const { month, year, status, staffType } = req.query;

    let conditions = [];
    if (month) conditions.push(eq(salaryPaymentsTable.periodMonth, parseInt(month as string)));
    if (year) conditions.push(eq(salaryPaymentsTable.periodYear, parseInt(year as string)));
    if (status) conditions.push(eq(salaryPaymentsTable.status, status as string));
    if (staffType) conditions.push(eq(salaryPaymentsTable.staffType, staffType as string));

    const payments = await db.select({
      payment: salaryPaymentsTable,
      paidByUser: usersTable,
    })
    .from(salaryPaymentsTable)
    .leftJoin(usersTable, eq(salaryPaymentsTable.paidBy, usersTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(salaryPaymentsTable.createdAt));

    // Resolve staff names manually
    const records: SalaryPaymentRecord[] = await Promise.all(payments.map(async ({ payment, paidByUser }) => {
      let staffName = "Unknown";
      let staffPosition = "Staff";
      let agencyName = null;

      if (payment.staffType === "company") {
        const [staff] = await db.select().from(companyStaffTable).where(eq(companyStaffTable.id, payment.staffId));
        if (staff) {
          staffName = staff.fullName;
          staffPosition = staff.position;
        }
      } else if (payment.staffType === "agency") {
        const [staff] = await db.select().from(agencyStaffTable).where(eq(agencyStaffTable.id, payment.staffId));
        if (staff) {
          staffName = staff.name;
          staffPosition = "Agency Staff";
          const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, staff.agentId));
          if (agent) agencyName = agent.agencyName || agent.fullCode;
        }
      }

      return {
        id: payment.id,
        staffType: payment.staffType as "company" | "agency",
        staffId: payment.staffId,
        staffName,
        staffPosition,
        agencyName,
        agentId: payment.agentId,
        periodMonth: payment.periodMonth,
        periodYear: payment.periodYear,
        baseSalary: parseFloat(payment.baseSalary).toFixed(2),
        allowances: parseFloat(payment.allowances).toFixed(2),
        bonuses: parseFloat(payment.bonuses).toFixed(2),
        deductions: parseFloat(payment.deductions).toFixed(2),
        netAmount: parseFloat(payment.netAmount).toFixed(2),
        status: payment.status as "pending" | "paid" | "partial",
        dueDate: payment.dueDate?.toISOString() ?? null,
        paidBy: payment.paidBy,
        paidByName: paidByUser?.fullName ?? null,
        paidAt: payment.paidAt?.toISOString() ?? null,
        notes: payment.notes,
        createdAt: payment.createdAt.toISOString()
      };
    }));

    res.json(records);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /staff-payroll/payments
router.post("/staff-payroll/payments", requireAuth, requireRole("cashier"), async (req, res) => {
  try {
    const bodyResult = CreateSalaryPaymentBody.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const { salaryPaymentId, deductions, notes } = bodyResult.data;

    // Transaction
    const result = await db.transaction(async (tx) => {
      const [payment] = await tx.select().from(salaryPaymentsTable).where(eq(salaryPaymentsTable.id, salaryPaymentId));
      if (!payment) throw new Error("Payment record not found");
      if (payment.status === "paid") throw new Error("Already paid");

      const deductAmount = parseFloat(deductions || "0");
      const netAmount = parseFloat(payment.baseSalary) + parseFloat(payment.allowances) + parseFloat(payment.bonuses) - deductAmount;

      const wallet = await getWallet();
      const currentBalance = parseFloat(wallet.balance);

      if (currentBalance < netAmount) {
        throw new Error("Insufficient funds in salary wallet");
      }

      const newBalance = currentBalance - netAmount;
      const newTotalDisbursed = parseFloat(wallet.totalDisbursed) + netAmount;

      await tx.update(salaryWalletTable).set({
        balance: newBalance.toString(),
        totalDisbursed: newTotalDisbursed.toString(),
        updatedAt: new Date()
      }).where(eq(salaryWalletTable.id, wallet.id));

      await tx.insert(salaryWalletTransactionsTable).values({
        type: "disburse",
        amount: netAmount.toString(),
        balanceAfter: newBalance.toString(),
        referenceId: payment.id,
        performedBy: (req.user as any).id,
        notes: `Salary payment for ${payment.staffType} staff`
      });

      const [updatedPayment] = await tx.update(salaryPaymentsTable).set({
        deductions: deductAmount.toString(),
        netAmount: netAmount.toString(),
        status: "paid",
        paidBy: (req.user as any).id,
        paidAt: new Date(),
        notes: notes || payment.notes
      }).where(eq(salaryPaymentsTable.id, payment.id)).returning();

      return updatedPayment;
    });

    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /staff-payroll/calendar
router.get("/staff-payroll/calendar", requireAuth, requireRole("director", "administrator", "cashier"), async (req, res) => {
  try {
    // Group pending payments by dueDate
    const pendingPayments = await db.select()
      .from(salaryPaymentsTable)
      .where(eq(salaryPaymentsTable.status, "pending"));

    const calendarMap = new Map<string, { count: number, total: number, names: string[], status: string }>();
    const now = new Date();

    for (const p of pendingPayments) {
      if (!p.dueDate) continue;
      // Format to YYYY-MM-DD
      const dateKey = format(p.dueDate, "yyyy-MM-dd");
      
      let entry = calendarMap.get(dateKey);
      if (!entry) {
        let status = "upcoming";
        if (isBefore(p.dueDate, now)) status = "overdue";
        else if (format(p.dueDate, "yyyy-MM-dd") === format(now, "yyyy-MM-dd")) status = "due";

        entry = { count: 0, total: 0, names: [], status };
        calendarMap.set(dateKey, entry);
      }

      entry.count += 1;
      entry.total += parseFloat(p.netAmount);

      // fetch name just for a few
      if (entry.names.length < 3) {
        if (p.staffType === "company") {
          const [s] = await db.select().from(companyStaffTable).where(eq(companyStaffTable.id, p.staffId));
          if (s) entry.names.push(s.fullName);
        } else {
          const [s] = await db.select().from(agencyStaffTable).where(eq(agencyStaffTable.id, p.staffId));
          if (s) entry.names.push(s.name);
        }
      }
    }

    const calendar: PayrollCalendarEntry[] = Array.from(calendarMap.entries()).map(([date, data]) => ({
      date,
      staffCount: data.count,
      totalAmount: data.total.toFixed(2),
      status: data.status as any,
      staffNames: data.names
    })).sort((a, b) => a.date.localeCompare(b.date));

    res.json(calendar);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /staff-payroll/wallet
router.get("/staff-payroll/wallet", requireAuth, requireRole("director", "administrator", "cashier"), async (req, res) => {
  try {
    const wallet = await getWallet();
    res.json({
      id: wallet.id,
      balance: parseFloat(wallet.balance).toFixed(2),
      totalFunded: parseFloat(wallet.totalFunded).toFixed(2),
      totalDisbursed: parseFloat(wallet.totalDisbursed).toFixed(2),
      updatedAt: wallet.updatedAt.toISOString()
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /staff-payroll/wallet/fund
router.post("/staff-payroll/wallet/fund", requireAuth, requireRole("director", "administrator"), async (req, res) => {
  try {
    const bodyResult = FundSalaryWalletBody.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const { amount, notes } = bodyResult.data;

    const fundAmount = parseFloat(amount);
    if (fundAmount <= 0) {
      res.status(400).json({ error: "Amount must be positive" });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const wallet = await getWallet();
      const newBalance = parseFloat(wallet.balance) + fundAmount;
      const newTotalFunded = parseFloat(wallet.totalFunded) + fundAmount;

      const [updatedWallet] = await tx.update(salaryWalletTable).set({
        balance: newBalance.toString(),
        totalFunded: newTotalFunded.toString(),
        updatedAt: new Date()
      }).where(eq(salaryWalletTable.id, wallet.id)).returning();

      await tx.insert(salaryWalletTransactionsTable).values({
        type: "fund",
        amount: fundAmount.toString(),
        balanceAfter: newBalance.toString(),
        performedBy: (req.user as any).id,
        notes: notes || "Wallet funded by management"
      });

      return updatedWallet;
    });

    res.json({
      id: result.id,
      balance: parseFloat(result.balance).toFixed(2),
      totalFunded: parseFloat(result.totalFunded).toFixed(2),
      totalDisbursed: parseFloat(result.totalDisbursed).toFixed(2),
      updatedAt: result.updatedAt.toISOString()
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /staff-payroll/wallet/transactions
router.get("/staff-payroll/wallet/transactions", requireAuth, requireRole("director", "administrator", "cashier"), async (req, res) => {
  try {
    const txs = await db.select({
      tx: salaryWalletTransactionsTable,
      user: usersTable
    })
    .from(salaryWalletTransactionsTable)
    .leftJoin(usersTable, eq(salaryWalletTransactionsTable.performedBy, usersTable.id))
    .orderBy(desc(salaryWalletTransactionsTable.createdAt));

    const result: WalletTransaction[] = txs.map(({ tx, user }) => ({
      id: tx.id,
      type: tx.type as "fund" | "disburse",
      amount: parseFloat(tx.amount).toFixed(2),
      balanceAfter: parseFloat(tx.balanceAfter).toFixed(2),
      referenceId: tx.referenceId,
      performedBy: tx.performedBy,
      performedByName: user?.fullName || "Unknown",
      notes: tx.notes,
      createdAt: tx.createdAt.toISOString()
    }));

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /staff-payroll/generate-period
router.post("/staff-payroll/generate-period", requireAuth, requireRole("cashier", "administrator", "director"), async (req, res) => {
  try {
    const now = new Date();
    const periodMonth = now.getMonth() + 1;
    const periodYear = now.getFullYear();
    let created = 0;

    // Find company staff
    const companyStaff = await db.select().from(companyStaffTable).where(eq(companyStaffTable.status, "active"));
    for (const staff of companyStaff) {
      const existing = await db.select().from(salaryPaymentsTable).where(and(
        eq(salaryPaymentsTable.staffId, staff.id),
        eq(salaryPaymentsTable.periodMonth, periodMonth),
        eq(salaryPaymentsTable.periodYear, periodYear)
      )).limit(1);

      if (existing.length === 0) {
        const net = parseFloat(staff.salary) + parseFloat(staff.allowances) + parseFloat(staff.bonuses);
        await db.insert(salaryPaymentsTable).values({
          staffType: "company",
          staffId: staff.id,
          periodMonth,
          periodYear,
          baseSalary: staff.salary,
          allowances: staff.allowances,
          bonuses: staff.bonuses,
          netAmount: net.toString(),
          dueDate: addDays(startOfMonth(now), 30) // roughly end of month/30 days
        });
        created++;
      }
    }

    // Find agency staff
    const agencyStaffList = await db.select().from(agencyStaffTable);
    for (const staff of agencyStaffList) {
      const existing = await db.select().from(salaryPaymentsTable).where(and(
        eq(salaryPaymentsTable.staffId, staff.id),
        eq(salaryPaymentsTable.periodMonth, periodMonth),
        eq(salaryPaymentsTable.periodYear, periodYear)
      )).limit(1);

      if (existing.length === 0) {
        const net = parseFloat(staff.salary) + parseFloat(staff.allowances) + parseFloat(staff.bonuses);
        await db.insert(salaryPaymentsTable).values({
          staffType: "agency",
          staffId: staff.id,
          agentId: staff.agentId,
          periodMonth,
          periodYear,
          baseSalary: staff.salary,
          allowances: staff.allowances,
          bonuses: staff.bonuses,
          netAmount: net.toString(),
          dueDate: addDays(startOfMonth(now), 30)
        });
        created++;
      }
    }

    res.json({ created, message: `Successfully generated ${created} salary records for this month.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
