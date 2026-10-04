import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lock, Clock, AlertTriangle } from "lucide-react";
import { cn, fmtGHS } from "@/lib/utils";
import { getServerNow } from "@/lib/time-sync";
import { useEffect, useState } from "react";

/**
 * What a writer sees when automated settlement is running.
 *
 * Two jobs. Before the midpoint it is a countdown, so the deadline never
 * arrives as a surprise. After it, with money owed, it is the explanation for
 * why Place Bet has stopped working - which matters more than the lock itself,
 * because a terminal that simply refuses is indistinguishable from a broken one.
 *
 * It renders nothing at all when the feature is off, which is the normal case.
 */

export interface GateGame {
  gameId: string;
  gameName: string;
  eventNumber: string;
  enabled: boolean;
  allowed: boolean;
  reason: "midpoint-unpaid" | "previous-day-unpaid" | null;
  amountDue: number;
  locksAt: string | null;
  midpointAt: string | null;
  owedFrom: string | null;
}

export function useSettlementGate() {
  return useQuery<{ enabled: boolean; games: GateGame[] }>({
    queryKey: ["/api/postpaid/auto/gate"],
    queryFn: async () => {
      const res = await fetch("/api/postpaid/auto/gate", {
        headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` },
      });
      if (!res.ok) return { enabled: false, games: [] };
      return res.json();
    },
    refetchInterval: 30_000,
  });
}

/** The gate for one specific game, or null when nothing applies. */
export function gateFor(
  data: { enabled: boolean; games: GateGame[] } | undefined,
  gameId: string,
): GateGame | null {
  if (!data?.enabled) return null;
  return data.games.find((g) => g.gameId === gameId) ?? null;
}

function useCountdown(target: string | null): { minutes: number; seconds: number; past: boolean } {
  const [now, setNow] = useState(() => getServerNow().getTime());
  useEffect(() => {
    const t = setInterval(() => setNow(getServerNow().getTime()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!target) return { minutes: 0, seconds: 0, past: true };
  const ms = new Date(target).getTime() - now;
  if (ms <= 0) return { minutes: 0, seconds: 0, past: true };
  return { minutes: Math.floor(ms / 60_000), seconds: Math.floor((ms % 60_000) / 1000), past: false };
}

export function SettlementLockBanner({ gate }: { gate: GateGame | null }) {
  const { minutes, seconds, past } = useCountdown(gate?.locksAt ?? null);
  if (!gate || !gate.enabled) return null;

  // Locked out.
  if (!gate.allowed) {
    const yesterday = gate.reason === "previous-day-unpaid";
    return (
      <Card className="border-red-400/70 bg-red-50 dark:border-red-500/50 dark:bg-red-950/40">
        <CardContent className="flex items-start gap-3 py-4">
          <Lock className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-red-900 dark:text-red-100">
              {yesterday ? "Yesterday's bill is unpaid" : "Settlement due — selling is paused"}
            </p>
            <p className="mt-0.5 text-xs text-red-800/90 dark:text-red-200/90">
              {yesterday
                ? `You owe ${fmtGHS(gate.amountDue)} from ${gate.owedFrom}. Pay it to start selling again.`
                : `Hand in ${fmtGHS(gate.amountDue)} for ${gate.gameName}. Selling resumes the moment it is confirmed.`}
            </p>
            <p className="mt-1.5 font-mono text-lg font-bold tabular-nums text-red-900 dark:text-red-100">
              {fmtGHS(gate.amountDue)}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Nothing owed yet, or nothing to warn about.
  if (gate.amountDue <= 0 || past) return null;

  const urgent = minutes < 10;
  return (
    <Card
      className={cn(
        urgent
          ? "border-amber-400/70 bg-amber-50 dark:border-amber-500/50 dark:bg-amber-950/40"
          : "border-sky-300/70 bg-sky-50 dark:border-sky-500/40 dark:bg-sky-950/40",
      )}
    >
      <CardContent className="flex items-start gap-3 py-3.5">
        {urgent ? (
          <AlertTriangle className="mt-0.5 h-4.5 w-4.5 shrink-0 text-amber-600 dark:text-amber-400" />
        ) : (
          <Clock className="mt-0.5 h-4.5 w-4.5 shrink-0 text-sky-600 dark:text-sky-400" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold">Settlement due in</p>
            <Badge variant="outline" className="font-mono text-xs font-bold tabular-nums">
              {minutes}m {String(seconds).padStart(2, "0")}s
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {fmtGHS(gate.amountDue)} for {gate.gameName}. Selling pauses until it is handed in.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
