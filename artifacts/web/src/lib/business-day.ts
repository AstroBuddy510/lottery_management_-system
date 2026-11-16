import { useEffect, useState } from "react";
import { getServerNow } from "@/lib/time-sync";

/**
 * The company's business day, and where each draw stands within it.
 *
 * Everything here works in the company's own timezone rather than the
 * browser's. A director opening the dashboard on a laptop still set to London
 * time must see Accra's Monday, not the laptop's.
 */
export const BUSINESS_TZ = "Africa/Accra";

const DATE_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const DOW_FMT = new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TZ, weekday: "long" });

/** yyyy-mm-dd of the business day an instant falls on. */
export function businessDate(at: Date | string | number): string {
  return DATE_FMT.format(new Date(at));
}

export function businessWeekday(at: Date | string | number): string {
  return DOW_FMT.format(new Date(at));
}

/** Server-corrected "now", ticking, so a page left open moves into the next day by itself. */
export function useBusinessNow(everyMs = 30_000): Date {
  const [now, setNow] = useState(() => getServerNow());
  useEffect(() => {
    const t = setInterval(() => setNow(getServerNow()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

export type DrawState =
  | "scheduled"        // its window has not opened yet
  | "awaiting_live"    // the window is open but nobody has switched it live
  | "live"             // taking bets
  | "betting_closed"   // marked live, but its close time has passed
  | "pending_calc"     // closed, draws not yet run
  | "completed";       // closed and calculated

export const DRAW_STATE_LABEL: Record<DrawState, string> = {
  scheduled: "Scheduled",
  awaiting_live: "Window open · not live",
  live: "Live",
  betting_closed: "Betting closed",
  pending_calc: "Pending calculation",
  completed: "Completed",
};

type GameLike = { id: string; status: string; goLiveAt: string | Date; closeAt: string | Date };

export function drawState(g: GameLike, now: Date, calculated: boolean): DrawState {
  const open = new Date(g.goLiveAt).getTime();
  const close = new Date(g.closeAt).getTime();
  const t = now.getTime();
  if (g.status === "closed") return calculated ? "completed" : "pending_calc";
  if (g.status === "live") return t < close ? "live" : "betting_closed";
  // offline
  if (t < open) return "scheduled";
  if (t < close) return "awaiting_live";
  return calculated ? "completed" : "pending_calc";
}

/** Does this draw belong to the given business day? Its close decides, as the calculation does. */
export function isOnBusinessDay(g: GameLike, day: string): boolean {
  return businessDate(g.closeAt) === day;
}

/**
 * The draw the dashboard should open on.
 *
 * A game that is live right now wins outright. Failing that, today's own
 * draws, in the order they matter: one whose window is open, one waiting to
 * be calculated, one already done, one still to come. Never a previous day's
 * draw - with nothing scheduled today, there is no current draw, and the
 * dashboard says so instead of carrying Saturday's figures into Monday.
 */
export function pickCurrentGame<T extends GameLike>(games: T[], now: Date, calculatedIds: Set<string>): T | null {
  const today = businessDate(now);
  const state = (g: T) => drawState(g, now, calculatedIds.has(g.id));
  const live = games.filter((g) => state(g) === "live").sort((a, b) => +new Date(a.closeAt) - +new Date(b.closeAt));
  if (live.length) return live[0];
  const todays = games.filter((g) => isOnBusinessDay(g, today));
  const rank: Record<DrawState, number> = { live: 0, awaiting_live: 1, betting_closed: 2, pending_calc: 3, completed: 4, scheduled: 5 };
  todays.sort((a, b) => rank[state(a)] - rank[state(b)] || +new Date(a.closeAt) - +new Date(b.closeAt));
  return todays[0] ?? null;
}
