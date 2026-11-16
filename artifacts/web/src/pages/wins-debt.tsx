import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useGetWinsDebtReport } from "@workspace/api-client-react";
import {
  Trophy, Landmark, Wallet, CheckCircle2, AlertTriangle, ScanLine, UserCheck, Hourglass,
  Send, BadgeCheck, Flag, Ban, Clock, ArrowRight, Users, Building2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { generateWinsDebtOverviewPDF } from "@/lib/pdf-generator";

/**
 * Wins & Debt Overview.
 *
 * Two sides of the same ledger on one page:
 *   - what the company owes on wins, by the channel the winning sale came
 *     through (POS prepaid, POS postpaid, manual agent entry), and where each
 *     POS win stands in the payout pipeline;
 *   - what is owed to the company: postpaid writers who have not handed in
 *     their takings, and agency balances.
 *
 * The period picker only scopes "Wins by channel". Everything else is the
 * position right now, because a debt or a waiting claim does not stop being
 * owed when the month turns.
 */

// ── Formatting ────────────────────────────────────────────────────────────────

const ghs = (v: string | number | null | undefined) => {
  const n = Number(v ?? 0);
  const s = Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(GH₵ ${s})` : `GH₵ ${s}`;
};
const agencyCount = (n: number) => `${n} agenc${n === 1 ? "y" : "ies"}`;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const todayStr = () => new Date().toISOString().slice(0, 10);
const firstOfMonth = () => `${todayStr().slice(0, 8)}01`;
const firstOfLastMonth = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); };
const lastOfLastMonth = () => { const d = new Date(); d.setUTCDate(0); return d.toISOString().slice(0, 10); };
const firstOfYear = () => `${todayStr().slice(0, 4)}-01-01`;
const fmtDay = (s: string | null | undefined) =>
  s ? new Date(`${s.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const authHeaders = (): Record<string, string> => {
  try {
    const token = localStorage.getItem("accessToken");
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
};

// ── Types ─────────────────────────────────────────────────────────────────────

type Amt = { count: number; amount: string };
export type WinsChannelRow = {
  channel: "prepaid" | "postpaid" | "manual";
  label: string;
  recorded: Amt;
  settled: Amt;
  inProgress: Amt;
  unclaimed: Amt | null;
  flagged: Amt | null;
  lost: Amt | null;
};
export type WinsDebtOverview = {
  period: { dateFrom: string | null; dateTo: string | null };
  validityDays: number;
  channels: WinsChannelRow[];
  pipeline: Record<"missing" | "unclaimed" | "expired" | "verified" | "awaiting_funds" | "processing" | "paid" | "rejected" | "withheld" | "expiringSoon", Amt>;
  posOwed: Amt;
  postpaid: {
    outstanding: string; outstandingDraws: number;
    overdue: string; overdueDraws: number;
    notYetDue: string; writersOwing: number;
    aging: { days0to1: string; days2to7: string; days8to30: string; over30: string };
    topDebtors: Array<{ writerId: string; writerCode: string; writerName: string; agentCode: string; agencyName: string | null; owed: string; overdue: boolean; oldest: string; draws: number }>;
  };
  agencies: {
    owedByAgencies: string; owedToAgencies: string;
    list: Array<{ agentId: string; agentCode: string; agencyName: string | null; balance: string; debtSince: string | null; status: string }>;
  };
  wallet: { available: string; held: string; awaitingFunds: string; shortfall: string; present: boolean };
};

const CHANNEL_DOT: Record<WinsChannelRow["channel"], string> = {
  prepaid: "bg-sky-500",
  postpaid: "bg-amber-500",
  manual: "bg-violet-500",
};

const URGENCY_CFG = {
  ok: { label: "Fresh", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30", dot: "bg-emerald-500" },
  warning: { label: "Overdue", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30", dot: "bg-amber-500" },
  critical: { label: "Critical", cls: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30", dot: "bg-rose-600" },
};
const CLEARED_CFG = {
  agent_net: { label: "Agent Net", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" },
  reserve: { label: "Reserve Fund", cls: "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/30" },
  deficit: { label: "Still Deficit", cls: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30" },
};

// ── Building blocks ───────────────────────────────────────────────────────────

function Section({ accent, title, subtitle, right, children }: {
  accent: string; title: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="border border-border/80 bg-card rounded-3xl p-5 sm:p-6 shadow-sm space-y-5 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-2.5 h-6 rounded-full shrink-0 ${accent}`} />
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-bold text-foreground">{title}</h2>
            {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function Headline({ label, value, sub, edge, text, icon }: {
  label: string; value: string; sub: React.ReactNode; edge: string; text: string; icon: React.ReactNode;
}) {
  return (
    <div className={`bg-card border border-border border-l-4 ${edge} rounded-2xl p-4 shadow-sm flex flex-col justify-between min-h-[7.5rem] min-w-0`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] text-muted-foreground uppercase font-black tracking-wider">{label}</div>
        <div className="text-muted-foreground/70 shrink-0">{icon}</div>
      </div>
      <div className={`font-mono text-xl sm:text-2xl font-black tracking-tight mt-1 truncate ${text}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground font-medium mt-1">{sub}</div>
    </div>
  );
}

function AmtCell({ v, tone = "" }: { v: Amt | null; tone?: string }) {
  if (!v) return <TableCell className="text-right text-muted-foreground/60 text-xs">n/a</TableCell>;
  return (
    <TableCell className="text-right whitespace-nowrap">
      <div className={`font-mono text-sm ${Number(v.amount) === 0 ? "text-muted-foreground" : tone}`}>{ghs(v.amount)}</div>
      <div className="text-[10px] text-muted-foreground">{v.count.toLocaleString()}</div>
    </TableCell>
  );
}

function MiniBar({ parts }: { parts: Array<{ value: number; cls: string; label: string }> }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total <= 0) return <div className="h-1.5 rounded-full bg-muted" />;
  return (
    <div className="flex h-1.5 rounded-full overflow-hidden bg-muted"
      title={parts.filter(p => p.value > 0).map(p => `${p.label} ${pct(p.value, total)}%`).join(" · ")}>
      {parts.map(p => p.value > 0 && <div key={p.label} className={p.cls} style={{ width: `${(p.value / total) * 100}%` }} />)}
    </div>
  );
}

function Stage({ icon, label, v, note, tone, href }: {
  icon: React.ReactNode; label: string; v: Amt; note?: string; tone: string; href?: string;
}) {
  const body = (
    <div className={`h-full rounded-2xl border bg-card/40 p-3.5 transition-colors ${href ? "hover:bg-muted/40 cursor-pointer" : ""}`}>
      <div className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider ${tone}`}>{icon}{label}</div>
      <div className="font-mono text-lg font-black mt-1.5">{ghs(v.amount)}</div>
      <div className="text-[10px] text-muted-foreground">{v.count.toLocaleString()} ticket{v.count === 1 ? "" : "s"}{note ? ` · ${note}` : ""}</div>
    </div>
  );
  return href ? <Link href={href} className="block min-w-0">{body}</Link> : <div className="min-w-0">{body}</div>;
}

function AgingRow({ label, amount, total, cls }: { label: string; amount: string; total: number; cls: string }) {
  const n = Number(amount);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground font-medium">{label}</span>
        <span className="font-mono font-semibold">{ghs(amount)}</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${cls}`} style={{ width: `${Math.max(pct(n, total), n > 0 ? 2 : 0)}%` }} />
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function WinsDebt() {
  const [dateFrom, setDateFrom] = useState(firstOfMonth());
  const [dateTo, setDateTo] = useState(todayStr());
  const [queueFilter, setQueueFilter] = useState<"all" | "ok" | "warning" | "critical">("all");

  const { data: o, isLoading, error } = useQuery<WinsDebtOverview>({
    queryKey: ["wins-debt-overview", dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const res = await fetch(`/api/reports/wins-debt-overview?${params}`, { headers: authHeaders() });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      return body;
    },
    refetchInterval: 60_000,
  });
  // Manual wins keep their own deeper analysis (reserve cover, FIFO queue).
  const { data: manual } = useGetWinsDebtReport();

  const filteredQueue = useMemo(() => {
    const q = manual?.queue ?? [];
    return queueFilter === "all" ? q : q.filter(x => x.urgency === queueFilter);
  }, [manual?.queue, queueFilter]);

  const shortcuts = [
    { label: "This Month", from: firstOfMonth(), to: todayStr() },
    { label: "Last Month", from: firstOfLastMonth(), to: lastOfLastMonth() },
    { label: "This Year", from: firstOfYear(), to: todayStr() },
    { label: "All Time", from: "", to: "" },
  ];

  // Headline arithmetic, all in pesewas.
  const p = (v: string | undefined | null) => Math.round(Number(v ?? 0) * 100);
  const manualPending = p(manual?.summary.totalPending);
  const manualDeficit = p(manual?.summary.remainingDeficit);
  const owedOnWins = o ? p(o.posOwed.amount) + manualPending + manualDeficit : 0;
  const owedToCompany = o ? p(o.postpaid.outstanding) + p(o.agencies.owedByAgencies) : 0;
  const totals = useMemo(() => {
    const t = { recorded: 0, recordedN: 0, settled: 0, settledN: 0, inProgress: 0, inProgressN: 0, unclaimed: 0, unclaimedN: 0, flagged: 0, flaggedN: 0, lost: 0, lostN: 0 };
    for (const c of o?.channels ?? []) {
      t.recorded += p(c.recorded.amount); t.recordedN += c.recorded.count;
      t.settled += p(c.settled.amount); t.settledN += c.settled.count;
      t.inProgress += p(c.inProgress.amount); t.inProgressN += c.inProgress.count;
      if (c.unclaimed) { t.unclaimed += p(c.unclaimed.amount); t.unclaimedN += c.unclaimed.count; }
      if (c.flagged) { t.flagged += p(c.flagged.amount); t.flaggedN += c.flagged.count; }
      if (c.lost) { t.lost += p(c.lost.amount); t.lostN += c.lost.count; }
    }
    return t;
  }, [o]);
  const c2 = (n: number) => (n / 100).toFixed(2);
  const periodLabel = dateFrom || dateTo ? `${fmtDay(dateFrom)} – ${fmtDay(dateTo || todayStr())}` : "All time";

  const exportPdf = () => {
    if (!o) return;
    generateWinsDebtOverviewPDF({
      periodLabel,
      overview: o,
      headline: {
        owedOnWins: c2(owedOnWins),
        owedToCompany: c2(owedToCompany),
        manualPending: c2(manualPending),
        manualDeficit: c2(manualDeficit),
      },
      totals: {
        recorded: { count: totals.recordedN, amount: c2(totals.recorded) },
        settled: { count: totals.settledN, amount: c2(totals.settled) },
        inProgress: { count: totals.inProgressN, amount: c2(totals.inProgress) },
        unclaimed: { count: totals.unclaimedN, amount: c2(totals.unclaimed) },
        flagged: { count: totals.flaggedN, amount: c2(totals.flagged) },
        lost: { count: totals.lostN, amount: c2(totals.lost) },
      },
    });
  };

  const agingTotal = o
    ? Number(o.postpaid.aging.days0to1) + Number(o.postpaid.aging.days2to7) + Number(o.postpaid.aging.days8to30) + Number(o.postpaid.aging.over30)
    : 0;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground">Wins &amp; Debt Overview</h1>
          <p className="text-xs text-muted-foreground mt-1 font-medium max-w-2xl">
            What the company owes on wins across POS prepaid, POS postpaid and manual agent entries, and what writers
            and agencies owe the company — in one place.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Wins from</Label>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 w-[150px] text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">To</Label>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-9 w-[150px] text-sm" />
          </div>
          <Button onClick={exportPdf} disabled={!o} size="sm" className="h-9 bg-[#ff6700] hover:bg-[#ff6700]/90 text-white font-semibold">
            Export PDF
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 -mt-3">
        {shortcuts.map(s => {
          const on = s.from === dateFrom && s.to === dateTo;
          return (
            <button key={s.label} onClick={() => { setDateFrom(s.from); setDateTo(s.to); }}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${on ? "bg-foreground text-background border-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              {s.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-700 dark:text-rose-400">
          {(error as Error).message || "Could not load the overview."}
        </div>
      )}

      {/* ── Headlines ── */}
      {isLoading || !o ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-[7.5rem] rounded-2xl" />)}</div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Headline
            label="Owed on wins"
            value={ghs(c2(owedOnWins))}
            sub={<>POS {ghs(o.posOwed.amount)} · Manual {ghs(c2(manualPending + manualDeficit))}</>}
            edge="border-l-rose-500" text="text-rose-600 dark:text-rose-400" icon={<Trophy className="w-4 h-4" />}
          />
          <Headline
            label="Owed to the company"
            value={ghs(c2(owedToCompany))}
            sub={<>Postpaid {ghs(o.postpaid.outstanding)} · Agencies {ghs(o.agencies.owedByAgencies)}</>}
            edge="border-l-amber-500" text="text-amber-600 dark:text-amber-400" icon={<Landmark className="w-4 h-4" />}
          />
          <Headline
            label="Master Wallet cover"
            value={ghs(o.wallet.available)}
            sub={Number(o.wallet.shortfall) > 0
              ? <span className="text-rose-600 dark:text-rose-400 font-semibold">Short {ghs(o.wallet.shortfall)} for claims awaiting funds</span>
              : <>Available · {ghs(o.wallet.held)} held for claims</>}
            edge="border-l-indigo-500" text="text-indigo-600 dark:text-indigo-400" icon={<Wallet className="w-4 h-4" />}
          />
          <Headline
            label="Wins settled in period"
            value={`${pct(totals.settled, totals.recorded)}%`}
            sub={<>{ghs(c2(totals.settled))} of {ghs(c2(totals.recorded))} won</>}
            edge="border-l-emerald-500" text="text-emerald-600 dark:text-emerald-400" icon={<CheckCircle2 className="w-4 h-4" />}
          />
        </div>
      )}

      {/* ── Wins by channel ── */}
      <Section accent="bg-emerald-500" title="Wins by sales channel"
        subtitle={`Winning sales in ${periodLabel.toLowerCase() === "all time" ? "all time" : periodLabel} — tickets by draw date, manual wins by entry date`}>
        {!o ? <Skeleton className="h-40 rounded-2xl" /> : (
          <div className="overflow-x-auto -mx-1">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs">Channel</TableHead>
                  <TableHead className="text-right text-xs">Won</TableHead>
                  <TableHead className="text-right text-xs">Settled / paid</TableHead>
                  <TableHead className="text-right text-xs">In progress</TableHead>
                  <TableHead className="text-right text-xs">Unclaimed</TableHead>
                  <TableHead className="text-right text-xs">Flagged</TableHead>
                  <TableHead className="text-right text-xs whitespace-nowrap">Expired / withheld</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {o.channels.map(c => (
                  <TableRow key={c.channel}>
                    <TableCell className="min-w-[170px]">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <span className={`w-2 h-2 rounded-full ${CHANNEL_DOT[c.channel]}`} />{c.label}
                      </div>
                      <div className="mt-1.5 w-32">
                        <MiniBar parts={[
                          { label: "Settled", value: Number(c.settled.amount), cls: "bg-emerald-500" },
                          { label: "In progress", value: Number(c.inProgress.amount), cls: "bg-indigo-500" },
                          { label: "Unclaimed", value: Number(c.unclaimed?.amount ?? 0), cls: "bg-amber-400" },
                          { label: "Flagged", value: Number(c.flagged?.amount ?? 0), cls: "bg-rose-500" },
                          { label: "Expired / withheld", value: Number(c.lost?.amount ?? 0), cls: "bg-slate-400" },
                        ]} />
                      </div>
                      {c.channel === "manual" && <div className="text-[10px] text-muted-foreground mt-1">Settled = calculated in Run Draws</div>}
                    </TableCell>
                    <AmtCell v={c.recorded} tone="font-bold" />
                    <AmtCell v={c.settled} tone="text-emerald-700 dark:text-emerald-400" />
                    <AmtCell v={c.inProgress} tone="text-indigo-700 dark:text-indigo-400" />
                    <AmtCell v={c.unclaimed} tone="text-amber-700 dark:text-amber-400" />
                    <AmtCell v={c.flagged} tone="text-rose-700 dark:text-rose-400" />
                    <AmtCell v={c.lost} tone="text-slate-600 dark:text-slate-300" />
                  </TableRow>
                ))}
              </TableBody>
              <tfoot>
                <tr className="border-t-2 bg-muted/30 text-sm">
                  <td className="px-4 py-2.5 text-xs font-bold uppercase text-muted-foreground">Total</td>
                  {[
                    [totals.recorded, totals.recordedN], [totals.settled, totals.settledN], [totals.inProgress, totals.inProgressN],
                    [totals.unclaimed, totals.unclaimedN], [totals.flagged, totals.flaggedN], [totals.lost, totals.lostN],
                  ].map(([a, n], i) => (
                    <td key={i} className="px-4 py-2.5 text-right whitespace-nowrap">
                      <div className="font-mono font-bold">{ghs(c2(a!))}</div>
                      <div className="text-[10px] text-muted-foreground">{n!.toLocaleString()}</div>
                    </td>
                  ))}
                </tr>
              </tfoot>
            </Table>
          </div>
        )}
      </Section>

      {/* ── POS payout pipeline ── */}
      <Section accent="bg-indigo-500" title="POS wins payout pipeline"
        subtitle={`Every winning portal ticket not yet settled, as of now. Tickets can be claimed for ${o?.validityDays ?? 15} days after the draw.`}
        right={
          <div className="flex flex-wrap gap-2">
            <Link href="/pos-wins-payment" className="text-[11px] font-semibold text-primary hover:underline inline-flex items-center gap-1">POS Wins Payment <ArrowRight className="w-3 h-3" /></Link>
            <Link href="/ticket-lookup?tab=flagged" className="text-[11px] font-semibold text-primary hover:underline inline-flex items-center gap-1">Flagged tickets <ArrowRight className="w-3 h-3" /></Link>
          </div>
        }>
        {!o ? <Skeleton className="h-28 rounded-2xl" /> : (
          <div className="space-y-4">
            {o.pipeline.missing.count > 0 && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-2.5 text-xs text-rose-700 dark:text-rose-400 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {o.pipeline.missing.count} winning ticket{o.pipeline.missing.count === 1 ? " has" : "s have"} no payout record ({ghs(o.pipeline.missing.amount)}). They cannot be claimed until the draw's settlement is re-run.
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Stage icon={<ScanLine className="w-3.5 h-3.5" />} label="Unclaimed" v={o.pipeline.unclaimed} tone="text-amber-600 dark:text-amber-400"
                note={o.pipeline.expiringSoon.count > 0 ? `${o.pipeline.expiringSoon.count} expire within 3 days` : "waiting for a scan"} />
              <Stage icon={<UserCheck className="w-3.5 h-3.5" />} label="With cashier" v={o.pipeline.verified} tone="text-blue-600 dark:text-blue-400" note="verified, funds held" href="/pos-wins-payment" />
              <Stage icon={<Hourglass className="w-3.5 h-3.5" />} label="Awaiting funds" v={o.pipeline.awaiting_funds} tone="text-orange-600 dark:text-orange-400" note="wallet too low" href="/master-wallet" />
              <Stage icon={<Send className="w-3.5 h-3.5" />} label="Transfer sent" v={o.pipeline.processing} tone="text-indigo-600 dark:text-indigo-400" note="with Paystack" href="/pos-wins-payment" />
              <Stage icon={<BadgeCheck className="w-3.5 h-3.5" />} label="Paid" v={o.pipeline.paid} tone="text-emerald-600 dark:text-emerald-400" note="all time" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Stage icon={<Flag className="w-3.5 h-3.5" />} label="Flagged by cashier" v={o.pipeline.rejected} tone="text-rose-600 dark:text-rose-400" note="admin to resolve" href="/ticket-lookup?tab=flagged" />
              <Stage icon={<Ban className="w-3.5 h-3.5" />} label="Withheld" v={o.pipeline.withheld} tone="text-slate-600 dark:text-slate-300" note="not payable" />
              <Stage icon={<Clock className="w-3.5 h-3.5" />} label="Expired unclaimed" v={o.pipeline.expired} tone="text-slate-600 dark:text-slate-300" note="past the claim window" />
            </div>
          </div>
        )}
      </Section>

      {/* ── Debts owed to the company ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Section accent="bg-amber-500" title="Postpaid writer debt"
          subtitle="Takings postpaid writers still have to hand in, from the postpaid ledger"
          right={<Link href="/payments" className="text-[11px] font-semibold text-primary hover:underline inline-flex items-center gap-1">Settle postpaid <ArrowRight className="w-3 h-3" /></Link>}>
          {!o ? <Skeleton className="h-48 rounded-2xl" /> : (
            <div className="space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Outstanding", value: o.postpaid.outstanding, sub: `${o.postpaid.outstandingDraws} draw${o.postpaid.outstandingDraws === 1 ? "" : "s"}`, cls: "text-amber-600 dark:text-amber-400" },
                  { label: "Overdue", value: o.postpaid.overdue, sub: "past Run Draws, unpaid", cls: Number(o.postpaid.overdue) > 0 ? "text-rose-600 dark:text-rose-400" : "" },
                  { label: "Not yet due", value: o.postpaid.notYetDue, sub: "betting still open", cls: "text-muted-foreground" },
                  { label: "Writers owing", value: String(o.postpaid.writersOwing), sub: "with a balance", cls: "", raw: true },
                ].map(x => (
                  <div key={x.label} className="rounded-xl border bg-card/40 p-3 min-w-0">
                    <div className="text-[10px] uppercase font-black tracking-wider text-muted-foreground">{x.label}</div>
                    <div className={`font-mono text-base font-black mt-1 truncate ${x.cls}`}>{x.raw ? x.value : ghs(x.value)}</div>
                    <div className="text-[10px] text-muted-foreground">{x.sub}</div>
                  </div>
                ))}
              </div>
              <div className="space-y-2.5">
                <div className="text-[10px] uppercase font-black tracking-wider text-muted-foreground">Age of what is owed</div>
                <AgingRow label="Today or yesterday" amount={o.postpaid.aging.days0to1} total={agingTotal} cls="bg-emerald-500" />
                <AgingRow label="2 – 7 days" amount={o.postpaid.aging.days2to7} total={agingTotal} cls="bg-amber-400" />
                <AgingRow label="8 – 30 days" amount={o.postpaid.aging.days8to30} total={agingTotal} cls="bg-orange-500" />
                <AgingRow label="Over 30 days" amount={o.postpaid.aging.over30} total={agingTotal} cls="bg-rose-600" />
              </div>
              <div className="rounded-xl border overflow-hidden">
                <div className="bg-muted/40 px-3 py-2 text-[10px] uppercase font-black tracking-wider text-muted-foreground flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Largest balances</div>
                {o.postpaid.topDebtors.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">No postpaid writer owes anything.</p>
                ) : (
                  <div className="divide-y">
                    {o.postpaid.topDebtors.map(d => (
                      <Link key={d.writerId} href={`/writers/${d.writerId}`} className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-muted/30">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold truncate">{d.writerName}</div>
                          <div className="text-[10px] text-muted-foreground font-mono truncate">{d.writerCode} · {d.agencyName ?? d.agentCode} · since {fmtDay(d.oldest)}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={`font-mono text-sm font-bold ${d.overdue ? "text-rose-600 dark:text-rose-400" : ""}`}>{ghs(d.owed)}</div>
                          <div className="text-[10px] text-muted-foreground">{d.overdue ? "overdue · " : ""}{d.draws} draw{d.draws === 1 ? "" : "s"}</div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </Section>

        <Section accent="bg-slate-500" title="Agency balances"
          subtitle="Running balance with each agency after payments and Run Draws">
          {!o ? <Skeleton className="h-48 rounded-2xl" /> : (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border bg-card/40 p-3">
                  <div className="text-[10px] uppercase font-black tracking-wider text-muted-foreground">Agencies owe the company</div>
                  <div className="font-mono text-base font-black mt-1 text-rose-600 dark:text-rose-400">{ghs(o.agencies.owedByAgencies)}</div>
                  <div className="text-[10px] text-muted-foreground">{agencyCount(o.agencies.list.filter(a => Number(a.balance) < 0).length)}</div>
                </div>
                <div className="rounded-xl border bg-card/40 p-3">
                  <div className="text-[10px] uppercase font-black tracking-wider text-muted-foreground">Company owes agencies</div>
                  <div className="font-mono text-base font-black mt-1 text-emerald-600 dark:text-emerald-400">{ghs(o.agencies.owedToAgencies)}</div>
                  <div className="text-[10px] text-muted-foreground">{agencyCount(o.agencies.list.filter(a => Number(a.balance) > 0).length)}</div>
                </div>
              </div>
              <div className="rounded-xl border overflow-hidden">
                <div className="bg-muted/40 px-3 py-2 text-[10px] uppercase font-black tracking-wider text-muted-foreground flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> Agencies with a balance</div>
                {o.agencies.list.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">Every agency balance is clear.</p>
                ) : (
                  <div className="divide-y max-h-[420px] overflow-y-auto">
                    {o.agencies.list.map(a => {
                      const bal = Number(a.balance);
                      return (
                        <Link key={a.agentId} href={`/agents/${a.agentId}/detail`} className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-muted/30">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold truncate">{a.agencyName ?? a.agentCode}</div>
                            <div className="text-[10px] text-muted-foreground font-mono">{a.agentCode}{a.debtSince && bal < 0 ? ` · owing since ${fmtDay(a.debtSince)}` : ""}{a.status === "closed" ? " · closed" : ""}</div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className={`font-mono text-sm font-bold ${bal < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>{ghs(Math.abs(bal))}</div>
                            <div className="text-[10px] text-muted-foreground">{bal < 0 ? "owes company" : "company owes"}</div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </Section>
      </div>

      {/* ── Manual wins clearance ── */}
      <Section accent="bg-violet-500" title="Manual wins — clearance"
        subtitle="Wins agents keyed in: how they were covered, how long they waited, and what is still pending Run Draws">
        {!manual ? <Skeleton className="h-48 rounded-2xl" /> : (() => {
          const s = manual.summary;
          const total = Number(s.totalWinsRecorded);
          const segs = [
            { label: "Agent net", value: s.clearedByAgentNet, cls: "bg-emerald-500" },
            { label: "Reserve fund", value: s.clearedByReserve, cls: "bg-violet-500" },
            { label: "Pending Run Draws", value: s.totalPending, cls: "bg-amber-400" },
            { label: "Remaining deficit", value: s.remainingDeficit, cls: "bg-rose-500" },
          ];
          const agingTotalM = Number(manual.aging.under7Days.amount) + Number(manual.aging.days7to14.amount) + Number(manual.aging.days14to30.amount) + Number(manual.aging.over30Days.amount);
          return (
            <div className="space-y-5">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {segs.map(x => (
                  <div key={x.label} className="rounded-xl border bg-card/40 p-3 min-w-0">
                    <div className="flex items-center gap-1.5 text-[10px] uppercase font-black tracking-wider text-muted-foreground"><span className={`w-2 h-2 rounded-full ${x.cls}`} />{x.label}</div>
                    <div className="font-mono text-base font-black mt-1 truncate">{ghs(x.value)}</div>
                    <div className="text-[10px] text-muted-foreground">{pct(Number(x.value), total)}% of {ghs(total)}</div>
                  </div>
                ))}
              </div>
              <div className="flex h-3 w-full rounded-full overflow-hidden bg-muted">
                {segs.map(x => Number(x.value) > 0 && <div key={x.label} className={x.cls} style={{ width: `${pct(Number(x.value), total)}%` }} />)}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-2xl border bg-card/30 p-4 space-y-3">
                  <div className="text-[10px] uppercase font-black tracking-wider text-muted-foreground">Pending queue — age</div>
                  {s.pendingCount === 0 ? <p className="text-xs text-muted-foreground py-4 text-center">Nothing waiting for Run Draws.</p> : (
                    <>
                      <AgingRow label={`Under 7 days · ${manual.aging.under7Days.count}`} amount={manual.aging.under7Days.amount} total={agingTotalM} cls="bg-emerald-500" />
                      <AgingRow label={`7 – 14 days · ${manual.aging.days7to14.count}`} amount={manual.aging.days7to14.amount} total={agingTotalM} cls="bg-amber-400" />
                      <AgingRow label={`14 – 30 days · ${manual.aging.days14to30.count}`} amount={manual.aging.days14to30.amount} total={agingTotalM} cls="bg-orange-500" />
                      <AgingRow label={`Over 30 days · ${manual.aging.over30Days.count}`} amount={manual.aging.over30Days.amount} total={agingTotalM} cls="bg-rose-600" />
                    </>
                  )}
                </div>
                <div className="rounded-2xl border bg-card/30 p-4">
                  <div className="text-[10px] uppercase font-black tracking-wider text-muted-foreground mb-3">Days from entry to Run Draws</div>
                  {manual.paymentSpeed.avgDaysToCalculate == null ? <p className="text-xs text-muted-foreground py-4 text-center">No calculated entries yet.</p> : (
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: "Average", v: manual.paymentSpeed.avgDaysToCalculate, cls: "text-blue-600 dark:text-blue-400" },
                        { label: "Fastest", v: manual.paymentSpeed.fastestDays, cls: "text-emerald-600 dark:text-emerald-400" },
                        { label: "Slowest", v: manual.paymentSpeed.slowestDays, cls: "text-rose-600 dark:text-rose-400" },
                      ].map(x => (
                        <div key={x.label} className="rounded-xl bg-muted/40 p-3 text-center">
                          <div className={`text-2xl font-black ${x.cls}`}>{x.v}d</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{x.label}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <Tabs defaultValue="queue">
                <TabsList className="h-auto flex-wrap justify-start">
                  <TabsTrigger value="queue">Pending queue ({s.pendingCount})</TabsTrigger>
                  <TabsTrigger value="history">Clearance history ({s.calculatedCount})</TabsTrigger>
                </TabsList>
                <TabsContent value="queue" className="mt-3">
                  <div className="flex flex-wrap gap-1 mb-2">
                    {(["all", "ok", "warning", "critical"] as const).map(f => (
                      <button key={f} onClick={() => setQueueFilter(f)}
                        className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${queueFilter === f ? "bg-foreground text-background border-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                        {f === "all" ? "All" : URGENCY_CFG[f].label}
                      </button>
                    ))}
                  </div>
                  <div className="rounded-xl border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/30">
                          <TableHead className="text-xs">Writer</TableHead>
                          <TableHead className="text-xs">Agency</TableHead>
                          <TableHead className="text-xs">Entry date</TableHead>
                          <TableHead className="text-right text-xs">Wins</TableHead>
                          <TableHead className="text-center text-xs">Waiting</TableHead>
                          <TableHead className="text-xs">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredQueue.length === 0 ? (
                          <TableRow><TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-8">{s.pendingCount === 0 ? "Queue is clear." : "No entries match this filter."}</TableCell></TableRow>
                        ) : filteredQueue.map(item => {
                          const cfg = URGENCY_CFG[item.urgency];
                          return (
                            <TableRow key={item.id}>
                              <TableCell><div className="text-sm font-medium">{item.writerName}</div><div className="text-[10px] font-mono text-muted-foreground">{item.writerCode}</div></TableCell>
                              <TableCell><div className="text-sm">{item.agentName}</div><div className="text-[10px] font-mono text-muted-foreground">{item.agentCode}</div></TableCell>
                              <TableCell className="text-sm whitespace-nowrap">{fmtDay(item.entryDate)}</TableCell>
                              <TableCell className="text-right font-mono text-sm font-semibold whitespace-nowrap">{ghs(item.winsAmount)}</TableCell>
                              <TableCell className="text-center text-sm font-bold">{item.daysInQueue}d</TableCell>
                              <TableCell><Badge variant="outline" className={`text-[10px] ${cfg.cls}`}>{cfg.label}</Badge></TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>
                <TabsContent value="history" className="mt-3">
                  <div className="rounded-xl border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/30">
                          <TableHead className="text-xs">Writer</TableHead>
                          <TableHead className="text-xs">Agency</TableHead>
                          <TableHead className="text-xs">Date</TableHead>
                          <TableHead className="text-right text-xs">Wins</TableHead>
                          <TableHead className="text-right text-xs">Reserve used</TableHead>
                          <TableHead className="text-right text-xs">Writer balance</TableHead>
                          <TableHead className="text-xs">Cleared by</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {manual.history.length === 0 ? (
                          <TableRow><TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-8">No calculation history yet.</TableCell></TableRow>
                        ) : manual.history.map((h, i) => (
                          <TableRow key={`${h.writerId}-${h.calcDate}-${i}`}>
                            <TableCell><div className="text-sm font-medium">{h.writerName}</div><div className="text-[10px] font-mono text-muted-foreground">{h.writerCode}</div></TableCell>
                            <TableCell className="text-sm">{h.agentName}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{fmtDay(h.calcDate)}</TableCell>
                            <TableCell className="text-right font-mono text-sm whitespace-nowrap">{ghs(h.winsAmount)}</TableCell>
                            <TableCell className="text-right font-mono text-sm whitespace-nowrap">{Number(h.reserveDrawn) > 0 ? ghs(h.reserveDrawn) : "—"}</TableCell>
                            <TableCell className={`text-right font-mono text-sm whitespace-nowrap ${Number(h.writerBalance) < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>{ghs(h.writerBalance)}</TableCell>
                            <TableCell><Badge variant="outline" className={`text-[10px] ${CLEARED_CFG[h.clearedBy].cls}`}>{CLEARED_CFG[h.clearedBy].label}</Badge></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          );
        })()}
      </Section>
    </div>
  );
}
