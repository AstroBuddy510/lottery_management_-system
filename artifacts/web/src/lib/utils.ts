import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Thousands separators, always two decimals. Display only - never for an
 *  input value or an API payload, where a comma would break the number. */
export const MONEY_FORMAT = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
} as const

export function fmtMoney(value: number | string): string {
  const n = Number(value)
  return Number.isFinite(n) ? n.toLocaleString("en-GB", MONEY_FORMAT) : "0.00"
}

export function fmtGHS(value: number | string): string {
  return `GH₵ ${fmtMoney(value)}`
}
