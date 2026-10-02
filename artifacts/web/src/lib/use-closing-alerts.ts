import { useEffect, useRef, useState } from "react";
import { getServerNow } from "@/lib/time-sync";

/**
 * Closing warnings for the writers' portal.
 *
 * The brief that shapes every decision in here is "must not interfere with
 * ongoing operations". A writer is standing in a market with a customer in
 * front of them and half a bet typed in. So:
 *
 *  - nothing here steals focus, blocks input, or moves the page;
 *  - each warning fires exactly once per game, and survives navigation
 *    between the portal's pages (each route remounts the layout, so the
 *    record of what has already been said has to live outside React);
 *  - a warning is only raised on a threshold the writer was actually present
 *    for. Signing in with eight minutes left must not dump 30, 15 and 10 on
 *    them at once - those are marked spent in silence;
 *  - time comes from the server, never the handset. Writers' phone clocks are
 *    routinely wrong, and a wrong clock here would either cry wolf or stay
 *    quiet through the close.
 */

export const CLOSING_THRESHOLDS = [30, 15, 10, 5] as const;
export type ClosingThreshold = (typeof CLOSING_THRESHOLDS)[number];

export interface ClosingAlert {
  /** `${gameId}:${minutes}` - stable, so dismissing one cannot resurrect it. */
  id: string;
  gameId: string;
  gameName: string;
  eventNumber: string;
  minutes: ClosingThreshold;
  closeAt: string;
  /** Server clock at the moment it was raised, for auto-dismissal. */
  raisedAt: number;
}

interface GameLike {
  id: string;
  name?: string | null;
  eventNumber?: string | null;
  closeAt: string;
  status?: string | null;
}

const STORE_KEY = "vs2000.writer.closingAlertsSpoken";

/**
 * Which warnings have already been given. In sessionStorage rather than state
 * because the portal remounts its layout on every navigation - without this a
 * writer tapping between Bet and Tickets would be told "15 minutes left" again
 * on each hop.
 */
function readSpoken(): Set<string> {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : []);
  } catch {
    // Private browsing, cleared storage, a quota wall - any of these just mean
    // we fall back to in-memory behaviour for this mount. Never fatal.
    return new Set();
  }
}

function writeSpoken(keys: Set<string>): void {
  try {
    // Only the tail matters; old games can never come back round.
    sessionStorage.setItem(STORE_KEY, JSON.stringify([...keys].slice(-200)));
  } catch {
    /* storage unavailable - degrade quietly */
  }
}

export function minutesLeft(closeAt: string, nowMs: number): number {
  return (new Date(closeAt).getTime() - nowMs) / 60000;
}

/** A game a writer can still sell into. Status alone is not enough: games stay
 *  'live' past their close time by design, and only calculations close them. */
export function isSellable(g: GameLike, nowMs: number): boolean {
  return g.status === "live" && new Date(g.closeAt).getTime() > nowMs;
}

/**
 * The whole decision, as a pure function, so it can be reasoned about and
 * tested without a DOM or a clock. Both `spoken` and `firstSeen` are mutated:
 * they are the caller's memory of what has already been said, and they must
 * outlive any single evaluation.
 */
export function pendingAlerts(opts: {
  games: GameLike[];
  nowMs: number;
  spoken: Set<string>;
  firstSeen: Map<string, number>;
}): ClosingAlert[] {
  const { games, nowMs, spoken, firstSeen } = opts;
  const raised: ClosingAlert[] = [];

  for (const g of games) {
    if (!isSellable(g, nowMs)) continue;

    const left = minutesLeft(g.closeAt, nowMs);
    if (left <= 0) continue;

    const seenAt = firstSeen.get(g.id);
    if (seenAt === undefined) firstSeen.set(g.id, left);
    const baseline = seenAt ?? left;

    for (const threshold of CLOSING_THRESHOLDS) {
      if (left > threshold) continue;
      const key = `${g.id}:${threshold}`;
      if (spoken.has(key)) continue;

      // Consumed either way - the difference is only whether we speak.
      spoken.add(key);

      // Already behind us when this mount started watching: the writer has
      // arrived late and does not need a deadline recited after the fact.
      if (threshold >= baseline) continue;

      raised.push({
        id: key,
        gameId: g.id,
        gameName: g.name ?? "Draw",
        eventNumber: g.eventNumber ?? "",
        minutes: threshold,
        closeAt: g.closeAt,
        raisedAt: nowMs,
      });
    }
  }

  return raised;
}

export function useClosingAlerts(games: GameLike[] | undefined) {
  const [now, setNow] = useState(() => getServerNow().getTime());
  const [alerts, setAlerts] = useState<ClosingAlert[]>([]);

  const spoken = useRef<Set<string>>(readSpoken());
  const firstSeen = useRef<Map<string, number>>(new Map());

  // One tick a second lands a warning within a second of its threshold, and is
  // the cadence the Place Bet screen already runs on.
  useEffect(() => {
    const t = setInterval(() => setNow(getServerNow().getTime()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const raised = pendingAlerts({
      games: games ?? [],
      nowMs: now,
      spoken: spoken.current,
      firstSeen: firstSeen.current,
    });

    if (raised.length > 0) {
      writeSpoken(spoken.current);
      // Newest first, and capped at two. The thresholds are fifteen minutes
      // apart at the closest, and all but the last auto-dismiss, so a stack
      // only happens when several draws close together - and three cards deep
      // starts covering the number pad, which is the interference we are
      // avoiding. Two conveys "more than one draw" without taking the screen.
      setAlerts((prev) => [...raised, ...prev].slice(0, 2));
    }

    // Drop anything whose game has shut. The close is the end of the
    // conversation; a stale "5 minutes left" afterwards is worse than silence.
    setAlerts((prev) => {
      const next = prev.filter((a) => new Date(a.closeAt).getTime() > now);
      return next.length === prev.length ? prev : next;
    });
  }, [games, now]);

  const dismiss = (id: string) => setAlerts((prev) => prev.filter((a) => a.id !== id));

  return { alerts, dismiss, now };
}
