import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { syncBooks } from "../lib/finance/books";
import { incomeStatement, cashFlow, financialPositionStatement } from "../lib/finance/statements";
import { runChecks } from "../lib/finance/checks";

/** The statements, and the checks that prove the books agree. */

const router = Router();
const MGMT = ["director", "administrator"] as const;
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const todayAccra = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Accra" }).format(new Date());

router.get("/finance/statements", requireAuth, requireRole(...MGMT), async (req, res) => {
  const q = req.query as Record<string, string>;
  const to = isDate(q["to"]) ? q["to"] : todayAccra();
  const from = isDate(q["from"]) ? q["from"] : `${to.slice(0, 8)}01`;
  if (from > to) {
    res.status(400).json({ error: "The From date is after the To date" });
    return;
  }
  await syncBooks();
  const [income, cash, position] = await Promise.all([incomeStatement(from, to), cashFlow(from, to), financialPositionStatement()]);
  res.json({ income, cash, position });
});

router.get("/finance/checks", requireAuth, requireRole(...MGMT), async (_req, res) => {
  await syncBooks();
  res.json({ ranAt: new Date().toISOString(), checks: await runChecks() });
});

export default router;
