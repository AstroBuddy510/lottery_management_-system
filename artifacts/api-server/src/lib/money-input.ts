import { z } from "zod/v4";

/**
 * Money arriving from a client, as text.
 *
 * The generated request schemas type these fields as plain strings, because
 * that is what the OpenAPI document says, so "abc", "-5000", "1e9" and
 * "999999999999999" all passed validation and went to the database as a
 * declared figure. The lucky outcome was a 500 when Postgres refused the
 * cast; the unlucky one was a negative or absurd amount landing in a
 * settlement that someone is paid against.
 *
 * Validating here rather than in the generated file is deliberate: that file
 * is rebuilt from the OpenAPI document by orval, and an edit to it would be
 * erased the next time anyone regenerated it.
 *
 * The shape is strict on purpose - digits, optionally two decimal places.
 * No sign, so negatives cannot be expressed at all rather than being caught
 * by a bound. No exponent. No spaces inside.
 */

/**
 * Ceiling for a single declared figure.
 *
 * Production's largest gross entry is GHS 38,500 and its largest wins entry
 * GHS 12,000, so a million leaves two orders of magnitude of room for real
 * growth while still refusing the kind of number that only arrives by
 * accident or by malice. It is also well inside numeric(12,2).
 */
export const MAX_ENTRY_AMOUNT = 1_000_000;

const MONEY_SHAPE = /^\d{1,10}(\.\d{1,2})?$/;

export function moneyString(max: number = MAX_ENTRY_AMOUNT) {
  return z
    .string()
    .trim()
    .regex(MONEY_SHAPE, "Amount must be a number, with at most two decimal places")
    .refine((v) => Number(v) <= max, `Amount may not exceed ${max.toLocaleString("en-GB")}`)
    .refine((v) => Number.isFinite(Number(v)), "Amount is not a number");
}

/** The money fields on a gross entry. */
export const grossEntryMoney = z.object({
  grossAmount: moneyString(),
  bookletsCount: z.number().int().min(0).max(10_000).nullish(),
});

/** The money fields on a wins entry. */
export const winsEntryMoney = z.object({
  winsAmount: moneyString(),
});

/**
 * A decimal money string as whole minor units (pesewas), without floating
 * point.
 *
 * Math.round(Number("1.005") * 100) is 100, not 101, because the
 * multiplication lands on 100.49999999999999. The stored columns are
 * numeric(12,2) so a third decimal should never reach here - but this value
 * decides whether a payment is credited, and "should never" is a poor thing
 * to rest money on when the exact version is four lines.
 */
export function toMinorUnits(amount: string | number): number {
  const [whole, frac = ""] = String(amount).trim().split(".");
  const sign = whole!.startsWith("-") ? -1 : 1;
  const w = Math.abs(Number(whole));
  const f = Number((frac + "00").slice(0, 2));
  return sign * (w * 100 + f);
}
