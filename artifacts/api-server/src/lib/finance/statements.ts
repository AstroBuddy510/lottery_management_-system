import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { moneyAccountBalances, fundBalances } from "./books";
import { winningsSummary } from "./winnings";
import { bookletStock, thermalStock } from "./inventory";
import { commissionWeeks } from "./agencies";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Exec = { execute: (q: SQL) => Promise<any> };

const n = (v: unknown) => {
  const x = parseFloat(String(v ?? "0"));
  return Number.isFinite(x) ? x : 0;
};
const r2 = (x: number) => Math.round(x * 100) / 100;
const one = async (exec: Exec, q: SQL) => n(((await exec.execute(q)).rows[0] as { v: unknown } | undefined)?.v);

export type Line = { label: string; amount: number; note?: string; strong?: boolean; indent?: boolean };

/** Accra midnight at the start of `from` to the end of `to`, inclusive. */
const range = (col: SQL, from: string, to: string) => sql`${col} >= ${from}::date AND ${col} < (${to}::date + 1)`;

/**
 * Income statement for a period, on the accruals basis: sales and winnings
 * when the draw is calculated, commission on the sales it was earned on,
 * stock when it is used, expired wins when they are released.
 */
export async function incomeStatement(from: string, to: string, exec: Exec = db) {
  const calc = (await exec.execute(sql`
    SELECT coalesce(sum(gross_sales), 0) AS gross, coalesce(sum(commission_amount), 0) AS writer_commission,
           coalesce(sum(wins_amount), 0) AS wins, coalesce(sum(reserve_amount), 0) AS reserve
      FROM daily_calculations WHERE calc_date BETWEEN ${from} AND ${to}`)).rows[0] as Record<string, unknown>;
  const gross = n(calc.gross);
  const writerCommission = n(calc.writer_commission);
  const wins = n(calc.wins);
  const reserveSetAside = n(calc.reserve);

  const agentCommission = r2((await commissionWeeksBetween(from, to, exec)));
  const expired = await one(exec, sql`SELECT coalesce(sum(amount), 0) AS v FROM winnings_expiries WHERE ${range(sql`released_at`, from, to)}`);
  const salaries = await one(exec, sql`SELECT coalesce(sum(net_amount), 0) AS v FROM salary_payments WHERE status = 'paid' AND ${range(sql`coalesce(paid_at, created_at)`, from, to)}`);
  const expenses = await one(exec, sql`
    SELECT coalesce(sum(amount), 0) AS v FROM company_expenses e
     WHERE ${range(sql`e.created_at`, from, to)}
       AND NOT (e.authorizing_officer = 'System (Auto-authorized)' AND e.description LIKE 'Salary payment for %')`);
  const fees = await one(exec, sql`SELECT coalesce(sum(fee), 0) AS v FROM fin_payment_fees WHERE fee IS NOT NULL AND ${range(sql`occurred_at`, from, to)}`);
  const manual = (await exec.execute(sql`
    SELECT category, coalesce(sum(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0) AS v
      FROM fin_cash_book WHERE source_type = 'manual' AND category IN ('other_income', 'other_expense', 'bank_charge')
       AND ${range(sql`occurred_at`, from, to)} GROUP BY 1`)).rows as Array<{ category: string; v: string }>;
  const manualOf = (c: string) => n(manual.find((m) => m.category === c)?.v);

  const booklets = await bookletStock(exec);
  const thermal = await thermalStock(exec);
  const bookletsUsed = await one(exec, sql`SELECT coalesce(sum(booklets_count), 0) AS v FROM gross_entries WHERE entry_date BETWEEN ${from} AND ${to}`);
  const rollsUsed = await one(exec, sql`SELECT coalesce(sum(quantity), 0) AS v FROM thermal_roll_distributions WHERE distributed_date BETWEEN ${from} AND ${to}`);
  const writtenOff = await one(exec, sql`SELECT coalesce(sum(quantity), 0) AS v FROM booklet_adjustments WHERE adjustment_type IN ('damaged', 'lost') AND occurred_on BETWEEN ${from} AND ${to}`);
  const bookletCost = r2(bookletsUsed * booklets.avgCost);
  const rollCost = r2(rollsUsed * thermal.avgCost);
  const writeOffCost = r2(writtenOff * booklets.avgCost);

  const netSales = r2(gross - writerCommission);
  const grossMargin = r2(netSales - wins);
  const otherIncome = r2(expired + manualOf("other_income"));
  const opex = r2(agentCommission + salaries + expenses + fees + bookletCost + rollCost + writeOffCost - manualOf("bank_charge") - manualOf("other_expense"));
  const net = r2(grossMargin + otherIncome - opex);

  const lines: Line[] = [
    { label: "Ticket sales (gross stakes)", amount: r2(gross) },
    { label: "Less: writer commission", amount: -r2(writerCommission), indent: true },
    { label: "Net sales", amount: netSales, strong: true },
    { label: "Less: winnings declared", amount: -r2(wins), indent: true },
    { label: "Gross gaming margin", amount: grossMargin, strong: true },
    { label: "Expired / unclaimed winnings income", amount: r2(expired), note: "Wins not claimed within 15 days, released this period" },
    { label: "Other income", amount: r2(manualOf("other_income")) },
    { label: "Agent commission", amount: -agentCommission, indent: true, note: "Gross sales of each agent's writers × the rate in force" },
    { label: "Salaries", amount: -r2(salaries), indent: true },
    { label: "Operating expenses", amount: -r2(expenses), indent: true },
    { label: "Payment processing fees (Paystack)", amount: -r2(fees), indent: true },
    { label: "Booklets used", amount: -bookletCost, indent: true, note: `${bookletsUsed.toLocaleString("en-GB")} booklets at average cost${booklets.unconfirmedBatches ? " - cost UNCONFIRMED" : ""}` },
    { label: "Thermal rolls used", amount: -rollCost, indent: true, note: `${rollsUsed.toLocaleString("en-GB")} rolls at average cost` },
    { label: "Stock written off (damaged / lost)", amount: -writeOffCost, indent: true },
    { label: "Bank charges", amount: r2(manualOf("bank_charge")), indent: true },
    { label: "Other expenses", amount: r2(manualOf("other_expense")), indent: true },
    { label: "Net profit / (loss) for the period", amount: net, strong: true },
  ];
  return {
    from, to, lines, net,
    memo: [
      { label: "Reserve set aside from net sales (an allocation of profit, not an expense)", amount: r2(reserveSetAside) },
    ],
    caveats: booklets.unconfirmedBatches ? ["Booklet cost is not yet confirmed against the supplier's invoice; the booklet figures will change when it is."] : [],
  };
}

