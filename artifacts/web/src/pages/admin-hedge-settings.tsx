import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Landmark, ShieldCheck, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fmtGHS, cn } from "@/lib/utils";

/**
 * Hedge thresholds.
 *
 * Risk Management ranks combinations by what we would owe if they were drawn.
 * Which of those counts as "huge" is a commercial judgement, so it is set
 * here rather than fixed in code: a cash ceiling on a single payout, the
 * share of the pool at which a line turns serious, and how much of a
 * liability to lay off at the NLA when we do hedge.
 */

interface Policy {
  hugeWinThreshold: number;
  mediumCoveragePct: number;
  highCoveragePct: number;
  criticalCoveragePct: number;
  hedgeCoveragePct: number;
  minHedgeStake: number;
  hedgeHighCoverage: boolean;
  capsByBetType: Record<string, number>;
}

interface BetTypeRow {
  id: string;
  name: string;
  code: string;
  multiplier: number;
  isActive: boolean;
  maxLiability: number | null;
}

interface HedgeResponse {
  policy: Policy;
  betTypes: BetTypeRow[];
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem("accessToken")}` };
}

const pct = (fraction: number) => String(Number((fraction * 100).toFixed(2)));
const toFraction = (input: string) => Number(input) / 100;

export function AdminHedgeSettings() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<HedgeResponse>({
    queryKey: ["/api/settings/hedge"],
    queryFn: async () => {
      const res = await fetch("/api/settings/hedge", { headers: authHeaders() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load");
      return res.json();
    },
  });

  const [form, setForm] = useState({
    hugeWinThreshold: "10000",
    mediumCoveragePct: "25",
    highCoveragePct: "50",
    criticalCoveragePct: "100",
    hedgeCoveragePct: "100",
    minHedgeStake: "0",
    hedgeHighCoverage: true,
  });
  const [caps, setCaps] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!data) return;
    const p = data.policy;
    setForm({
      hugeWinThreshold: String(p.hugeWinThreshold),
      mediumCoveragePct: pct(p.mediumCoveragePct),
      highCoveragePct: pct(p.highCoveragePct),
      criticalCoveragePct: pct(p.criticalCoveragePct),
      hedgeCoveragePct: pct(p.hedgeCoveragePct),
      minHedgeStake: String(p.minHedgeStake),
      hedgeHighCoverage: p.hedgeHighCoverage,
    });
    setCaps(
      Object.fromEntries(data.betTypes.map((b) => [b.id, b.maxLiability != null ? String(b.maxLiability) : ""])),
    );
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings/hedge", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          hugeWinThreshold: Number(form.hugeWinThreshold),
          mediumCoveragePct: toFraction(form.mediumCoveragePct),
          highCoveragePct: toFraction(form.highCoveragePct),
          criticalCoveragePct: toFraction(form.criticalCoveragePct),
          hedgeCoveragePct: toFraction(form.hedgeCoveragePct),
          minHedgeStake: Number(form.minHedgeStake),
          hedgeHighCoverage: form.hedgeHighCoverage,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not save");
      return body;
    },
    onSuccess: () => {
      toast({ title: "Thresholds saved", description: "Risk Management now judges lines against these." });
      qc.invalidateQueries({ queryKey: ["/api/settings/hedge"] });
      qc.invalidateQueries({ queryKey: ["/api/risk/exposure"] });
    },
    onError: (e: Error) => toast({ title: "Not saved", description: e.message, variant: "destructive" }),
  });

  const saveCap = useMutation({
    mutationFn: async ({ betTypeId, value }: { betTypeId: string; value: string }) => {
      const trimmed = value.trim();
      const res = await fetch(`/api/settings/hedge/caps/${betTypeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ maxLiability: trimmed === "" ? null : Number(trimmed) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not save the ceiling");
      return body;
    },
    onSuccess: () => {
      toast({ title: "Ceiling updated" });
      qc.invalidateQueries({ queryKey: ["/api/settings/hedge"] });
      qc.invalidateQueries({ queryKey: ["/api/risk/exposure"] });
    },
    onError: (e: Error) => toast({ title: "Not saved", description: e.message, variant: "destructive" }),
  });

  // A worked example keeps the numbers concrete: the smallest stake on each
  // bet type that would breach its ceiling, and what covering it would cost.
  const worked = useMemo(() => {
    const rows = data?.betTypes.filter((b) => b.isActive && b.multiplier > 0) ?? [];
    const globalCeiling = Number(form.hugeWinThreshold) || 0;
    const cover = toFraction(form.hedgeCoveragePct);
    return rows.map((b) => {
      const capRaw = caps[b.id]?.trim();
      const ceiling = capRaw ? Number(capRaw) : globalCeiling;
      const triggerStake = ceiling > 0 ? ceiling / b.multiplier : 0;
      return {
        ...b,
        ceiling,
        triggerStake,
        hedgeCost: (ceiling * cover) / b.multiplier,
        usesOwnCeiling: !!capRaw,
      };
    });
  }, [data, form.hugeWinThreshold, form.hedgeCoveragePct, caps]);

  const bandsValid =
    Number(form.mediumCoveragePct) <= Number(form.highCoveragePct) &&
    Number(form.highCoveragePct) <= Number(form.criticalCoveragePct);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border bg-card p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading thresholds…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* ---- What counts as huge ---------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Landmark className="h-4 w-4" />
              What counts as a huge win
            </CardTitle>
            <CardDescription className="text-xs">
              A single combination whose payout reaches this is laid off at the NLA, however
              small a share of the pool it is.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Prize ceiling (GH₵)</Label>
              <Input
                type="number"
                min={0}
                step={100}
                value={form.hugeWinThreshold}
                onChange={(e) => setForm({ ...form, hugeWinThreshold: e.target.value })}
                className="h-10 font-mono"
              />
              <p className="text-[11px] text-muted-foreground">
                Applies to every bet type unless one has its own ceiling below.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Cover (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  value={form.hedgeCoveragePct}
                  onChange={(e) => setForm({ ...form, hedgeCoveragePct: e.target.value })}
                  className="h-10 font-mono"
                />
                <p className="text-[11px] text-muted-foreground">
                  Share of the liability to lay off. 100% recovers it in full.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Smallest hedge (GH₵)</Label>
                <Input
                  type="number"
                  min={0}
                  step={10}
                  value={form.minHedgeStake}
                  onChange={(e) => setForm({ ...form, minHedgeStake: e.target.value })}
                  className="h-10 font-mono"
                />
                <p className="text-[11px] text-muted-foreground">
                  Below this, a hedge isn't worth placing.
                </p>
              </div>
            </div>

            <div className="flex items-start justify-between gap-3 rounded-xl border p-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold">Also hedge on share of pool</div>
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  Flag a line that would eat a large share of the game's takings even when its
                  payout is under the ceiling.
                </p>
              </div>
              <Switch
                checked={form.hedgeHighCoverage}
                onCheckedChange={(v) => setForm({ ...form, hedgeHighCoverage: v })}
              />
            </div>
          </CardContent>
        </Card>

        {/* ---- Severity bands --------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" />
              Severity bands
            </CardTitle>
            <CardDescription className="text-xs">
              A line's rating is what share of everything taken on the game its payout would
              consume.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {(
                [
                  ["mediumCoveragePct", "Medium", "bg-amber-400"],
                  ["highCoveragePct", "High", "bg-orange-500"],
                  ["criticalCoveragePct", "Critical", "bg-red-500"],
                ] as const
              ).map(([field, label, dot]) => (
                <div key={field} className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-xs font-semibold">
                    <span className={cn("h-2 w-2 rounded-full", dot)} />
                    {label}
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    step={5}
                    value={form[field]}
                    onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                    className="h-10 font-mono"
                  />
                </div>
              ))}
            </div>

            <p className="flex items-start gap-1.5 rounded-lg bg-muted/50 p-3 text-[11px] leading-relaxed text-muted-foreground">
              <Info className="mt-px h-3 w-3 shrink-0" />
              At {form.criticalCoveragePct}% the payout on one combination equals everything taken
              on the game — the draw loses money however the rest of the book performs. That is why
              critical sits at 100% out of the box.
            </p>

            {!bandsValid && (
              <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-[11px] text-destructive">
                Bands must rise: medium can't exceed high, and high can't exceed critical.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button
          className="h-10 px-6 font-semibold"
          disabled={save.isPending || !bandsValid}
          onClick={() => save.mutate()}
        >
          {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save thresholds
        </Button>
      </div>

      {/* ---- Per bet type ------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ceilings by bet type</CardTitle>
          <CardDescription className="text-xs">
            Bet types pay at very different odds, so one cash figure across all of them is
            crude. A ceiling here replaces the global one for that bet type. Leave blank to use
            the global ceiling.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {worked.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No active bet types yet. Add them under the Bet Types tab.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bet type</TableHead>
                    <TableHead className="text-right">Odds</TableHead>
                    <TableHead className="w-44">Ceiling (GH₵)</TableHead>
                    <TableHead className="text-right">Triggered by a stake of</TableHead>
                    <TableHead className="text-right">Costs to cover</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {worked.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>
                        <div className="text-xs font-semibold">{b.name}</div>
                        <div className="font-mono text-[10px] uppercase text-muted-foreground">{b.code}</div>
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">×{b.multiplier}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          step={100}
                          placeholder={String(form.hugeWinThreshold)}
                          value={caps[b.id] ?? ""}
                          onChange={(e) => setCaps({ ...caps, [b.id]: e.target.value })}
                          className="h-9 font-mono text-xs"
                        />
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {fmtGHS(b.triggerStake)}
                        <div className="text-[10px] text-muted-foreground">
                          on one combination
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-xs font-semibold tabular-nums">
                        {fmtGHS(b.hedgeCost)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-[11px] font-bold"
                          disabled={saveCap.isPending}
                          onClick={() => saveCap.mutate({ betTypeId: b.id, value: caps[b.id] ?? "" })}
                        >
                          Save
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            "Triggered by a stake of" is the smallest amount on a single combination that reaches
            the ceiling at these odds — once total stakes on one line pass it, Risk Management
            marks the line for hedging.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
