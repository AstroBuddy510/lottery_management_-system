import { customFetch } from "@workspace/api-client-react";

/** Shared plumbing for the Finance & Statements screens. */

export const FIN_KEY = ["finance"] as const;
export const FIN_REFRESH_MS = 30_000;

export const finGet = <T,>(path: string) => () => customFetch<T>(`/api/finance${path}`, { method: "GET" });
export const finSend = <T,>(path: string, body: unknown, method = "POST") =>
  customFetch<T>(`/api/finance${path}`, { method, body: JSON.stringify(body ?? {}), headers: { "content-type": "application/json" } });
export const apiGet = <T,>(path: string) => () => customFetch<T>(`/api${path}`, { method: "GET" });
export const apiSend = <T,>(path: string, body: unknown, method = "POST") =>
  customFetch<T>(`/api${path}`, { method, body: JSON.stringify(body ?? {}), headers: { "content-type": "application/json" } });

export function errorText(err: unknown, fallback: string): string {
  const data = (err as { data?: { error?: string } })?.data;
  return data?.error ?? fallback;
}

export const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
};

export const ghs = (v: unknown) =>
  `GH₵ ${num(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Signed, with the minus in front of the currency: −GH₵ 12.00. */
export const ghsSigned = (v: unknown) => (num(v) < 0 ? `−${ghs(-num(v))}` : ghs(v));

export const fmtDate = (v?: string | null) =>
  v ? new Date(v.length === 10 ? `${v}T12:00:00Z` : v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Accra" }) : "—";
export const fmtDateTime = (v?: string | null) =>
  v ? new Date(v).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Accra" }) : "—";

export const todayAccra = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Accra" }).format(new Date());
export const monthStartAccra = () => `${todayAccra().slice(0, 8)}01`;

export type MoneyAccount = {
  id: string; code: string; name: string; kind: string; institution: string | null; accountRef: string | null;
  isActive: boolean; isSystem: boolean; notes: string | null; openingBalance: number; openingDate: string | null;
  totalIn: number; totalOut: number; entries: number; balance: number;
};
export type Fund = { code: string; name: string; description: string | null; isSystem: boolean; isActive: boolean; allocated: number; used: number; balance: number; derived: boolean };
export type Position = { accounts: MoneyAccount[]; funds: Fund[]; actual: number; earmarked: number; unallocated: number; overCommitted: boolean };

export type CashBookRow = {
  id: string; occurred_at: string; direction: "in" | "out"; amount: string; method: string; category: string;
  source_type: string; source_id: string; leg: string; party_type: string | null; party_label: string | null;
  reference: string | null; memo: string | null; reverses_id: string | null;
  account_code: string; account_name: string; handled_by_name: string | null;
};

export const CATEGORY_LABEL: Record<string, string> = {
  unit_sale: "Prepaid unit sale",
  postpaid_settlement: "Postpaid takings",
  agency_receipt: "Agency pay-in",
  agency_payout: "Agency pay-out",
  reserve_collection: "Reserve collected",
  expense: "Company expense",
  salary: "Salary",
  win_payout: "POS win paid",
  director_funding: "Director funding",
  director_withdrawal: "Director withdrawal",
  processing_fee: "Paystack fee",
  internal_transfer: "Transfer between accounts",
  owner_capital: "Capital introduced",
  loan_received: "Loan received",
  loan_repayment: "Loan repayment",
  other_income: "Other income",
  other_expense: "Other expense",
  bank_charge: "Bank charge",
  commission_payout: "Agent commission paid",
  shortfall_contribution: "Winnings shortfall contribution",
  inventory_purchase: "Inventory purchase",
  supplier_payment: "Supplier payment",
};
export const categoryLabel = (c: string) => CATEGORY_LABEL[c] ?? c.replace(/_/g, " ");
