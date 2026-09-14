import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { format, formatDistanceToNow } from "date-fns";
import { ShieldAlert, Check, X, Flag, Radio, TrendingDown, Landmark, Loader2 } from "lucide-react";
import { fmtGHS, cn } from "@/lib/utils";
import { GamePicker, useLiveGames, useLiveGameSelection, LIVE_REFETCH_MS } from "@/components/live-sales";
import {
  SeverityBadge,
  NumberChips,
  CoverageBar,
  Tile,
  NumberHeatMap,
  HeatLegend,
  type Severity,
  type NumberExposure,
} from "@/components/risk-parts";

interface Combination {
  key: string;
  numbers: number[];
  betTypeName: string;
  betTypeCode: string;
  multiplier: number;
  ticketCount: number;
  writerCount: number;
  redFlagTicketCount: number;
  totalStake: number;
  liability: number;
  coverage: number;
  netIfDrawn: number;
  hedgeStake: number;
  severity: Severity;
}

interface WatchRow {
  writerId: string;
  fullName: string;
  fullCode: string;
  agencyName: string | null;
  agentCode: string;
  reason: string | null;
  flaggedAt: string | null;
  ticketCount: number;
  totalStake: number;
  liability: number;
  shareOfLiability: number;
  topCombination: { numbers: number[]; betTypeCode: string; liability: number } | null;
}

