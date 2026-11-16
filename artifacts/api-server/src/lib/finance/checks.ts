import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { moneyAccountBalances, financialPosition } from "./books";
import { reserveLedgerTotals } from "./reserve";
import { livePaystackBalance } from "./paystack-balance";
import { derivedAgencyBalances } from "./agencies";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Exec = { execute: (q: SQL) => Promise<any> };

const n = (v: unknown) => {
  const x = parseFloat(String(v ?? "0"));
  return Number.isFinite(x) ? x : 0;
};
const r2 = (x: number) => Math.round(x * 100) / 100;
const ghs = (v: number) => `GH₵${v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const row = async (exec: Exec, q: SQL) => ((await exec.execute(q)).rows[0] ?? {}) as Record<string, unknown>;

export type Check = {
  id: string;
  area: string;
  title: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  /** What to do about it, when it is not ok. */
  action?: string;
};

/**
 * Every check that proves the books hold together. Each compares two records
 * that must agree, or looks for something that must not exist. Run on demand
 * from the Reconciliation tab; nothing here changes any data.
 */
export async function runChecks(exec: Exec = db): Promise<Check[]> {
  const out: Check[] = [];
  const add = (c: Check) => out.push(c);

  // ── Reserve ──
  const reserve = await reserveLedgerTotals(exec);
  const rs = await row(exec, sql`SELECT coalesce(sum(total_contributed), 0) AS c, coalesce(sum(total_allocated), 0) AS a FROM reserve_fund`);
  const agrees = Math.abs(n(rs.c) - reserve.contributed) < 0.005 && Math.abs(n(rs.a) - reserve.drawn) < 0.005;
  add({ id: "reserve-summary", area: "Reserve", title: "Reserve summary equals its ledger", status: agrees ? "ok" : "fail",
    detail: agrees ? `Set aside ${ghs(reserve.contributed)}, drawn ${ghs(reserve.drawn)} - both to the pesewa.` : `Summary ${ghs(n(rs.c))} / ${ghs(n(rs.a))}; ledger ${ghs(reserve.contributed)} / ${ghs(reserve.drawn)}.`,
    action: agrees ? undefined : "Open Finance › Winnings & Reserve; the summary is rebuilt on every read." });
  add({ id: "reserve-balance", area: "Reserve", title: "Reserve is not overdrawn", status: reserve.balance >= 0 ? "ok" : "warn",
    detail: `Balance ${ghs(reserve.balance)}.${reserve.superseded ? ` ${ghs(reserve.superseded)} of duplicate draws superseded and not counted.` : ""}`,
    action: reserve.balance < 0 ? "More was drawn than the draws set aside. Decide how the overdraft is funded; shortfall contributions can be recorded." : undefined });

  // ── Master Wallet ──
  const mw = await row(exec, sql`
    SELECT (SELECT available FROM master_wallet WHERE id = 1) AS available, (SELECT held FROM master_wallet WHERE id = 1) AS held,
           coalesce(sum(CASE entry_type WHEN 'fund' THEN amount WHEN 'withdraw' THEN -amount WHEN 'hold' THEN -amount WHEN 'release' THEN amount ELSE 0 END), 0) AS avail_replay,
           coalesce(sum(CASE entry_type WHEN 'hold' THEN amount WHEN 'release' THEN -amount WHEN 'disburse' THEN -amount ELSE 0 END), 0) AS held_replay
      FROM master_wallet_ledger`);
  const mwOk = Math.abs(n(mw.available) - n(mw.avail_replay)) < 0.005 && Math.abs(n(mw.held) - n(mw.held_replay)) < 0.005;
  add({ id: "master-wallet-replay", area: "Master Wallet", title: "Wallet balances equal a replay of its ledger", status: mwOk ? "ok" : "fail",
    detail: `Available ${ghs(n(mw.available))} (ledger ${ghs(n(mw.avail_replay))}); held ${ghs(n(mw.held))} (ledger ${ghs(n(mw.held_replay))}).` });
  const live = await livePaystackBalance();
  const accounts = await moneyAccountBalances(exec);
  const paystackBook = accounts.find((a) => a.code === "PAYSTACK")?.balance ?? 0;
  if (live === null) {
    add({ id: "paystack-live", area: "Paystack", title: "Paystack balance agrees with the books", status: "warn", detail: "Paystack could not be asked for its balance.", action: "Try again once Paystack is reachable." });
  } else {
    const diff = r2(live - paystackBook);
    add({ id: "paystack-live", area: "Paystack", title: "Paystack balance agrees with the books", status: Math.abs(diff) < 0.005 ? "ok" : "warn",
      detail: `Paystack ${ghs(live)}, books ${ghs(paystackBook)}${Math.abs(diff) < 0.005 ? "." : `, difference ${ghs(diff)}.`}`,
      action: Math.abs(diff) < 0.005 ? undefined : "Enter any missing fee figures, and record money moved into or out of Paystack outside this system." });
    const claims = n(mw.available) + n(mw.held);
    add({ id: "wallet-covered", area: "Master Wallet", title: "Master Wallet promises no more than Paystack holds", status: claims <= live + 0.005 ? "ok" : "fail",
      detail: `Wallet claims ${ghs(claims)}; Paystack holds ${ghs(live)}.` });
  }
  const fees = await row(exec, sql`SELECT count(*)::int AS n FROM fin_payment_fees WHERE fee IS NULL`);
  add({ id: "fees-known", area: "Paystack", title: "Every Paystack fee has its figure", status: n(fees.n) === 0 ? "ok" : "warn",
    detail: n(fees.n) === 0 ? "All recorded." : `${n(fees.n)} reference(s) waiting for a fee figure.`, action: n(fees.n) ? "Finance › Paystack Fees: sync, or enter the figure from the settlement report." : undefined });

  // ── Money and funds ──
  const negative = accounts.filter((a) => a.balance < -0.005);
  add({ id: "accounts-nonnegative", area: "Money", title: "No money account is below zero", status: negative.length ? "fail" : "ok",
    detail: negative.length ? negative.map((a) => `${a.name} ${ghs(a.balance)}`).join("; ") : "All accounts at or above zero.",
    action: negative.length ? "Money left an account that was never recorded coming in: record the opening balance or the missing receipt." : undefined });
  const pos = await financialPosition(exec);
  add({ id: "funds-covered", area: "Funds", title: "Funds set aside do not exceed the money held", status: pos.overCommitted ? "fail" : "ok",
    detail: `Actual ${ghs(pos.actual)}, set aside ${ghs(pos.earmarked)}, unallocated ${ghs(pos.unallocated)}.` });
  const sal = await row(exec, sql`
    SELECT (SELECT coalesce(sum(balance), 0) FROM salary_wallet) AS wallet, (SELECT coalesce(sum(delta), 0) FROM fin_fund_movements WHERE fund_code = 'SALARY') AS ledger`);
  add({ id: "salary-fund", area: "Funds", title: "Salary Provision equals its movements", status: Math.abs(n(sal.wallet) - n(sal.ledger)) < 0.005 ? "ok" : "fail",
    detail: `Salary wallet ${ghs(n(sal.wallet))}; movements ${ghs(n(sal.ledger))}.` });
  const counts = (await exec.execute(sql`
    SELECT DISTINCT ON (c.account_id) a.name, c.difference, c.as_of FROM fin_balance_checks c JOIN fin_money_accounts a ON a.id = c.account_id
     ORDER BY c.account_id, c.as_of DESC`)).rows as Array<{ name: string; difference: string; as_of: string }>;
  const off = counts.filter((c) => Math.abs(n(c.difference)) >= 0.005);
  add({ id: "counts", area: "Money", title: "Latest cash counts and statements agree with the books", status: !counts.length ? "warn" : off.length ? "warn" : "ok",
    detail: !counts.length ? "No count or statement recorded yet." : off.length ? off.map((c) => `${c.name}: ${ghs(n(c.difference))}`).join("; ") : "Every account's latest check agreed.",
    action: !counts.length ? "Record a cash count and each bank statement balance in Finance › Accounts." : off.length ? "Investigate the difference and record the correcting entry." : undefined });

  // ── Cash book completeness ──
  const units = await row(exec, sql`
    SELECT count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM fin_cash_book b WHERE b.source_type = 'unit_purchase' AND b.source_id = p.id::text))::int AS missing,
           count(*)::int AS total
      FROM writer_token_purchases p
     WHERE (p.payment_method = 'cash' AND p.status = 'credited') OR (p.payment_method = 'momo' AND p.status IN ('paid', 'credited'))`);
  add({ id: "units-booked", area: "Cash book", title: "Every unit purchase paid for has its receipt in the cash book", status: n(units.missing) === 0 ? "ok" : "fail",
    detail: `${n(units.total) - n(units.missing)} of ${n(units.total)} booked.` });
  const credit = await row(exec, sql`
    SELECT count(*)::int AS n, coalesce(sum(amount), 0) AS amt FROM writer_token_purchases WHERE payment_method = 'momo' AND status = 'paid'`);
  add({ id: "units-uncredited", area: "Cash book", title: "MoMo unit purchases paid have been credited", status: n(credit.n) === 0 ? "ok" : "warn",
    detail: n(credit.n) === 0 ? "None waiting." : `${n(credit.n)} paid by MoMo (${ghs(n(credit.amt))}) still waiting for a cashier to credit the units.` });
  const deleted = await row(exec, sql`SELECT count(*)::int AS n, coalesce(sum(amount), 0) AS amt FROM fin_cash_book WHERE leg = 'deleted'`);
  add({ id: "deleted-receipts", area: "Cash book", title: "No booked receipt has been deleted", status: n(deleted.n) === 0 ? "ok" : "warn",
    detail: n(deleted.n) === 0 ? "None." : `${n(deleted.n)} reserve receipt(s) (${ghs(n(deleted.amt))}) deleted after the money was booked; reversed in the cash book.`,
    action: n(deleted.n) ? "Find out why each was deleted; the cash book shows them as reversals." : undefined });

  // ── Units (e-tokens) ──
  const tok = await row(exec, sql`
    SELECT (SELECT coalesce(sum(total_minted), 0) FROM token_pool) AS minted, (SELECT coalesce(sum(balance), 0) FROM token_pool) AS pool,
           (SELECT coalesce(sum(balance), 0) FROM cashier_token_wallets) AS floats,
           (SELECT coalesce(sum(total_disbursed), 0) FROM cashier_token_wallets) AS disbursed`);
  const tokOk = Math.abs(n(tok.minted) - n(tok.pool) - n(tok.floats) - n(tok.disbursed)) < 0.005;
  add({ id: "token-supply", area: "Units", title: "Units minted = pool + cashier floats + issued to writers", status: tokOk ? "ok" : "fail",
    detail: `Minted ${n(tok.minted).toLocaleString("en-GB")}; pool ${n(tok.pool).toLocaleString("en-GB")}, floats ${n(tok.floats).toLocaleString("en-GB")}, issued ${n(tok.disbursed).toLocaleString("en-GB")}.` });

  // ── Winnings ──
  const exp = await row(exec, sql`
    SELECT count(*)::int AS n FROM winnings_expiries x JOIN payout_requests p ON p.id = x.payout_request_id
     WHERE p.status NOT IN ('pending', 'approved')`);
  add({ id: "expired-not-paid", area: "Winnings", title: "No released win was later claimed or paid", status: n(exp.n) === 0 ? "ok" : "fail",
    detail: n(exp.n) === 0 ? "None." : `${n(exp.n)} win(s) counted as expired income have since moved on - they cannot be both.` });
  const due = await row(exec, sql`
    SELECT count(*)::int AS n FROM payout_requests p JOIN game_results gr ON gr.id = p.game_result_id JOIN games g ON g.id = gr.game_id
     WHERE p.status IN ('pending', 'approved') AND now() >= (date_trunc('day', (g.close_at AT TIME ZONE 'UTC') + interval '15 days') + interval '1 day') AT TIME ZONE 'UTC'
       AND NOT EXISTS (SELECT 1 FROM winnings_expiries x WHERE x.payout_request_id = p.id)`);
  add({ id: "expiry-current", area: "Winnings", title: "Every win past its 15 days has been released", status: n(due.n) === 0 ? "ok" : "warn",
    detail: n(due.n) === 0 ? "Up to date." : `${n(due.n)} waiting to be released (happens on the next finance read).` });

  // ── Agencies ──
  const agencies = await row(exec, sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM agency_opening_balances o WHERE o.agent_id = a.id AND o.status = 'approved'))::int AS unconfirmed
      FROM agents a`);
  add({ id: "agency-openings", area: "Agencies", title: "Every agency's opening balance is confirmed", status: n(agencies.unconfirmed) === 0 ? "ok" : "warn",
    detail: `${n(agencies.total) - n(agencies.unconfirmed)} of ${n(agencies.total)} confirmed.`,
    action: n(agencies.unconfirmed) ? "Finance › Agencies: propose each from the manual records; a second person approves." : undefined });
  const derived = await derivedAgencyBalances(exec);
  const stored = (await exec.execute(sql`SELECT id, full_code, outstanding_debt FROM agents`)).rows as Array<{ id: string; full_code: string; outstanding_debt: string }>;
  const drift = derived.filter((d) => {
    const s = stored.find((x) => x.id === d.agentId);
    return s && Math.abs(n(s.outstanding_debt) - d.balance) >= 0.005;
  });
  add({ id: "agency-ledger", area: "Agencies", title: "Confirmed agencies' balances equal their ledger", status: drift.length ? "fail" : "ok",
    detail: drift.length ? `${drift.length} differ; they are corrected on the next finance read.` : `${derived.length} checked.` });
  const commission = await row(exec, sql`SELECT count(*)::int AS n FROM agent_commission_payouts WHERE status = 'approved' AND reviewed_at < now() - interval '3 days'`);
  add({ id: "commission-waiting", area: "Agencies", title: "Approved commission is paid promptly", status: n(commission.n) === 0 ? "ok" : "warn",
    detail: n(commission.n) === 0 ? "Nothing approved more than 3 days ago is unpaid." : `${n(commission.n)} approved more than 3 days ago and still unpaid.` });

  // ── Inventory ──
  const inv = await row(exec, sql`SELECT count(*)::int AS n FROM booklet_batches WHERE NOT cost_confirmed`);
  add({ id: "booklet-cost", area: "Inventory", title: "Every booklet batch's cost is confirmed against its invoice", status: n(inv.n) === 0 ? "ok" : "warn",
    detail: n(inv.n) === 0 ? "All confirmed." : `${n(inv.n)} batch(es) unconfirmed.`, action: n(inv.n) ? "Finance › Inventory: the director confirms each from the supplier's invoice." : undefined });

  // ── Payroll ──
  const unapprovedPaid = await row(exec, sql`
    SELECT count(*)::int AS n FROM salary_payments sp
     WHERE sp.status = 'paid' AND sp.paid_at > (SELECT coalesce(min(submitted_at), now()) FROM salary_schedules)
       AND NOT EXISTS (SELECT 1 FROM salary_schedules s WHERE s.period_month = sp.period_month AND s.period_year = sp.period_year AND s.status = 'approved')`);
  add({ id: "salary-approved", area: "Payroll", title: "Salaries paid since schedules began were all approved", status: n(unapprovedPaid.n) === 0 ? "ok" : "fail",
    detail: n(unapprovedPaid.n) === 0 ? "None paid without an approved schedule." : `${n(unapprovedPaid.n)} paid without an approved schedule.` });

  return out;
}