/** Agent commission earned on sales calculated within the period. */
async function commissionWeeksBetween(from: string, to: string, exec: Exec) {
  const r = await exec.execute(sql`
    WITH daily AS (
      SELECT c.calc_date, sum(c.gross_sales) AS gross
        FROM daily_calculations c WHERE c.calc_date BETWEEN ${from} AND ${to} GROUP BY 1
    )
    SELECT coalesce(sum(d.gross * coalesce(
      (SELECT s.agent_commission_pct FROM system_settings s WHERE s.effective_date <= d.calc_date AND s.updated_at < (d.calc_date + 1)::timestamptz ORDER BY s.updated_at DESC LIMIT 1),
      (SELECT s.agent_commission_pct FROM system_settings s ORDER BY s.updated_at ASC LIMIT 1), 0)), 0) AS v
      FROM daily d`);
  return n((r.rows[0] as { v: unknown }).v);
}

const OPERATING = ["unit_sale", "postpaid_settlement", "agency_receipt", "agency_payout", "reserve_collection", "win_payout", "expense", "salary",
  "processing_fee", "commission_payout", "supplier_payment", "other_income", "other_expense", "bank_charge"];
const FINANCING = ["owner_capital", "director_funding", "director_withdrawal", "loan_received", "loan_repayment", "shortfall_contribution"];

/** Cash flow for a period, straight from the cash book (direct method). Transfers between the company's own accounts net to nil and are left out. */
export async function cashFlow(from: string, to: string, exec: Exec = db) {
  const rows = (await exec.execute(sql`
    SELECT category, coalesce(sum(amount) FILTER (WHERE direction = 'in'), 0) AS cin, coalesce(sum(amount) FILTER (WHERE direction = 'out'), 0) AS cout
      FROM fin_cash_book WHERE ${range(sql`occurred_at`, from, to)} GROUP BY 1`)).rows as Array<{ category: string; cin: string; cout: string }>;
  const opening = await one(exec, sql`
    SELECT (SELECT coalesce(sum(opening_balance), 0) FROM fin_money_accounts)
         + coalesce((SELECT sum(CASE WHEN direction = 'in' THEN amount ELSE -amount END) FROM fin_cash_book WHERE occurred_at < ${from}::date), 0) AS v`);
  const group = (cats: string[]) => rows.filter((r) => cats.includes(r.category)).map((r) => ({ category: r.category, in: n(r.cin), out: n(r.cout), net: r2(n(r.cin) - n(r.cout)) }));
  const operating = group(OPERATING);
  const financing = group(FINANCING);
  const other = rows.filter((r) => !OPERATING.includes(r.category) && !FINANCING.includes(r.category) && r.category !== "internal_transfer")
    .map((r) => ({ category: r.category, in: n(r.cin), out: n(r.cout), net: r2(n(r.cin) - n(r.cout)) }));
  const transfers = rows.find((r) => r.category === "internal_transfer");
  const sum = (g: Array<{ net: number }>) => r2(g.reduce((s, x) => s + x.net, 0));
  const netChange = r2(sum(operating) + sum(financing) + sum(other) + (transfers ? n(transfers.cin) - n(transfers.cout) : 0));
  return {
    from, to, opening: r2(opening),
    operating, operatingNet: sum(operating),
    financing, financingNet: sum(financing),
    other, otherNet: sum(other),
    transfersNet: transfers ? r2(n(transfers.cin) - n(transfers.cout)) : 0,
    netChange, closing: r2(opening + netChange),
  };
}

