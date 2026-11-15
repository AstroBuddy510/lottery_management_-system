import { paystackConfigured, paystackSecret } from "./paystack";

/**
 * Paying money OUT through Paystack: recipients, transfers, and asking
 * Paystack what actually happened.
 *
 * The rule this file is built around: a transfer has three possible answers,
 * not two. It worked, it did not, or WE DO NOT KNOW - the request timed out,
 * the connection dropped, Paystack returned a 5xx. Treating "do not know" as
 * "failed" and trying again is how a winner gets paid twice, so every call
 * here reports uncertainty as its own outcome and the caller is expected to
 * ask again by reference rather than send again.
 */

/**
 * Paystack's API. Overridable outside production only, so tests can stand a
 * local double in for it. In production the address is fixed: an environment
 * variable that could redirect the secret key somewhere else is a liability.
 */
function baseUrl(): string {
  const override = process.env["PAYSTACK_BASE_URL"];
  if (override && process.env["NODE_ENV"] !== "production") return override.replace(/\/+$/, "");
  return "https://api.paystack.co";
}

/** Ghana mobile-money networks, by the codes Paystack uses for them. */
export const MOMO_PROVIDERS = {
  mtn: { code: "MTN", label: "MTN MoMo" },
  vod: { code: "VOD", label: "Telecel Cash" },
  atl: { code: "ATL", label: "AirtelTigo Money" },
} as const;
export type MomoProvider = keyof typeof MOMO_PROVIDERS;

export function isMomoProvider(value: unknown): value is MomoProvider {
  return typeof value === "string" && value in MOMO_PROVIDERS;
}

/** A Ghana mobile number in local form, 0XXXXXXXXX - or null. */
export function normaliseMomoNumber(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let digits = input.replace(/[\s\-()+]/g, "");
  if (/^233\d{9}$/.test(digits)) digits = `0${digits.slice(3)}`;
  return /^0\d{9}$/.test(digits) ? digits : null;
}

/** Cedis as a string to pesewas as an integer, without going through a float. */
export function toMinorUnits(amount: string): number {
  const [whole, frac = ""] = amount.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

interface PaystackEnvelope<T> {
  status?: boolean;
  message?: string;
  data?: T;
}

type CallResult<T> =
  | { kind: "ok"; data: T; message: string }
  /** Paystack answered, and the answer was no. Nothing was created. */
  | { kind: "refused"; message: string; httpStatus: number }
  /** No usable answer. The request may or may not have taken effect. */
  | { kind: "unknown"; message: string };

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<CallResult<T>> {
  if (!paystackConfigured()) {
    return { kind: "refused", message: "Paystack is not configured", httpStatus: 503 };
  }
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${paystackSecret()}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    return { kind: "unknown", message: err instanceof Error ? err.message : "network error" };
  }

  const json = (await res.json().catch(() => null)) as PaystackEnvelope<T> | null;

  // A 5xx is Paystack failing, not Paystack refusing: the transfer may exist.
  if (res.status >= 500 || json === null) {
    return { kind: "unknown", message: json?.message ?? `Paystack returned HTTP ${res.status}` };
  }
  if (!res.ok || json.status !== true) {
    return { kind: "refused", message: json.message ?? `HTTP ${res.status}`, httpStatus: res.status };
  }
  return { kind: "ok", data: json.data as T, message: json.message ?? "" };
}

/** Who the network says this wallet belongs to. Best-effort: null when it cannot say. */
export async function resolveMomoName(number: string, provider: MomoProvider): Promise<string | null> {
  const result = await call<{ account_name?: string }>(
    "GET",
    `/bank/resolve?account_number=${encodeURIComponent(number)}&bank_code=${MOMO_PROVIDERS[provider].code}`,
  );
  return result.kind === "ok" ? (result.data.account_name ?? null) : null;
}

