import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, Radio } from "lucide-react";
import { fmtGHS } from "@/lib/utils";
import { GamePicker, useLiveGames, useLiveGameSelection, LIVE_REFETCH_MS } from "@/components/live-sales";

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
        className={`text-base font-bold tabular-nums mt-0.5 ${
          negative ? "text-destructive" : accent ? "text-primary" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

export function MySummarySection({ title }: { title?: string }) {
  const [gameId, setGameId] = useLiveGameSelection();
  const { games } = useLiveGames(gameId, setGameId);

  const { data, isLoading, isFetching, isError, error } = useQuery<MySummary>({
    queryKey: ["/api/dashboard/my-summary", gameId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (gameId) params.set("gameId", gameId);
      const res = await fetch(`/api/dashboard/my-summary?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` },
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load summary");
      return res.json();
    },
    refetchInterval: LIVE_REFETCH_MS,
  });

  const isWriter = data?.scope === "writer";
  const t = data?.totals;
  const split = data?.sourceSplit;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Radio className={`h-4 w-4 ${isFetching ? "text-emerald-500 animate-pulse" : "text-muted-foreground"}`} />
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
        <GamePicker games={games} selectedId={gameId} onSelect={setGameId} />
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="py-8 text-center"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
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
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Figure label="Gross" value={fmtGHS(t.gross)} />
                <Figure label="Commission" value={fmtGHS(t.commission)} />
                <Figure label="Net Before Deduction" value={fmtGHS(t.netBeforeDeduction)} />
                <Figure label="Reserve Fund" value={fmtGHS(t.reserve)} />
                <Figure label="Net After Reserve" value={fmtGHS(t.netAfterReserve)} />
                <Figure label="Wins" value={fmtGHS(t.wins)} />
                <Figure label="Profit / Deficit" value={fmtGHS(t.profitOrDeficit)} accent />
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
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b">
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
