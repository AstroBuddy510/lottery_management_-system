import { useCallback, useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, Radio, CalendarX, ChevronDown, History, Check } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { fmtGHS, cn } from "@/lib/utils";
import { ghsPD } from "@/lib/waterfall";
import { GamePicker, useLiveGames, useLiveGameSelection, LIVE_REFETCH_MS, type LiveGame } from "@/components/live-sales";

/**
 * Consolidated performance for whoever is signed in, scoped server-side:
 *   agent  - their own entries plus their writers' portal sales
 *   writer - only what they sold in their own portal
 *
 * Figures come from the same unified aggregation and calculateWriter the
 * director's dashboard uses, so an agent's numbers reconcile with the slice
 * of the platform view that covers them.
 */

interface MySummary {
  calcDate: string;
  scope: string;
  totals: {
    gross: number; commission: number; netBeforeDeduction: number;
    reserve: number; netAfterReserve: number; wins: number; profitOrDeficit: number;
  };
  sourceSplit: { entryGross: number; ticketGross: number; ticketCount: number };
  writers: Array<{
    writerId: string; writerName: string; writerCode: string;
    gross: number; wins: number; entryGross: number; ticketGross: number; ticketCount: number;
  }>;
}

function Figure({
  label,
  value,
  accent,
  negative,
}: {
  label: string;
  value: string;
  accent?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold leading-tight">
        {label}
      </div>
      <div
        className={`text-sm sm:text-base font-bold tabular-nums whitespace-nowrap mt-0.5 ${
          negative ? "text-destructive" : accent ? "text-primary" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

async function fetchSummary(gameId: string): Promise<MySummary> {
  const params = new URLSearchParams({ gameId });
  const res = await fetch(`/api/dashboard/my-summary?${params}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load summary");
  return res.json();
}

interface SummaryProps {
  title?: string;
  className?: string;
  /** Lets a page drive which draw is shown (the agent home's draw chips). */
  gameId?: string | null;
  onGameChange?: (id: string) => void;
}

export function MySummarySection(props: SummaryProps) {
  const { user } = useAuth();
  // A writer sees every draw of the day side by side, each on its own.
  if (user?.role === "writer") return <WriterEventSummaries title={props.title} className={props.className} />;
  return <AgencySummary {...props} />;
}

function AgencySummary({ title, className, gameId: controlledId, onGameChange }: SummaryProps) {
  const [ownId, setOwnId] = useLiveGameSelection();
  const controlled = controlledId !== undefined && !!onGameChange;
  const gameId = controlled ? controlledId : ownId;
  const setGameId = controlled ? onGameChange! : setOwnId;
  // When the page drives the draw, it also picks the default; the list here
  // must not override it (the two lists can differ for a past date).
  const noAutoPick = useCallback(() => {}, []);
  const { games, isLoading: gamesLoading } = useLiveGames(gameId ?? null, controlled ? noAutoPick : setGameId);

  // Never asked for without a draw: the server reports one event at a time.
  const { data, isLoading: summaryLoading, isFetching, isError, error } = useQuery<MySummary>({
    queryKey: ["/api/dashboard/my-summary", gameId],
    queryFn: () => fetchSummary(gameId!),
    enabled: !!gameId,
    refetchInterval: LIVE_REFETCH_MS,
  });
  const isLoading = gamesLoading || (!!gameId && summaryLoading);

  const isWriter = data?.scope === "writer";
  const t = data?.totals;
  const split = data?.sourceSplit;

  return (
    <Card className={cn(className)}>
      {/* Stacked on a phone. Side by side, the game badge would not shrink and
          squeezed the title column until "My Live Sales" wrapped one word per
          line and the description was clipped. */}
      <CardHeader className="flex-col items-stretch gap-2 space-y-0 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base whitespace-nowrap">
            <Radio className={`h-4 w-4 shrink-0 ${isFetching ? "text-emerald-500 animate-pulse" : "text-muted-foreground"}`} />
            {title ?? (isWriter ? "My Sales" : "My Agency")}
          </CardTitle>
          <CardDescription className="text-xs leading-snug">
            {isWriter
              ? "Sales made in your portal"
              : "Your own entries plus your writers' portal sales"}
            {/* Writers get the live indicator below the stats instead, where it
                sits between the figures and the games list. */}
            {!isWriter && (
              <span className="block text-[10px] text-muted-foreground/70 mt-0.5">
                Live · refreshes every {LIVE_REFETCH_MS / 1000}s
              </span>
            )}
          </CardDescription>
        </div>
        <div className="min-w-0 sm:shrink-0">
          {/* Driven from the page's draw chips, the picker would be a second
              control for the same thing. */}
          {!controlled && <GamePicker games={games} selectedId={gameId} onSelect={setGameId} />}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="py-8 text-center"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
        ) : !gameId && games.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No draw is running today.</p>
        ) : !gameId ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Choose a draw to see its figures.</p>
        ) : isError ? (
          <p className="py-6 text-center text-sm text-destructive">{(error as Error).message}</p>
        ) : !t || (t.gross === 0 && t.wins === 0) ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No sales recorded for this draw yet.</p>
        ) : (
          <>
            {isWriter ? (
              // Gross, Net, Commission, Wins, Profit/Deficit - in that order.
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <Figure label="Gross" value={fmtGHS(t.gross)} />
                <Figure label="Net" value={fmtGHS(t.netBeforeDeduction)} />
                <Figure label="Commission" value={fmtGHS(t.commission)} />
                <Figure label="Wins" value={fmtGHS(t.wins)} />
                <Figure
                  label="Profit / Deficit"
                  value={fmtGHS(t.profitOrDeficit)}
                  accent
                  negative={t.profitOrDeficit < 0}
                />
              </div>
            ) : (
              // The platform waterfall, in its order and with its names.
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Figure label="Gross Sales" value={fmtGHS(t.gross)} />
                <Figure label="Commission" value={fmtGHS(t.commission)} />
                <Figure label="Net After Commission" value={fmtGHS(t.netBeforeDeduction)} />
                <Figure label="Reserve" value={fmtGHS(t.reserve)} />
                <Figure label="Net After Reserve" value={fmtGHS(t.netAfterReserve)} />
                <Figure label="Wins Deduct" value={fmtGHS(t.wins)} />
                <Figure label="Profit / (Deficit)" value={ghsPD(t.profitOrDeficit, "GH₵")} accent negative={t.profitOrDeficit < 0} />
                <Figure label="Writers Active" value={String(data!.writers.length)} />
              </div>
            )}

            {/* An agent needs to see which route their gross came through. */}
            {!isWriter && split && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs rounded-lg border bg-muted/30 px-3 py-2">
                <span className="font-semibold text-muted-foreground">Gross by source:</span>
                <span>
                  <span className="text-muted-foreground">My entries </span>
                  <span className="font-mono font-bold">{fmtGHS(split.entryGross)}</span>
                </span>
                <span>
                  <span className="text-muted-foreground">Writer portal </span>
                  <span className="font-mono font-bold">{fmtGHS(split.ticketGross)}</span>
                  <span className="text-muted-foreground"> ({split.ticketCount} ticket{split.ticketCount === 1 ? "" : "s"})</span>
                </span>
              </div>
            )}

            {!isWriter && data!.writers.length > 0 && (
              // Scrolls on its own so a large team does not stretch the page.
              <div className="rounded-md border overflow-auto max-h-[22rem] overscroll-contain">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead className="sticky top-0 z-[1] bg-card shadow-[0_1px_0_hsl(var(--border))]">
                    <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="text-left font-bold px-3 py-2">Writer</th>
                      <th className="text-right font-bold px-3 py-2">My Entries</th>
                      <th className="text-right font-bold px-3 py-2">Portal</th>
                      <th className="text-right font-bold px-3 py-2">Gross</th>
                      <th className="text-right font-bold px-3 py-2">Wins</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data!.writers.map((w) => (
                      <tr key={w.writerId}>
                        <td className="px-3 py-2">
                          <span className="block text-xs font-medium">{w.writerName}</span>
                          <span className="block text-[10px] font-mono text-muted-foreground">{w.writerCode}</span>
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums">{fmtGHS(w.entryGross)}</td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums">
                          {fmtGHS(w.ticketGross)}
                          {w.ticketCount > 0 && <span className="text-muted-foreground"> ({w.ticketCount})</span>}
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums font-semibold">{fmtGHS(w.gross)}</td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums">{fmtGHS(w.wins)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ─── Writer portal: one panel per draw ─────────────────────────────────── */

/**
 * A writer's sales, event by event.
 *
 * Every draw of the day gets its own panel and its own figures, and nothing
 * is added across them: a good morning draw must not hide a bad afternoon
 * one. The figures follow the writer's formula, with no reserve:
 *
 *   Gross Sales - Commission = Net
 *   Net - Wins = Profit / (Deficit)
 */
function WriterEventSummaries({ title, className }: { title?: string; className?: string }) {
  const games = useQuery<LiveGame[]>({
    queryKey: ["/api/live-sales/games"],
    queryFn: async () => {
      const res = await fetch("/api/live-sales/games", {
        headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` },
      });
      if (!res.ok) throw new Error("Could not load draws");
      return res.json();
    },
    refetchInterval: LIVE_REFETCH_MS,
  });
  const all = games.data ?? [];
  // Live draws, soonest to close first; closed draws, latest first.
  const live = all.filter((g) => g.status === "live").sort((a, b) => +new Date(a.closeAt) - +new Date(b.closeAt));
  const closed = all.filter((g) => g.status !== "live").sort((a, b) => +new Date(b.closeAt) - +new Date(a.closeAt));

  /*
   * Live sales sit on top. Closed draws are folded away underneath; opening
   * the list and choosing one shows that draw's figures right there, and
   * folding it again leaves only the live draw on screen.
   */
  const [closedOpen, setClosedOpen] = useState(false);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const toggleClosed = (open: boolean) => {
    setClosedOpen(open);
    if (!open) setPickedId(null);
  };
  const picked = closedOpen ? closed.find((g) => g.id === pickedId) ?? null : null;

  const liveSummaries = useQueries({
    queries: live.map((g) => ({
      queryKey: ["/api/dashboard/my-summary", g.id],
      queryFn: () => fetchSummary(g.id),
      refetchInterval: LIVE_REFETCH_MS,
    })),
  });
  // A closed draw does not change, so it is fetched once and not polled.
  const pickedSummary = useQuery<MySummary>({
    queryKey: ["/api/dashboard/my-summary", picked?.id],
    queryFn: () => fetchSummary(picked!.id),
    enabled: !!picked,
    staleTime: 5 * 60_000,
  });
  const fetching = liveSummaries.some((q) => q.isFetching);

  return (
    <section className={cn("space-y-3", className)}>
      {/* ── My Live Sales ── */}
      <Card className="overflow-hidden rounded-2xl border-0 shadow-sm ring-1 ring-border/70">
        <CardHeader className="flex-row items-center justify-between space-y-0 border-b bg-gradient-to-r from-primary/[0.06] to-transparent px-4 py-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
              <Radio className={`h-4 w-4 ${fetching ? "text-emerald-500 animate-pulse" : "text-primary"}`} />
            </span>
            {title ?? "My Sales"}
          </CardTitle>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
          </span>
        </CardHeader>
        <CardContent className="space-y-3 p-3 sm:p-4">
          {games.isLoading ? (
            <div className="py-8 text-center"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
          ) : live.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 py-8 text-center">
              <CalendarX className="h-6 w-6 text-muted-foreground/40" />
              <p className="text-sm font-medium">No live game right now</p>
              {closed.length > 0 && <p className="text-xs text-muted-foreground">Earlier draws are under Closed games below.</p>}
            </div>
          ) : (
            live.map((g, i) => (
              <WriterEventPanel key={g.id} game={g} summary={liveSummaries[i]?.data}
                loading={!!liveSummaries[i]?.isLoading} error={liveSummaries[i]?.error as Error | null} />
            ))
          )}
        </CardContent>
      </Card>

      {/* ── Closed games, folded underneath ── */}
      {closed.length > 0 && (
        <Collapsible open={closedOpen} onOpenChange={toggleClosed}
          className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border/70">
          <CollapsibleTrigger asChild>
            <button type="button"
              className="group flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-muted/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40">
              <span className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted">
                  <History className="h-4 w-4 text-muted-foreground" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">Closed games</span>
                  <span className="block text-[11px] text-muted-foreground">
                    <span className="group-data-[state=open]:hidden">{closed.length} earlier draw{closed.length === 1 ? "" : "s"} · tap to view</span>
                    <span className="hidden group-data-[state=open]:inline">Choose a draw to see its sales</span>
                  </span>
                </span>
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
            <div className="space-y-3 border-t p-3 sm:p-4">
              <ul role="listbox" aria-label="Closed games" className="flex gap-2 overflow-x-auto pb-1 thin-scroll">
                {closed.map((g) => {
                  const on = g.id === pickedId;
                  return (
                    <li key={g.id} className="shrink-0">
                      <button type="button" role="option" aria-selected={on} onClick={() => setPickedId(g.id)}
                        className={cn("flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors",
                          on ? "border-primary bg-primary/[0.07] ring-1 ring-primary" : "bg-background hover:bg-muted/60")}>
                        <span className="min-w-0">
                          <span className={cn("block max-w-[10rem] truncate text-xs font-bold", on && "text-primary")}>{g.name}</span>
                          <span className="block font-mono text-[10px] text-muted-foreground">
                            {g.eventNumber} · {new Date(g.closeAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                          </span>
                        </span>
                        {on && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {picked ? (
                <WriterEventPanel game={picked} summary={pickedSummary.data} loading={pickedSummary.isLoading}
                  error={pickedSummary.error as Error | null} />
              ) : (
                <p className="rounded-xl border border-dashed py-5 text-center text-xs text-muted-foreground">
                  Pick a draw above to see its sales.
                </p>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </section>
  );
}

function WriterEventPanel({ game, summary, loading, error }: {
  game: LiveGame; summary?: MySummary; loading: boolean; error: Error | null;
}) {
  const t = summary?.totals;
  const split = summary?.sourceSplit;
  const tickets = split?.ticketCount ?? 0;
  const empty = !t || (t.gross === 0 && t.wins === 0);
  const isLive = game.status === "live";
  // The writer formula, worked from the server's figures in whole pesewas.
  const p = (v: number) => Math.round(v * 100);
  const net = t ? (p(t.gross) - p(t.commission)) / 100 : 0;
  const profit = t ? (p(t.gross) - p(t.commission) - p(t.wins)) / 100 : 0;
  const drawn = (game.winningNumbers ?? "").split(",").map((n) => n.trim()).filter(Boolean);
  return (
    <section className="overflow-hidden rounded-xl border bg-background">
      <header className="flex items-center justify-between gap-2 px-3.5 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">{game.name}</div>
          <div className="truncate font-mono text-[10px] text-muted-foreground">
            {game.eventNumber}
            {!empty && tickets > 0 ? ` · ${tickets} ticket${tickets === 1 ? "" : "s"}` : ""}
          </div>
        </div>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
          isLive ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
          {isLive ? "Live" : "Closed"}
        </span>
      </header>
      {drawn.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-t bg-muted/30 px-3.5 py-2">
          <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Drawn</span>
          {drawn.map((n, i) => (
            <span key={`${n}-${i}`} className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1 font-mono text-[11px] font-bold text-primary-foreground">
              {n.padStart(2, "0")}
            </span>
          ))}
        </div>
      )}
      <div className="border-t p-3">
        {loading ? (
          <div className="py-4 text-center"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
        ) : error ? (
          <p className="py-3 text-center text-xs text-destructive">{error.message}</p>
        ) : empty ? (
          <p className="py-3 text-center text-xs text-muted-foreground">
            {isLive ? "No sales on this draw yet." : "No sales were recorded under your code for this draw."}
          </p>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Gross Sales" value={fmtGHS(t!.gross)} tone="slate" />
              <Stat label="Commission" value={fmtGHS(t!.commission)} tone="sky" />
              <Stat label="Net" value={fmtGHS(net)} tone="indigo" />
              <Stat label="Wins" value={fmtGHS(t!.wins)} tone="amber" />
            </div>
            <div className={cn("flex items-center justify-between rounded-xl px-3.5 py-2.5",
              profit < 0 ? "bg-red-500/[0.07] ring-1 ring-red-500/20" : "bg-emerald-500/[0.07] ring-1 ring-emerald-500/20")}>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Profit / (Deficit)</span>
              <span className={cn("text-lg font-black tabular-nums", profit < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>
                {ghsPD(profit, "GH₵")}
              </span>
            </div>
            {split && split.entryGross > 0 && (
              <p className="text-[10px] text-muted-foreground">
                Includes {fmtGHS(split.entryGross)} entered by your agent
                {split.ticketGross > 0 ? ` and ${fmtGHS(split.ticketGross)} from your portal tickets` : ""}.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

const STAT_TONE: Record<string, string> = {
  slate: "border-l-slate-400",
  sky: "border-l-sky-500",
  indigo: "border-l-indigo-500",
  amber: "border-l-amber-500",
};

function Stat({ label, value, tone }: { label: string; value: string; tone: keyof typeof STAT_TONE }) {
  return (
    <div className={cn("rounded-lg border border-l-[3px] bg-card px-3 py-2", STAT_TONE[tone])}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-[15px] font-bold tabular-nums whitespace-nowrap">{value}</div>
    </div>
  );
}
