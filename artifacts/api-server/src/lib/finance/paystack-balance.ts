import { paystackGhsBalance } from "../paystack-transfers";
import { paystackConfigured } from "../paystack";

/**
 * The GHS balance Paystack is holding right now, or null when it cannot be
 * asked. Outside production a fixed figure can stand in for it (so the guard
 * below can be exercised without a live key); production always asks Paystack.
 */
export async function livePaystackBalance(): Promise<number | null> {
  const override = process.env["PAYSTACK_BALANCE_OVERRIDE"];
  if (process.env["NODE_ENV"] !== "production" && override !== undefined && override !== "") {
    const n = Number(override);
    return Number.isFinite(n) ? n : null;
  }
  if (!paystackConfigured()) return null;
  try {
    const b = await paystackGhsBalance();
    return b === null ? null : Number(b);
  } catch {
    return null;
  }
}
