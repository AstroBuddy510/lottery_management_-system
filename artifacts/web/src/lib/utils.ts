import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function fmtGHS(value: number | string): string {
  return `GH₵ ${Number(value).toFixed(2)}`
}
