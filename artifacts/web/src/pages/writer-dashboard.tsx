import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Ticket, CalendarX, Clock, Lock } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { MySummarySection } from "@/components/my-summary";
import { SettlementBanner } from "@/components/settlement-banner";
import { LIVE_REFETCH_MS } from "@/components/live-sales";
import { getServerNow } from "@/lib/time-sync";

export function WriterDashboard() {
  const { user } = useAuth();

  const { data: games } = useQuery<any[]>({
    queryKey: ["/api/games"],
    queryFn: async () => {
      const res = await fetch("/api/games", {
        headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` },
      });
      return res.json();
    },
    refetchInterval: LIVE_REFETCH_MS,
  });

  // Games stay 'live' past their close time by design, so the clock decides
  // whether betting is actually open. Server time, not the device's.
  const [now, setNow] = useState(() => getServerNow().getTime());
  useEffect(() => {
    const t = setInterval(() => setNow(getServerNow().getTime()), 1000);
    return () => clearInterval(t);
  }, []);

  const liveGames = (games ?? []).filter((g) => g.status === "live");

  const closesIn = (closeAt: string) => {
    const ms = new Date(closeAt).getTime() - now;
    if (ms <= 0) return null;
    const mins = Math.floor(ms / 60000);
    if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
    if (mins > 0) return `${mins}m`;
    return `${Math.floor(ms / 1000)}s`;
  };

  return (
    /* One vertical rhythm for the whole page; sections never set their own
       outer spacing, so nothing drifts out of alignment. */
    <div className="space-y-5">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight truncate">
            {user?.fullName}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            <span className="font-mono">{user?.fullCode}</span>
            <span className="mx-1.5 text-muted-foreground/40">·</span>
            <span className="capitalize">{user?.operationModel}</span>
          </p>
        </div>
        <Link href="/writer/place-bet">
          <Button size="sm" className="h-9 rounded-lg font-medium">
            <Ticket className="mr-1.5 h-4 w-4" /> Place Bet
          </Button>
        </Link>
      </header>

      <SettlementBanner />

      <MySummarySection title="My Live Sales" />

      {/* Refresh note sits between the stats and the games, so the figures
          above are plainly what it refers to. */}
      <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
        </span>
        Live · refreshes every {LIVE_REFETCH_MS / 1000}s
      </p>

      {/* Live games */}
      <section className="space-y-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Live Games
        </h2>

        {liveGames.length === 0 ? (
          <Card className="border-dashed bg-muted/30">
            <CardContent className="flex flex-col items-center justify-center gap-1.5 py-10 text-center">
              <CalendarX className="h-7 w-7 text-muted-foreground/40" />
              <p className="text-sm font-medium">No live games</p>
              <p className="text-xs text-muted-foreground">
                Games appear here once an administrator opens them.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {liveGames.map((game) => {
              const remaining = closesIn(game.closeAt);
              const closed = remaining === null;
              return (
                <Card key={game.id} className={closed ? "opacity-70" : undefined}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-sm truncate">{game.name}</h3>
                        <p className="text-[11px] font-mono text-muted-foreground mt-0.5">
                          {game.eventNumber}
                        </p>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${
                          closed
                            ? "bg-muted text-muted-foreground"
                            : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        }`}
                      >
                        {closed ? <Lock className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                        {closed ? "Closed" : remaining}
                      </span>
                    </div>

                    {closed ? (
                      /* Past close time betting is refused server-side, so the
                         control is disabled rather than leading to an error. */
                      <Button variant="outline" className="w-full h-9 rounded-lg text-xs" disabled>
                        Betting closed
                      </Button>
                    ) : (
                      <Link href={`/writer/place-bet?game=${game.id}`}>
                        <Button variant="outline" className="w-full h-9 rounded-lg text-xs font-medium">
                          Play Now
                        </Button>
                      </Link>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
