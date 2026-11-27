import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Ticket, CalendarX, Clock, Lock, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
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

  const firstName = user?.fullName?.split(" ")[0] ?? "Writer";
  const hour = getServerNow().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const openCount = liveGames.filter((g) => closesIn(g.closeAt) !== null).length;

  return (
    /* A single centred column, read top to bottom on one vertical rhythm.
       Sections never set their own outer spacing, so nothing drifts out of
       alignment, and the column stays narrow enough to scan on a phone or a
       wide screen alike. */
    <div className="mx-auto w-full max-w-lg space-y-5">
      {/* Hero */}
      <header
        className="relative overflow-hidden rounded-3xl p-5 text-white shadow-lg"
        style={{ background: "linear-gradient(135deg, #0f2747 0%, #1e3a8a 50%, #1d4ed8 100%)" }}
      >
        <div aria-hidden className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full bg-white/[0.07]" />
        <div aria-hidden className="pointer-events-none absolute -bottom-20 left-1/3 h-40 w-40 rounded-full bg-sky-300/[0.08]" />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-white/70">{greeting}</p>
            <h1 className="truncate text-2xl font-black leading-tight">{firstName}</h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="rounded-md bg-white/15 px-2 py-0.5 font-mono font-bold tracking-wider">{user?.fullCode}</span>
              <span className="rounded-md bg-white/10 px-2 py-0.5 capitalize text-white/80">{user?.operationModel}</span>
            </p>
          </div>
          <Link href="/writer/place-bet">
            <Button size="sm" className="h-10 rounded-xl bg-white px-4 font-bold text-blue-700 shadow-md hover:bg-blue-50">
              <Ticket className="mr-1.5 h-4 w-4" /> Place Bet
            </Button>
          </Link>
        </div>
        <div className="relative mt-4 flex items-center gap-2 rounded-2xl bg-white/10 px-3 py-2 text-xs backdrop-blur-sm">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          {openCount > 0
            ? `${openCount} game${openCount === 1 ? "" : "s"} open for betting`
            : "No game open for betting right now"}
          <span className="ml-auto text-[10px] text-white/60">refreshes every {LIVE_REFETCH_MS / 1000}s</span>
        </div>
      </header>

      <SettlementBanner />

      {/* Live games */}
      <section className="space-y-2.5">
        <h2 className="px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Live Games
        </h2>

        {liveGames.length === 0 ? (
          <Card className="rounded-2xl border-dashed bg-muted/30">
            <CardContent className="flex flex-col items-center justify-center gap-1.5 py-10 text-center">
              <CalendarX className="h-7 w-7 text-muted-foreground/40" />
              <p className="text-sm font-medium">No live games</p>
              <p className="text-xs text-muted-foreground">
                Games appear here once an administrator opens them.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-2.5">
            {liveGames.map((game) => {
              const remaining = closesIn(game.closeAt);
              const closed = remaining === null;
              return (
                <Card key={game.id} className={cn("overflow-hidden rounded-2xl border-0 shadow-sm ring-1 ring-border/70", closed && "opacity-70")}>
                  <CardContent className="flex items-center gap-3 p-3.5">
                    <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                      closed ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")}>
                      <Ticket className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-bold">{game.name}</h3>
                      <div className="mt-0.5 flex items-center gap-2">
                        <span className="font-mono text-[11px] text-muted-foreground">{game.eventNumber}</span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${
                            closed
                              ? "bg-muted text-muted-foreground"
                              : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          }`}
                        >
                          {closed ? <Lock className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                          {closed ? "Closed" : `${remaining} left`}
                        </span>
                      </div>
                    </div>
                    {closed ? (
                      /* Past close time betting is refused server-side, so the
                         control is disabled rather than leading to an error. */
                      <Button variant="outline" size="sm" className="h-9 rounded-xl text-xs" disabled>
                        Closed
                      </Button>
                    ) : (
                      <Link href={`/writer/place-bet?game=${game.id}`}>
                        <Button size="sm" className="h-9 rounded-xl px-4 text-xs font-bold">
                          Play <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
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

      <MySummarySection title="My Live Sales" />
    </div>
  );
}