interface ExposureResponse {
  game: { id: string; name: string; eventNumber: string; status: string; closeAt: string };
  generatedAt: string;
  ticketCount: number;
  poolStake: number;
  totalLiability: number;
  peakLiability: number;
  peakCoverage: number;
  hedgeToCover: number;
  atRiskCount: number;
  combinations: Combination[];
  numberHeat: NumberExposure[];
  watchList: WatchRow[];
  watchListLiability: number;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem("accessToken")}` };
}

export function AdminRiskManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedGameId, setSelectedGameId] = useLiveGameSelection();
  const { games } = useLiveGames(selectedGameId, setSelectedGameId);
  const [focusNumber, setFocusNumber] = useState<number | null>(null);

  const { data: exposure, isLoading: exposureLoading } = useQuery<ExposureResponse>({
    queryKey: ["/api/risk/exposure", selectedGameId],
    queryFn: async () => {
      const url = `/api/risk/exposure${selectedGameId ? `?gameId=${encodeURIComponent(selectedGameId)}` : ""}`;
      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load exposure");
      return res.json();
    },
    refetchInterval: LIVE_REFETCH_MS,
  });

  const { data: flags, isLoading: flagsLoading } = useQuery({
    queryKey: ["/api/risk/flags"],
    queryFn: async () => {
      const res = await fetch("/api/risk/flags", { headers: authHeaders() });
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await fetch(`/api/risk/flags/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Flag updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/risk/flags"] });
    },
  });

  const peak = exposure?.combinations[0];

  const visibleCombinations = useMemo(() => {
    const all = exposure?.combinations ?? [];
    if (focusNumber == null) return all.slice(0, 25);
    return all.filter((c) => c.numbers.includes(focusNumber)).slice(0, 25);
  }, [exposure, focusNumber]);

  return (
    <div className="space-y-6">
      {/* ---- Header ------------------------------------------------------ */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Risk Management</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            What a draw would cost us. Combinations are ranked by what we would pay if the
            NLA draws them, so the heaviest lines can be laid off before the game closes.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
          <GamePicker games={games} selectedId={selectedGameId} onSelect={setSelectedGameId} />
          {exposure && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Radio className="h-3 w-3 animate-pulse text-emerald-500" />
              Updated {formatDistanceToNow(new Date(exposure.generatedAt), { addSuffix: true })}
            </span>
          )}
        </div>
      </div>

      {exposureLoading && !exposure ? (
        <div className="flex items-center gap-2 rounded-xl border bg-card p-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading the book…
        </div>
      ) : !exposure ? null : exposure.ticketCount === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium">No live tickets on this game</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Exposure appears here as soon as writers begin selling.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ---- Worst case ------------------------------------------------ */}
          {peak && (
            <div
              className={cn(
                "rounded-2xl border p-5 sm:p-6",
                peak.severity === "critical"
                  ? "border-red-300/60 bg-red-500/[0.04] dark:border-red-500/30"
                  : peak.severity === "high"
                    ? "border-orange-300/60 bg-orange-500/[0.04] dark:border-orange-500/30"
                    : "bg-card",
              )}
            >
              <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80">
                      Heaviest line
                    </span>
                    <SeverityBadge severity={peak.severity} />
                    <Badge variant="outline" className="text-[10px] font-bold">
                      {peak.betTypeName}
                    </Badge>
                  </div>
                  <div className="mt-3">
                    <NumberChips numbers={peak.numbers} size="lg" highlight={focusNumber} />
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    {peak.ticketCount} ticket{peak.ticketCount === 1 ? "" : "s"} from{" "}
                    {peak.writerCount} writer{peak.writerCount === 1 ? "" : "s"} ·{" "}
                    {fmtGHS(peak.totalStake)} taken on these numbers
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4 lg:w-[420px] lg:shrink-0">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80">
                      We pay if drawn
                    </div>
                    <div className="mt-1 text-2xl font-bold tabular-nums text-red-600 dark:text-red-400">
                      {fmtGHS(peak.liability)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80">
                      Stake at NLA to cover
                    </div>
                    <div className="mt-1 text-2xl font-bold tabular-nums">
                      {fmtGHS(peak.hedgeStake)}
                    </div>
                  </div>
                  <div className="col-span-2">
                    <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80">
                      <span>Against {fmtGHS(exposure.poolStake)} taken</span>
                      <span
                        className={cn(
                          "tabular-nums",
                          peak.netIfDrawn < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600",
                        )}
                      >
                        {peak.netIfDrawn < 0 ? "Loss" : "Still ahead"} {fmtGHS(Math.abs(peak.netIfDrawn))}
                      </span>
                    </div>
                    <CoverageBar coverage={peak.coverage} severity={peak.severity} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ---- Totals ---------------------------------------------------- */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Tile
              label="Taken"
              value={fmtGHS(exposure.poolStake)}
              hint={`${exposure.ticketCount} live ticket${exposure.ticketCount === 1 ? "" : "s"}`}
            />
            <Tile
              label="Peak liability"
              value={fmtGHS(exposure.peakLiability)}
              hint="Worst single combination"
              tone="danger"
            />
            <Tile
              label="Lines at risk"
              value={String(exposure.atRiskCount)}
              hint="High or critical"
              tone={exposure.atRiskCount > 0 ? "warning" : "good"}
            />
            <Tile
              label="Hedge to cover"
              value={fmtGHS(exposure.hedgeToCover)}
              hint="Stake at NLA on every at-risk line"
            />
            <Tile
              label="Watch-list book"
              value={fmtGHS(exposure.watchListLiability)}
              hint={`${exposure.watchList.length} red-flag writer${exposure.watchList.length === 1 ? "" : "s"}`}
              tone={exposure.watchListLiability > 0 ? "warning" : "neutral"}
            />
          </div>

          {/* ---- Combinations + heat map ----------------------------------- */}
          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                <div>
                  <CardTitle className="text-base">Exposure by combination</CardTitle>
                  <CardDescription className="text-xs">
                    {focusNumber
                      ? `Lines containing ${focusNumber}.`
                      : "Ranked by what we owe if the numbers come up."}
                  </CardDescription>
                </div>
                {focusNumber != null && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setFocusNumber(null)}>
                    Clear filter
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">#</TableHead>
                        <TableHead>Numbers</TableHead>
                        <TableHead className="text-right">Tickets</TableHead>
                        <TableHead className="text-right">Taken</TableHead>
                        <TableHead className="text-right">We pay</TableHead>
                        <TableHead className="w-32">Of pool</TableHead>
                        <TableHead className="text-right">Hedge</TableHead>
                        <TableHead>Risk</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleCombinations.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="py-8 text-center text-xs text-muted-foreground">
                            Nothing staked on {focusNumber}.
                          </TableCell>
                        </TableRow>
                      ) : (
                        visibleCombinations.map((c, i) => (
                          <TableRow key={c.key} className={c.severity === "critical" ? "bg-red-500/[0.04]" : undefined}>
                            <TableCell className="text-xs font-bold tabular-nums text-muted-foreground">
                              {i + 1}
                            </TableCell>
                            <TableCell>
                              <NumberChips numbers={c.numbers} highlight={focusNumber} />
                              <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                <span className="font-semibold uppercase tracking-wide">{c.betTypeCode}</span>
                                <span>×{c.multiplier}</span>
                                {c.redFlagTicketCount > 0 && (
                                  <span className="inline-flex items-center gap-0.5 font-bold text-red-600 dark:text-red-400">
                                    <Flag className="h-2.5 w-2.5" />
                                    {c.redFlagTicketCount}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right text-xs tabular-nums">
                              {c.ticketCount}
                              <div className="text-[10px] text-muted-foreground">
                                {c.writerCount} writer{c.writerCount === 1 ? "" : "s"}
                              </div>
                            </TableCell>
                            <TableCell className="text-right text-xs tabular-nums">{fmtGHS(c.totalStake)}</TableCell>
                            <TableCell className="text-right text-xs font-bold tabular-nums text-red-600 dark:text-red-400">
                              {fmtGHS(c.liability)}
                            </TableCell>
                            <TableCell>
                              <CoverageBar coverage={c.coverage} severity={c.severity} />
                            </TableCell>
                            <TableCell className="text-right text-xs font-semibold tabular-nums">
                              {fmtGHS(c.hedgeStake)}
                            </TableCell>
                            <TableCell>
                              <SeverityBadge severity={c.severity} />
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
                <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  <Landmark className="mt-px h-3 w-3 shrink-0" />
                  Hedge is what to stake at the NLA on the same numbers for their payout to
                  match ours, at the odds we pay. Where the NLA pays different odds, scale it.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Number heat</CardTitle>
                <CardDescription className="text-xs">
                  Exposure carried by each number. Tap one to see the lines it sits in.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <NumberHeatMap heat={exposure.numberHeat} selected={focusNumber} onSelect={setFocusNumber} />
                <HeatLegend />
              </CardContent>
            </Card>
          </div>

          {/* ---- Watch list ------------------------------------------------ */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Flag className="h-4 w-4 text-red-500" />
                Red-flag writers
              </CardTitle>
              <CardDescription className="text-xs">
                Writers whose volume moves our exposure on its own. Tag them under Users &amp;
                Agents when issuing a PIN; their book stays visible here on every game.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {exposure.watchList.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  No writers tagged yet.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Writer</TableHead>
                        <TableHead>Why flagged</TableHead>
                        <TableHead className="text-right">Tickets</TableHead>
                        <TableHead className="text-right">Taken</TableHead>
                        <TableHead className="text-right">We pay</TableHead>
                        <TableHead className="text-right">Share</TableHead>
                        <TableHead>Biggest line</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {exposure.watchList.map((w) => (
                        <TableRow key={w.writerId}>
                          <TableCell>
                            <div className="text-xs font-semibold">{w.fullName}</div>
                            <div className="font-mono text-[10px] text-muted-foreground">
                              {w.fullCode} · {w.agencyName ?? w.agentCode}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[220px] text-[11px] text-muted-foreground">
                            {w.reason || "—"}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{w.ticketCount}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{fmtGHS(w.totalStake)}</TableCell>
                          <TableCell className="text-right text-xs font-bold tabular-nums text-red-600 dark:text-red-400">
                            {fmtGHS(w.liability)}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                            {(w.shareOfLiability * 100).toFixed(1)}%
                          </TableCell>
                          <TableCell>
                            {w.topCombination ? (
                              <div className="flex items-center gap-2">
                                <NumberChips numbers={w.topCombination.numbers} highlight={focusNumber} />
                                <span className="text-[10px] font-semibold text-muted-foreground">
                                  {fmtGHS(w.topCombination.liability)}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">No live tickets</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* ---- Alerts ------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
            Logged alerts
          </CardTitle>
          <CardDescription className="text-xs">
            Incidents raised for review — frequent combinations, velocity, and suspicious patterns.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Writer</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {flagsLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-6 text-center text-xs text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : !flags?.length ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-6 text-center text-xs text-muted-foreground">
                      No alerts logged.
                    </TableCell>
                  </TableRow>
                ) : (
                  flags.map((row: any) => (
                    <TableRow key={row.flag.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {format(new Date(row.flag.createdAt), "MMM d, h:mm a")}
                      </TableCell>
                      <TableCell>
                        <div className="text-xs font-medium">{row.writer?.fullName || "System"}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{row.writer?.fullCode}</div>
                      </TableCell>
                      <TableCell className="text-xs capitalize">{row.flag.flagType.replace(/_/g, " ")}</TableCell>
                      <TableCell>
                        <SeverityBadge severity={row.flag.severity as Severity} />
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate text-xs" title={row.flag.description}>
                        {row.flag.description}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={row.flag.status}
                          onValueChange={(val) => updateMutation.mutate({ id: row.flag.id, status: val })}
                        >
                          <SelectTrigger className="h-8 w-[120px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="open">Open</SelectItem>
                            <SelectItem value="reviewed">Reviewed</SelectItem>
                            <SelectItem value="dismissed">Dismissed</SelectItem>
                            <SelectItem value="escalated">Escalated</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-emerald-600"
                            onClick={() => updateMutation.mutate({ id: row.flag.id, status: "reviewed" })}
                            title="Mark reviewed"
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-muted-foreground"
                            onClick={() => updateMutation.mutate({ id: row.flag.id, status: "dismissed" })}
                            title="Dismiss"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
