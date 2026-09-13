import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Radio } from "lucide-react";
import { fmtGHS } from "@/lib/utils";

/** Every live view polls on the same cadence so figures agree across screens. */
export const LIVE_REFETCH_MS = 15_000;

export interface LiveGame {
  id: string;
  name: string;
  eventNumber: string;
  status: "offline" | "live" | "closed";
  goLiveAt: string;
  closeAt: string;
}

interface Totals {
  ticketCount: number;
  totalStakes: string;
  winningTickets: number;
  totalWins: string;
}

interface LiveSalesResponse {
  game: { id: string; name: string; status: string };
  scope: string;
  totals: Totals;
  breakdown: Array<Record<string, unknown>>;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem("accessToken")}` };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error((await res.json().catch(() => ({}))).error || "Request failed");
  }
  return res.json();
}

/**
 * Games currently worth showing. When exactly one is running the caller
 * shouldn't ask the user to choose - `useLiveGames` auto-selects it.
 */
export function useLiveGames(selectedId: string | null, onSelect: (id: string) => void) {
  const query = useQuery<LiveGame[]>({
    queryKey: ["/api/live-sales/games"],
    queryFn: () => getJson<LiveGame[]>("/api/live-sales/games"),
    refetchInterval: LIVE_REFETCH_MS,
  });

  const games = useMemo(() => query.data ?? [], [query.data]);

  useEffect(() => {
    if (games.length === 0) return;
    // Auto-select the only game, or recover if the selected one has ended.
    if (!selectedId || !games.some((g) => g.id === selectedId)) {
      const live = games.find((g) => g.status === "live");
      onSelect((live ?? games[0]).id);
    }
  }, [games, selectedId, onSelect]);

  return { games, isLoading: query.isLoading };
}

export function GamePicker({
  games,
  selectedId,
  onSelect,
}: {
  games: LiveGame[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  // One game running: name it, don't make anyone choose.
  if (games.length <= 1) {
    const only = games[0];
    return only ? (
      <Badge variant="outline" className="font-medium">
        {only.name}
        <span className="ml-1.5 text-muted-foreground">{only.eventNumber}</span>
      </Badge>
    ) : null;
  }

  return (
    <Select value={selectedId ?? undefined} onValueChange={onSelect}>
      <SelectTrigger className="w-[220px] h-9">
        <SelectValue placeholder="Select a game" />
      </SelectTrigger>
      <SelectContent>
        {games.map((g) => (
          <SelectItem key={g.id} value={g.id}>
            {g.name} · {g.eventNumber}
            {g.status === "closed" ? " (closed)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold tracking-tight tabular-nums mt-1">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

/**
 * Live figures for one game, scoped server-side to what the viewer may see:
 * everything for directors/administrators, own writers for an agent, own
 * tickets for a writer.
 */
export function LiveSalesPanel({
  selectedGameId,
  games,
  onSelect,
  title = "Live Sales",
}: {
  selectedGameId: string | null;
  games: LiveGame[];
  onSelect: (id: string) => void;
  title?: string;
}) {
  const { data, isLoading, isError, error, isFetching } = useQuery<LiveSalesResponse>({
    queryKey: ["/api/live-sales", selectedGameId],
    queryFn: () => getJson<LiveSalesResponse>(`/api/live-sales?gameId=${encodeURIComponent(selectedGameId!)}`),
    enabled: !!selectedGameId,
    refetchInterval: LIVE_REFETCH_MS,
  });

  const totals = data?.totals;
  const net =
    totals !== undefined
      ? (Number(totals.totalStakes) - Number(totals.totalWins)).toString()
      : "0";

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Radio className={`h-4 w-4 ${isFetching ? "text-emerald-500 animate-pulse" : "text-muted-foreground"}`} />
            {title}
          </CardTitle>
          <CardDescription>
            Updates every {LIVE_REFETCH_MS / 1000}s from tickets as writers place them.
          </CardDescription>
        </div>
        <GamePicker games={games} selectedId={selectedGameId} onSelect={onSelect} />
      </CardHeader>
      <CardContent className="space-y-4">
        {games.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No game is live right now.
          </p>
        ) : isLoading ? (
          <div className="py-8 text-center">
            <Loader2 className="h-4 w-4 animate-spin inline" />
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive py-6 text-center">{(error as Error).message}</p>
        ) : (
          <>
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <Tile label="Tickets" value={String(totals?.ticketCount ?? 0)} />
              <Tile label="Stakes" value={fmtGHS(totals?.totalStakes ?? 0)} />
              <Tile
                label="Wins"
                value={fmtGHS(totals?.totalWins ?? 0)}
                hint={`${totals?.winningTickets ?? 0} winning ticket${totals?.winningTickets === 1 ? "" : "s"}`}
              />
              <Tile label="Net" value={fmtGHS(net)} hint="Stakes less wins" />
            </div>

            {Array.isArray(data?.breakdown) && data.breakdown.length > 0 && (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{data.scope === "agent" ? "Writer" : "Agent"}</TableHead>
                      <TableHead className="text-right">Tickets</TableHead>
                      <TableHead className="text-right">Stakes</TableHead>
                      <TableHead className="text-right">Wins</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.breakdown.map((row, i) => {
                      const r = row as Record<string, string | number | null>;
                      const name = (r["writerName"] ?? r["agentName"] ?? "—") as string;
                      const code = (r["writerCode"] ?? r["agentCode"] ?? "") as string;
                      return (
                        <TableRow key={(r["writerId"] ?? r["agentId"] ?? i) as string}>
                          <TableCell className="font-medium">
                            {name}
                            {code && <span className="block text-xs font-mono text-muted-foreground">{code}</span>}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{r["ticketCount"]}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtGHS(r["totalStakes"] ?? 0)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtGHS(r["totalWins"] ?? 0)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Convenience wrapper: owns the selection state for a simple dashboard drop-in. */
export function LiveSalesSection({ title }: { title?: string }) {
  const [selectedGameId, setSelectedGameId] = useLiveGameSelection();
  const { games } = useLiveGames(selectedGameId, setSelectedGameId);
  return (
    <LiveSalesPanel
      selectedGameId={selectedGameId}
      games={games}
      onSelect={setSelectedGameId}
      title={title}
    />
  );
}


/** Selection is per-screen; the auto-select effect fills it in. */
export function useLiveGameSelection(): [string | null, (id: string) => void] {
  const [id, setId] = useState<string | null>(null);
  const select = useCallback((next: string) => setId(next), []);
  return [id, select];
}
