import { useEffect, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";

export type AlertItem = {
  key: string;
  area: "notifications" | "live-ticker" | "risk" | "finance" | "payments" | "draws";
  tone: "info" | "warn" | "urgent";
  title: string;
  detail: string;
  count?: number;
  href: string;
};
type AlertsResponse = {
  unread: number;
  newestGame: { id: string; name: string; eventNumber: string; status: string; since: string } | null;
  riskTotal: number;
  alerts: AlertItem[];
};

export const ALERTS_KEY = ["/api/alerts"] as const;

/*
 * Which game the user last saw on the Live Ticker. Kept in this browser only:
 * it is a per-person convenience, and losing it just shows the dot once more.
 */
const SEEN_KEY = "vs2000.liveTicker.seenGame";
const listeners = new Set<() => void>();
function readSeen(): string | null {
  try { return localStorage.getItem(SEEN_KEY); } catch { return null; }
}
export function markGameSeen(id: string) {
  try { localStorage.setItem(SEEN_KEY, id); } catch { /* private mode: the dot simply returns */ }
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => { if (e.key === SEEN_KEY) l(); };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(l); window.removeEventListener("storage", onStorage); };
}

/**
 * Everything the menu badges and the bell show, from one polled request.
 * Roles the endpoint does not serve (agents, entry clerks) get nothing.
 */
export function useAlerts() {
  const { user } = useAuth();
  const enabled = user?.role === "director" || user?.role === "administrator" || user?.role === "cashier";
  const q = useQuery({
    queryKey: ALERTS_KEY,
    queryFn: () => customFetch<AlertsResponse>("/api/alerts", { method: "GET" }),
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const seen = useSyncExternalStore(subscribe, readSeen, () => null);
  const data = q.data;
  const newGame = !!data?.newestGame && data.newestGame.id !== seen;
  // A game already looked at stays in the list, without counting as new.
  const alerts = (data?.alerts ?? []).filter((a) => a.area !== "live-ticker" || newGame);
  return {
    unread: data?.unread ?? 0,
    newGame,
    newestGame: data?.newestGame ?? null,
    riskAttention: (data?.riskTotal ?? 0) > 0,
    drawAttention: alerts.some((a) => a.area === "draws"),
    alerts,
    total: alerts.length,
    isLoading: q.isLoading,
  };
}

/** Opening the Live Ticker marks the newest game as seen. */
export function useMarkGameSeenOn(path: string, location: string, gameId: string | undefined) {
  useEffect(() => {
    if (gameId && (location === path || location.startsWith(`${path}/`))) markGameSeen(gameId);
  }, [path, location, gameId]);
}
