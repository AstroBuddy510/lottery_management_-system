import crypto from "crypto";
import type { Request } from "express";

/**
 * Paystack configuration and webhook authentication, in one place.
 *
 * Three routes take Paystack webhooks - agent payments, writer e-token
 * purchases and postpaid settlements - and each one is a door into moving
 * money. They verify identically because they share this file; when they each
 * had their own copy, they had already begun to differ.
 */

/** The live secret, or empty when the deployment has not been given one. */
export function paystackSecret(): string {
  return process.env["PAYSTACK_SECRET_KEY"] ?? "";
}

/** Whether this deployment can talk to Paystack at all. */
export function paystackConfigured(): boolean {
  const key = paystackSecret();
  // A placeholder is not a key. Treating one as configured is how a webhook
  // ends up verifying signatures against a string that is public knowledge.
  return key.length > 0 && !key.includes("placeholder");
}

export type WebhookCheck =
  | { ok: true; event: Record<string, unknown> }
  | { ok: false; status: number; reason: string };

/**
 * Is this really Paystack, and is the body untouched?
 *
 * The signature is an HMAC of the EXACT bytes Paystack sent, so it is checked
 * against the raw body captured by the JSON parser rather than a
 * re-serialisation of the parsed object - those two are usually identical and
 * occasionally not, which fails a genuine payment for no visible reason.
 *
 * The comparison is constant-time: a signature check that returns early on
 * the first wrong byte leaks how much of a guess was right.
 */
export function verifyWebhook(req: Request): WebhookCheck {
  if (!paystackConfigured()) {
    return { ok: false, status: 503, reason: "Paystack is not configured" };
  }

  const signature = req.headers["x-paystack-signature"];
  if (typeof signature !== "string" || signature.length === 0) {
    return { ok: false, status: 401, reason: "Missing signature" };
  }

  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  const body = raw ?? Buffer.from(JSON.stringify(req.body ?? {}), "utf8");

  const expected = crypto.createHmac("sha512", paystackSecret()).update(body).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, status: 401, reason: "Invalid signature" };
  }

  return { ok: true, event: (req.body ?? {}) as Record<string, unknown> };
}

/**
 * Ask Paystack directly whether a reference was really paid.
 *
 * A signed body proves the message came from Paystack; it does not prove the
 * charge stands - a replayed or reversed one looks the same. The money is
 * only real if Paystack says so when asked.
 */
export async function verifyCharge(
  reference: string,
): Promise<{ ok: boolean; amountMinor?: number; reason?: string }> {
  if (!paystackConfigured()) return { ok: false, reason: "Paystack is not configured" };

  const res = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${paystackSecret()}` } },
  );
  const data = (await res.json().catch(() => ({}))) as {
    status?: boolean;
    data?: { status?: string; amount?: number };
  };

  if (!res.ok || !data.status || data.data?.status !== "success") {
    return { ok: false, reason: data.data?.status ?? "verification failed" };
  }
  return { ok: true, amountMinor: data.data?.amount ?? 0 };
}