export async function createMomoRecipient(opts: {
  name: string;
  number: string;
  provider: MomoProvider;
}): Promise<{ ok: true; recipientCode: string } | { ok: false; message: string }> {
  const result = await call<{ recipient_code?: string }>("POST", "/transferrecipient", {
    type: "mobile_money",
    name: opts.name,
    account_number: opts.number,
    bank_code: MOMO_PROVIDERS[opts.provider].code,
    currency: "GHS",
  });
  if (result.kind === "ok" && result.data.recipient_code) {
    return { ok: true, recipientCode: result.data.recipient_code };
  }
  // Creating a recipient moves no money, so "unknown" is safe to report as a
  // plain failure here: trying again just makes another recipient.
  return { ok: false, message: result.kind === "ok" ? "Paystack returned no recipient code" : result.message };
}

export type TransferOutcome =
  /** Paystack says the money has been sent. */
  | { state: "success"; transferCode: string | null }
  /** Accepted and in progress; the webhook or a status check will settle it. */
  | { state: "pending"; transferCode: string | null; paystackStatus: string }
  /** Paystack is waiting for a one-time code nobody here can supply. */
  | { state: "otp"; transferCode: string | null }
  /** Definitely not sent. */
  | { state: "failed"; message: string }
  /** Not known. Do not send again; ask by reference. */
  | { state: "unknown"; message: string };

function outcomeFor(status: string | undefined, transferCode: string | null, message: string): TransferOutcome {
  switch (status) {
    case "success":
      return { state: "success", transferCode };
    case "otp":
      return { state: "otp", transferCode };
    case "failed":
    case "reversed":
    case "abandoned":
    case "blocked":
    case "rejected":
      return { state: "failed", message: message || `Transfer ${status}` };
    case "pending":
    case "processing":
    case "received":
    case "queued":
      return { state: "pending", transferCode, paystackStatus: status };
    default:
      // A status this code has never seen is not evidence of anything.
      return { state: "unknown", message: `Unrecognised transfer status "${status ?? ""}"` };
  }
}

/**
 * Send a transfer from the Paystack balance.
 *
 * `reference` is ours and is what makes this safe to have attempted: Paystack
 * refuses a second transfer carrying a reference it has already seen, so
 * whatever happened to the response, the same reference cannot pay twice.
 */
export async function initiateTransfer(opts: {
  amount: string;
  recipientCode: string;
  reference: string;
  reason: string;
}): Promise<TransferOutcome> {
  const result = await call<{ status?: string; transfer_code?: string }>("POST", "/transfer", {
    source: "balance",
    amount: toMinorUnits(opts.amount),
    recipient: opts.recipientCode,
    reference: opts.reference,
    reason: opts.reason,
    currency: "GHS",
  });
  if (result.kind === "unknown") return { state: "unknown", message: result.message };
  if (result.kind === "refused") return { state: "failed", message: result.message };
  return outcomeFor(result.data.status, result.data.transfer_code ?? null, result.message);
}

/**
 * What Paystack says became of a reference.
 *
 * `not_found` is a real and useful answer: it means the transfer never
 * reached Paystack at all, so the request can safely go back to the queue.
 */
export async function verifyTransfer(
  reference: string,
): Promise<TransferOutcome | { state: "not_found" } | { state: "success"; transferCode: string | null; amountMinor: number }> {
  const result = await call<{ status?: string; transfer_code?: string; amount?: number }>(
    "GET",
    `/transfer/verify/${encodeURIComponent(reference)}`,
  );
  if (result.kind === "unknown") return { state: "unknown", message: result.message };
  if (result.kind === "refused") {
    return result.httpStatus === 404 || /not found/i.test(result.message)
      ? { state: "not_found" }
      : { state: "unknown", message: result.message };
  }
  const outcome = outcomeFor(result.data.status, result.data.transfer_code ?? null, result.message);
  if (outcome.state === "success") {
    return { ...outcome, amountMinor: result.data.amount ?? 0 };
  }
  return outcome;
}

/** The GHS balance Paystack is actually holding, for reconciling against the wallet. */
export async function paystackGhsBalance(): Promise<string | null> {
  const result = await call<Array<{ currency?: string; balance?: number }>>("GET", "/balance");
  if (result.kind !== "ok" || !Array.isArray(result.data)) return null;
  const ghs = result.data.find((b) => b.currency === "GHS");
  return ghs && typeof ghs.balance === "number" ? (ghs.balance / 100).toFixed(2) : null;
}