/**
 * Statement of financial position, as it stands now. Money is the books'
 * balances; the rest are the open balances each module holds. Equity is
 * what is left when liabilities are taken from assets.
 */
export async function financialPositionStatement(exec: Exec = db) {
  const accounts = await moneyAccountBalances(exec);
  const funds = await fundBalances(exec);
  const wins = await winningsSummary(exec);
  const booklets = await bookletStock(exec);
  const thermal = await thermalStock(exec);
  const agencies = (await exec.execute(sql`
    SELECT a.full_code, a.outstanding_debt,
           EXISTS (SELECT 1 FROM agency_opening_balances o WHERE o.agent_id = a.id AND o.status = 'approved') AS confirmed
      FROM agents a`)).rows as Array<{ full_code: string; outstanding_debt: string; confirmed: boolean }>;
  const agencyReceivable = r2(agencies.filter((a) => n(a.outstanding_debt) < 0).reduce((s, a) => s - n(a.outstanding_debt), 0));
  const agencyPayable = r2(agencies.filter((a) => n(a.outstanding_debt) > 0).reduce((s, a) => s + n(a.outstanding_debt), 0));
  const unconfirmedAgencies = agencies.filter((a) => !a.confirmed && Math.abs(n(a.outstanding_debt)) > 0.005).length;
  const postpaidReceivable = await one(exec, sql`
    SELECT coalesce(sum(greatest(amount_payable - amount_paid, 0)), 0) AS v FROM postpaid_daily_ledger WHERE settlement_status <> 'settled'`);
  const unitsOutstanding = await one(exec, sql`SELECT coalesce(sum(balance), 0) AS v FROM writer_token_wallets`);
  const weeks = await commissionWeeks(exec);
  const commissionPaid = await one(exec, sql`SELECT coalesce(sum(amount), 0) AS v FROM agent_commission_payouts WHERE status = 'paid'`);
  const commissionPayable = r2(weeks.reduce((s, w) => s + w.commission, 0) - commissionPaid);
  const contributionsHeld = Math.max(0, wins.contributions.held);

  const cash = r2(accounts.reduce((s, a) => s + a.balance, 0));
  const inventory = r2(booklets.stockValue + thermal.stockValue);
  const assets: Line[] = [
    ...accounts.map((a) => ({ label: a.name, amount: a.balance, indent: true })),
    { label: "Cash, bank and Paystack", amount: cash, strong: true },
    { label: "Owed by agencies", amount: agencyReceivable, note: unconfirmedAgencies ? `${unconfirmedAgencies} agencies on unconfirmed opening balances` : undefined },
    { label: "Postpaid takings not yet collected", amount: r2(postpaidReceivable) },
    { label: "Stock: booklets and thermal rolls", amount: inventory, note: booklets.unconfirmedBatches ? "Booklet cost unconfirmed" : undefined },
  ];
  const totalAssets = r2(cash + agencyReceivable + postpaidReceivable + inventory);
  const liabilities: Line[] = [
    { label: "Winnings owed to winners", amount: wins.outstandingLiability },
    { label: "Owed to agencies", amount: agencyPayable },
    { label: "Agent commission payable", amount: commissionPayable },
    { label: "Owed to suppliers", amount: r2(booklets.payable + thermal.payable) },
    { label: "Prepaid units not yet staked", amount: r2(unitsOutstanding), note: "Units writers have bought and not yet used" },
    { label: "Shortfall contributions held", amount: r2(contributionsHeld) },
  ];
  const totalLiabilities = r2(liabilities.reduce((s, l) => s + l.amount, 0));
  const equity = r2(totalAssets - totalLiabilities);
  return {
    asAt: new Date().toISOString(),
    assets, totalAssets, liabilities, totalLiabilities, equity,
    funds: funds.map((f) => ({ label: f.name, amount: f.balance })),
    caveats: [
      ...(unconfirmedAgencies ? [`${unconfirmedAgencies} agency balance${unconfirmedAgencies === 1 ? " rests" : "s rest"} on a figure whose opening balance management has not yet confirmed.`] : []),
      ...(booklets.unconfirmedBatches ? ["Booklet stock and the supplier payable use a cost not yet confirmed against the invoice."] : []),
    ],
  };
}
