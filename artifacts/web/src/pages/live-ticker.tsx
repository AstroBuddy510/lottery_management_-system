import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell, LabelList,
  Tooltip as ChartTooltip,
} from "recharts";
import {
  Activity, Radio, Ticket, Coins, Users as UsersIcon, Building2, Flame, Pause, Play,
  Search, MonitorSmartphone, MapPin, WifiOff, Loader2, ShieldAlert, RefreshCw, Clock,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtGHS } from "@/lib/utils";
import { getServerNow } from "@/lib/time-sync";
import {
  useLiveTicker, ticketNumbers, minuteKey,
  type TickerSale, type TickerConnection, type TickerState,
} from "@/lib/live-ticker";

/* ── formatting ──────────────────────────────────────────────────────────── */

// Ghana keeps GMT all year; naming the zone keeps a laptop set to another
// zone from showing the wrong clock.
const TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Accra", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
const STAMP_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Accra", weekday: "short", day: "numeric", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
const MINUTE_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Accra", hour: "2-digit", minute: "2-digit", hour12: false,
});

const fmtTime = (iso: string) => TIME_FMT.format(new Date(iso));
const fmtStamp = (iso: string) => {
  const d = new Date(iso);
  return `${STAMP_FMT.format(d)}.${String(d.getUTCMilliseconds()).padStart(3, "0")} GMT`;
};
const pad2 = (n: number) => String(n).padStart(2, "0");
const compactGhs = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1_000_000 ? `${(a / 1_000_000).toFixed(1)}m` : a >= 1_000 ? `${(a / 1_000).toFixed(1)}k` : a.toFixed(a >= 100 ? 0 : 2).replace(/\.00$/, "");
  return `₵${s}`;
};

function ago(iso: string | null, now: number): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

function useNow(ms: number) {
  const [now, setNow] = useState(() => getServerNow().getTime());
  useEffect(() => {
    const id = setInterval(() => setNow(getServerNow().getTime()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/* ── building blocks ─────────────────────────────────────────────────────── */

// Two series colours, from the theme's own chart tokens: blue for the bars,
// orange for "just staked" and the second channel. Blue/orange stays apart
// under every common colour-vision deficiency.
const BAR = "hsl(var(--chart-2))";
const ACCENT = "hsl(var(--chart-1))";

function Panel({ title, subtitle, icon, right, children, className = "", bodyClassName = "p-5" }: {
  title: string; subtitle?: string; icon?: React.ReactNode; right?: React.ReactNode;
  children: React.ReactNode; className?: string; bodyClassName?: string;
}) {
  return (
    <section className={`rounded-2xl border bg-card shadow-sm flex flex-col min-w-0 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3 border-b">
        <div className="flex items-center gap-2.5 min-w-0">
          {icon && <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground shrink-0">{icon}</div>}
          <div className="min-w-0">
            <h2 className="text-sm font-bold tracking-tight">{title}</h2>
            {subtitle && <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>}
          </div>
        </div>
        {right}
      </div>
      <div className={`flex-1 min-h-0 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

const CONNECTION: Record<TickerConnection, { label: string; hint: string; cls: string; dot: string; icon?: React.ReactNode }> = {
  connecting:   { label: "Connecting",   hint: "Opening the live stream…", cls: "bg-muted text-muted-foreground", dot: "bg-muted-foreground animate-pulse" },
  live:         { label: "Live",         hint: "Streaming over WebSocket — each sale appears the moment it is made.", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30", dot: "bg-emerald-500 animate-pulse" },
  reconnecting: { label: "Reconnecting", hint: "The stream dropped. Reconnecting — nothing sold meanwhile is lost.", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30", dot: "bg-amber-500 animate-pulse" },
  polling:      { label: "Polling",      hint: "The live stream is unavailable, so the page reloads every few seconds instead.", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30", dot: "bg-amber-500", icon: <WifiOff className="w-3 h-3" /> },
  forbidden:    { label: "No access",    hint: "The live stream is for office staff.", cls: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30", dot: "bg-red-500", icon: <ShieldAlert className="w-3 h-3" /> },
};

function ConnectionPill({ connection }: { connection: TickerConnection }) {
  const c = CONNECTION[connection];
  return (
    <span
      title={c.hint}
      role="status"
      aria-label={`Live stream: ${c.label}. ${c.hint}`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-wider ${c.cls}`}
    >
      {c.icon ?? <span className={`w-2 h-2 rounded-full ${c.dot}`} />}
      {c.label}
    </span>
  );
}

function StatTile({ label, value, sub, icon, accent }: {
  label: string; value: string; sub?: React.ReactNode; icon: React.ReactNode; accent: string;
}) {
  return (
    <div className="relative rounded-2xl border bg-card shadow-sm p-4 overflow-hidden min-w-0">
      <div className={`absolute inset-x-0 top-0 h-0.5 ${accent}`} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground truncate">{label}</span>
        <span className="text-muted-foreground shrink-0">{icon}</span>
      </div>
      <div className="mt-1.5 text-2xl font-black tracking-tight tabular-nums truncate">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground truncate">{sub}</div>}
    </div>
  );
}

function NumberBall({ n, hot = false, size = "sm" }: { n: number; hot?: boolean; size?: "sm" | "lg" }) {
  const dims = size === "lg" ? "w-10 h-10 text-sm" : "w-7 h-7 text-[11px]";
  return (
    <span className={`inline-flex items-center justify-center rounded-full font-black tabular-nums shrink-0 ${dims} ${hot ? "bg-[hsl(var(--chart-1))] text-white" : "bg-primary/10 text-primary dark:bg-muted dark:text-foreground"}`}>
      {pad2(n)}
    </span>
  );
}

function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border bg-muted/50 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`px-2.5 h-7 rounded-md text-[11px] font-bold transition-colors ${value === o.value ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ChartTip({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border bg-popover text-popover-foreground shadow-md px-3 py-2 text-xs space-y-0.5">{children}</div>;
}

/* ── Top 10 numbers ──────────────────────────────────────────────────────── */

type Metric = "count" | "stake";

function TopNumbers({ state, hot }: { state: TickerState; hot: Set<number> }) {
  const [metric, setMetric] = useState<Metric>("count");

  const top = useMemo(() => {
    const rows = [...state.numbers.entries()].map(([number, v]) => ({ number, label: pad2(number), ...v }));
    rows.sort((a, b) =>
      metric === "count"
        ? b.count - a.count || b.stake - a.stake || a.number - b.number
        : b.stake - a.stake || b.count - a.count || a.number - b.number,
    );
    return rows.slice(0, 10).map((r, i) => ({ ...r, rank: i + 1, value: metric === "count" ? r.count : r.stake }));
  }, [state.numbers, metric]);

  const leader = top[0];
  const distinct = state.numbers.size;

  return (
    <Panel
      title="Top 10 most staked numbers"
      subtitle={`Today · ${distinct} different number${distinct === 1 ? "" : "s"} played · banker included · updates on every sale`}
      icon={<Flame className="w-4 h-4" />}
      right={
        <Segmented<Metric>
          label="Rank numbers by"
          value={metric}
          onChange={setMetric}
          options={[{ value: "count", label: "Times staked" }, { value: "stake", label: "Amount staked" }]}
        />
      }
    >
      {top.length === 0 ? (
        <div className="h-[300px] flex flex-col items-center justify-center text-center text-muted-foreground gap-2">
          <Flame className="w-8 h-8 opacity-30" />
          <p className="text-sm font-semibold">No numbers staked yet today</p>
          <p className="text-xs">The chart fills in as the first POS sales come through.</p>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[13rem_1fr]">
          {/* The leader, stated plainly - the one thing to read off this panel. */}
          <div className="flex lg:flex-col gap-3 lg:gap-4">
            <div className="flex-1 rounded-xl border bg-gradient-to-br from-[hsl(var(--chart-1)/0.12)] to-transparent p-4">
              <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Hottest number</div>
              <div className="mt-2 flex items-center gap-3">
                <span className="w-14 h-14 rounded-full bg-[hsl(var(--chart-1))] text-white flex items-center justify-center text-2xl font-black tabular-nums shadow-sm">
                  {leader.label}
                </span>
                <div className="min-w-0">
                  <div className="text-lg font-black tabular-nums leading-tight">{leader.count.toLocaleString()}×</div>
                  <div className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">{fmtGHS(leader.stake)}</div>
                </div>
              </div>
            </div>
            <ol className="flex-1 rounded-xl border p-3 space-y-1.5 text-xs" aria-label="Runners-up">
              {top.slice(1, 4).map((r) => (
                <li key={r.number} className="flex items-center gap-2">
                  <span className="w-4 text-[10px] font-black text-muted-foreground tabular-nums">{r.rank}</span>
                  <NumberBall n={r.number} hot={hot.has(r.number)} />
                  <span className="ml-auto font-bold tabular-nums">{r.count}×</span>
                  <span className="w-16 text-right text-muted-foreground tabular-nums">{compactGhs(r.stake)}</span>
                </li>
              ))}
              {top.length < 2 && <li className="text-muted-foreground">Runners-up appear with more sales.</li>}
            </ol>
          </div>

          <div className="min-w-0">
            <div className="h-[300px]" aria-hidden="true">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={top} margin={{ top: 22, right: 4, left: 0, bottom: 0 }} barCategoryGap="18%">
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                    tick={{ fontSize: 13, fontWeight: 800, fill: "hsl(var(--foreground))" }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={44}
                    allowDecimals={metric === "stake"}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={(v: number) => (metric === "stake" ? compactGhs(v) : String(v))}
                  />
                  <ChartTooltip
                    cursor={{ fill: "hsl(var(--muted) / 0.6)" }}
                    content={({ active, payload }) => {
                      const r = active && payload?.[0]?.payload as (typeof top)[number] | undefined;
                      if (!r) return null;
                      return (
                        <ChartTip>
                          <div className="font-black">Number {r.label} · #{r.rank} today</div>
                          <div className="tabular-nums">Staked {r.count.toLocaleString()} time{r.count === 1 ? "" : "s"}</div>
                          <div className="tabular-nums text-muted-foreground">{fmtGHS(r.stake)} on tickets carrying it</div>
                        </ChartTip>
                      );
                    }}
                  />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={350} maxBarSize={56}>
                    {top.map((r) => (
                      <Cell key={r.number} fill={hot.has(r.number) ? ACCENT : BAR} />
                    ))}
                    <LabelList
                      dataKey="value"
                      position="top"
                      className="tabular-nums"
                      style={{ fontSize: 11, fontWeight: 700, fill: "hsl(var(--muted-foreground))" }}
                      formatter={(v: number) => (metric === "stake" ? compactGhs(v) : v.toLocaleString())}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: BAR }} />{metric === "count" ? "Tickets carrying the number" : "Stake on tickets carrying the number"}</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: ACCENT }} />Just staked</span>
            </div>
            {/* The same ten as a table, for screen readers. */}
            <table className="sr-only">
              <caption>Top 10 most staked numbers today</caption>
              <thead><tr><th>Rank</th><th>Number</th><th>Times staked</th><th>Amount staked</th></tr></thead>
              <tbody>
                {top.map((r) => (
                  <tr key={r.number}><td>{r.rank}</td><td>{r.label}</td><td>{r.count}</td><td>{fmtGHS(r.stake)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ── Agency performance ──────────────────────────────────────────────────── */

function AgencyPerformance({ state, now }: { state: TickerState; now: number }) {
  const rows = useMemo(() => {
    const writersBy = new Map<string, number>();
    for (const agentId of state.writers.values()) writersBy.set(agentId, (writersBy.get(agentId) ?? 0) + 1);
    return [...state.agencies.values()]
      .map((a) => ({ ...a, writers: writersBy.get(a.agentId) ?? 0 }))
      .sort((a, b) => b.stakes - a.stakes || b.tickets - a.tickets);
  }, [state.agencies, state.writers]);

  const max = rows[0]?.stakes ?? 0;

  return (
    <Panel
      title="Agency performance"
      subtitle={`${rows.length} agenc${rows.length === 1 ? "y" : "ies"} selling today · ranked by stakes${rows.length > 5 ? " · scroll for all" : ""}`}
      icon={<Building2 className="w-4 h-4" />}
      className="xl:col-span-3"
      bodyClassName="p-0"
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-10 text-center">No agency has sold yet today.</p>
      ) : (
        <ul className="space-y-3.5 p-5 max-h-[21rem] overflow-y-auto">
          {rows.map((a, i) => {
            const share = state.stakes > 0 ? (a.stakes / state.stakes) * 100 : 0;
            const width = max > 0 ? Math.max((a.stakes / max) * 100, 1.5) : 0;
            return (
              <li key={a.agentId} className="min-w-0">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="w-5 text-[11px] font-black text-muted-foreground tabular-nums shrink-0">{i + 1}</span>
                  <span className="text-sm font-bold truncate">{a.agencyName}</span>
                  <span className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">{a.agentCode}</span>
                  <span className="ml-auto text-sm font-black tabular-nums shrink-0">{fmtGHS(a.stakes)}</span>
                </div>
                <div className="ml-7 mt-1.5 h-2 rounded-full bg-muted overflow-hidden" aria-hidden="true">
                  <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${width}%`, background: BAR }} />
                </div>
                <div className="ml-7 mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground tabular-nums">
                  <span>{share.toFixed(1)}% of stakes</span>
                  <span>{a.tickets.toLocaleString()} ticket{a.tickets === 1 ? "" : "s"}</span>
                  <span>{a.writers} writer{a.writers === 1 ? "" : "s"}</span>
                  <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{ago(a.lastSaleAt, now)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* ── Stakes per minute ───────────────────────────────────────────────────── */

function StakesPerMinute({ state, now }: { state: TickerState; now: number }) {
  const data = useMemo(() => {
    const end = new Date(minuteKey(new Date(now).toISOString())).getTime();
    const out = [];
    for (let i = state.seriesMinutes - 1; i >= 0; i--) {
      const key = new Date(end - i * 60_000).toISOString();
      const v = state.minutes.get(key);
      out.push({ key, label: MINUTE_FMT.format(new Date(key)), stakes: v?.stakes ?? 0, tickets: v?.tickets ?? 0 });
    }
    return out;
  }, [state.minutes, state.seriesMinutes, now]);

  const hour = data.reduce((s, d) => ({ stakes: s.stakes + d.stakes, tickets: s.tickets + d.tickets }), { stakes: 0, tickets: 0 });
  const peak = data.reduce((m, d) => (d.stakes > m.stakes ? d : m), data[0]);

  return (
    <Panel
      title="Stakes per minute"
      subtitle="The last hour"
      icon={<Activity className="w-4 h-4" />}
      className="xl:col-span-2"
    >
      <div className="flex flex-wrap gap-x-6 gap-y-1 mb-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Last 60 min</div>
          <div className="text-lg font-black tabular-nums">{fmtGHS(hour.stakes)}</div>
        </div>
        <div>
          <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Tickets</div>
          <div className="text-lg font-black tabular-nums">{hour.tickets.toLocaleString()}</div>
        </div>
        {peak && peak.stakes > 0 && (
          <div>
            <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Busiest minute</div>
            <div className="text-lg font-black tabular-nums">{peak.label}</div>
          </div>
        )}
      </div>
      <div className="h-[190px]" aria-label={`Stakes per minute over the last hour: ${fmtGHS(hour.stakes)} from ${hour.tickets} tickets`} role="img">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap={1}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} interval={14} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
            <YAxis tickLine={false} axisLine={false} width={44} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v: number) => compactGhs(v)} />
            <ChartTooltip
              cursor={{ fill: "hsl(var(--muted) / 0.6)" }}
              content={({ active, payload }) => {
                const r = active && payload?.[0]?.payload as (typeof data)[number] | undefined;
                if (!r) return null;
                return (
                  <ChartTip>
                    <div className="font-black">{r.label} GMT</div>
                    <div className="tabular-nums">{fmtGHS(r.stakes)}</div>
                    <div className="tabular-nums text-muted-foreground">{r.tickets} ticket{r.tickets === 1 ? "" : "s"}</div>
                  </ChartTip>
                );
              }}
            />
            <Bar dataKey="stakes" fill={BAR} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

/* ── Mix: games, bet types, channels ─────────────────────────────────────── */

function ShareList({ rows, total }: { rows: { key: string; label: string; tag?: string; stakes: number; tickets: number }[]; total: number }) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground py-4">Nothing sold yet today.</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => {
        const share = total > 0 ? (r.stakes / total) * 100 : 0;
        return (
          <li key={r.key} className="min-w-0">
            <div className="flex items-baseline gap-2 text-xs min-w-0">
              <span className="font-semibold truncate">{r.label}</span>
              {r.tag && <span className="font-mono text-[10px] text-muted-foreground shrink-0">#{r.tag}</span>}
              <span className="ml-auto font-bold tabular-nums shrink-0">{fmtGHS(r.stakes)}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden" aria-hidden="true">
                <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(share, 1)}%`, background: BAR }} />
              </div>
              <span className="w-20 text-right text-[10px] text-muted-foreground tabular-nums">{share.toFixed(1)}% · {r.tickets}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function SalesMix({ state }: { state: TickerState }) {
  const games = [...state.games.values()]
    .sort((a, b) => b.stakes - a.stakes)
    .map((g) => ({ key: g.gameId, label: g.gameName, tag: g.eventNumber, stakes: g.stakes, tickets: g.tickets }));
  const betTypes = [...state.betTypes.entries()]
    .sort((a, b) => b[1].stakes - a[1].stakes)
    .map(([k, v]) => ({ key: k, label: k, stakes: v.stakes, tickets: v.tickets }));
  const prepaid = state.channels.get("prepaid") ?? { tickets: 0, stakes: 0 };
  const postpaid = state.channels.get("postpaid") ?? { tickets: 0, stakes: 0 };
  const chTotal = prepaid.stakes + postpaid.stakes;
  const prePct = chTotal > 0 ? (prepaid.stakes / chTotal) * 100 : 0;

  return (
    <Panel title="Sales mix" subtitle="By payment channel, game and bet type" icon={<Ticket className="w-4 h-4" />}>
      <div className="grid gap-6 md:grid-cols-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground mb-2">Channel</div>
          <div className="flex h-3 rounded-full overflow-hidden bg-muted gap-[2px]" aria-hidden="true">
            {prepaid.stakes > 0 && <div className="h-full transition-[width] duration-500" style={{ width: `${prePct}%`, background: BAR }} />}
            {postpaid.stakes > 0 && <div className="h-full flex-1" style={{ background: ACCENT }} />}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-start gap-1.5">
              <span className="mt-1 w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: BAR }} />
              <div><div className="font-semibold">Prepaid · {chTotal > 0 ? prePct.toFixed(0) : 0}%</div><div className="text-muted-foreground tabular-nums">{fmtGHS(prepaid.stakes)} · {prepaid.tickets}</div></div>
            </div>
            <div className="flex items-start gap-1.5">
              <span className="mt-1 w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: ACCENT }} />
              <div><div className="font-semibold">Postpaid · {chTotal > 0 ? (100 - prePct).toFixed(0) : 0}%</div><div className="text-muted-foreground tabular-nums">{fmtGHS(postpaid.stakes)} · {postpaid.tickets}</div></div>
            </div>
          </div>
        </div>
        <div>
          <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground mb-2">Games</div>
          <ShareList rows={games.slice(0, 5)} total={state.stakes} />
        </div>
        <div>
          <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground mb-2">Bet types</div>
          <ShareList rows={betTypes.slice(0, 6)} total={state.stakes} />
        </div>
      </div>
    </Panel>
  );
}

/* ── Live feed ───────────────────────────────────────────────────────────── */

const ALL = "_all";

function SaleNumbers({ sale }: { sale: TickerSale }) {
  const nums = (sale.numbers ?? "").split(/[^0-9]+/).filter((x) => /^[0-9]{1,3}$/.test(x)).map(Number);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {sale.banker != null && (
        <span className="inline-flex items-center gap-1" title="Banker">
          <NumberBall n={sale.banker} hot />
          {nums.length > 0 && <span className="text-[10px] text-muted-foreground">+</span>}
        </span>
      )}
      {nums.map((n, i) => <NumberBall key={`${n}-${i}`} n={n} />)}
    </div>
  );
}

function StatusTag({ status }: { status: string }) {
  if (status === "active") return null;
  const cls = status === "won" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
    : status === "lost" ? "bg-muted text-muted-foreground"
    : "bg-red-500/10 text-red-700 dark:text-red-400";
  return <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${cls}`}>{status}</span>;
}

function LiveFeed({ state, fresh, now }: { state: TickerState; fresh: Set<string>; now: number }) {
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState<TickerSale[] | null>(null);
  const [agency, setAgency] = useState(ALL);
  const [game, setGame] = useState(ALL);
  const [q, setQ] = useState("");

  const source = paused && frozen ? frozen : state.feed;
  const queued = paused && frozen
    ? (() => { const i = state.feed.findIndex((f) => f.id === frozen[0]?.id); return i === -1 ? state.feed.length : i; })()
    : 0;

  const togglePause = () => {
    if (paused) { setPaused(false); setFrozen(null); }
    else { setFrozen(state.feed); setPaused(true); }
  };

  const agencies = useMemo(() => [...state.agencies.values()].sort((a, b) => a.agencyName.localeCompare(b.agencyName)), [state.agencies]);
  const games = useMemo(() => [...state.games.values()].sort((a, b) => a.gameName.localeCompare(b.gameName)), [state.games]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return source.filter((s) =>
      (agency === ALL || s.agentId === agency) &&
      (game === ALL || s.gameId === game) &&
      (!needle || [s.writerName, s.writerCode, s.ticketNumber, s.agentCode, s.agencyName, s.terminalSerial ?? "", s.location ?? ""]
        .some((v) => v.toLowerCase().includes(needle))),
    );
  }, [source, agency, game, q]);

  const filtered = agency !== ALL || game !== ALL || q.trim() !== "";

  return (
    <Panel
      title="Live feed"
      subtitle={`Every stake as it is sold · newest first · ${rows.length}${filtered ? " matching" : ""} of the latest ${source.length}`}
      icon={<Radio className="w-4 h-4" />}
      bodyClassName="p-0"
      right={
        <div className="flex items-center gap-2">
          {paused && queued > 0 && (
            <button onClick={togglePause} className="text-[11px] font-bold px-2.5 h-7 rounded-full bg-[hsl(var(--chart-1))] text-white">
              {queued} new · resume
            </button>
          )}
          <Button variant={paused ? "default" : "outline"} size="sm" className="h-7 text-[11px] gap-1.5" onClick={togglePause} aria-pressed={paused}>
            {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            {paused ? "Resume" : "Pause"}
          </Button>
        </div>
      }
    >
      {/* Filters, one row above the list. */}
      <div className="flex flex-col md:flex-row gap-2 px-5 py-3 border-b bg-muted/20">
        <div className="relative flex-1 min-w-0">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Writer, ticket, terminal or place"
            aria-label="Search the feed"
            className="h-8 pl-8 text-xs md:text-xs"
          />
        </div>
        <Select value={agency} onValueChange={setAgency}>
          <SelectTrigger className="h-8 text-xs md:w-52" aria-label="Filter by agency"><SelectValue /></SelectTrigger>
          <SelectContent className="select-scroll max-h-[18rem]">
            <SelectItem value={ALL}>All agencies</SelectItem>
            {agencies.map((a) => <SelectItem key={a.agentId} value={a.agentId}>{a.agencyName} · {a.agentCode}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={game} onValueChange={setGame}>
          <SelectTrigger className="h-8 text-xs md:w-48" aria-label="Filter by game"><SelectValue /></SelectTrigger>
          <SelectContent className="select-scroll max-h-[18rem]">
            <SelectItem value={ALL}>All games</SelectItem>
            {games.map((g) => <SelectItem key={g.gameId} value={g.gameId}>{g.gameName} · #{g.eventNumber}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {rows.length === 0 ? (
        <div className="py-14 text-center text-muted-foreground">
          <Radio className="w-8 h-8 mx-auto opacity-30" />
          <p className="mt-2 text-sm font-semibold">{filtered ? "No sales match these filters" : "Waiting for the first sale of the day"}</p>
          {!filtered && <p className="text-xs mt-1">Stakes appear here the instant a writer sells them.</p>}
        </div>
      ) : (
        <>
          {/* Desktop: a table with a header that stays put while the list scrolls. */}
          <div className="hidden md:block max-h-[36rem] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_hsl(var(--border))]">
                <tr className="text-left text-[10px] font-black uppercase tracking-wider text-muted-foreground">
                  <th className="px-5 py-2.5 font-black">Time</th>
                  <th className="px-3 py-2.5 font-black">Writer</th>
                  <th className="px-3 py-2.5 font-black">Agent</th>
                  <th className="px-3 py-2.5 font-black">Terminal · location</th>
                  <th className="px-3 py-2.5 font-black">Game · bet</th>
                  <th className="px-3 py-2.5 font-black">Numbers</th>
                  <th className="px-5 py-2.5 font-black text-right">Stake</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const isNew = fresh.has(s.id);
                  const dead = s.status === "cancelled" || s.status === "void";
                  return (
                    <tr key={s.id} className={`border-b last:border-0 align-top hover:bg-muted/40 ${isNew ? "ticker-flash" : ""}`}>
                      <td className="px-5 py-2.5 whitespace-nowrap">
                        <div className="font-mono font-bold tabular-nums" title={fmtStamp(s.createdAt)}>{fmtTime(s.createdAt)}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">{s.ticketNumber}</div>
                      </td>
                      <td className="px-3 py-2.5 min-w-0">
                        <div className="font-semibold truncate max-w-[11rem]">{s.writerName}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{s.writerCode}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-mono font-bold">{s.agentCode}</div>
                        <div className="text-[10px] text-muted-foreground truncate max-w-[9rem]">{s.agencyName}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1 font-mono text-[11px]">
                          <MonitorSmartphone className="w-3 h-3 text-muted-foreground shrink-0" />
                          {s.terminalSerial ?? <span className="text-muted-foreground font-sans italic">No terminal</span>}
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground truncate max-w-[12rem]">
                          <MapPin className="w-3 h-3 shrink-0" />{s.location ?? "Location not set"}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-semibold truncate max-w-[10rem]">{s.gameName} <span className="font-mono text-[10px] text-muted-foreground">#{s.eventNumber}</span></div>
                        <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                          {s.betType ?? "—"}
                          <span className={`px-1 rounded text-[9px] font-black uppercase ${s.model === "prepaid" ? "bg-primary/10 text-primary dark:bg-muted dark:text-foreground" : "bg-[hsl(var(--chart-1)/0.12)] text-[hsl(var(--chart-1))]"}`}>{s.model}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5"><SaleNumbers sale={s} /></td>
                      <td className="px-5 py-2.5 text-right whitespace-nowrap">
                        <div className={`font-black tabular-nums text-sm ${dead ? "line-through text-muted-foreground" : ""}`}>{fmtGHS(s.stake)}</div>
                        <div className="flex justify-end gap-1 mt-0.5">
                          {isNew && <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-[hsl(var(--chart-1))] text-white">New</span>}
                          <StatusTag status={s.status} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Phone: one card per sale. */}
          <ul className="md:hidden max-h-[36rem] overflow-y-auto divide-y">
            {rows.map((s) => {
              const isNew = fresh.has(s.id);
              const dead = s.status === "cancelled" || s.status === "void";
              return (
                <li key={s.id} className={`px-4 py-3 ${isNew ? "ticker-flash" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-bold truncate">{s.writerName} <span className="font-mono text-[10px] text-muted-foreground">{s.writerCode}</span></div>
                      <div className="text-[11px] text-muted-foreground truncate">{s.agentCode} · {s.gameName} · {s.betType ?? "—"}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`font-black tabular-nums ${dead ? "line-through text-muted-foreground" : ""}`}>{fmtGHS(s.stake)}</div>
                      <div className="font-mono text-[10px] text-muted-foreground" title={fmtStamp(s.createdAt)}>{fmtTime(s.createdAt)}</div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <SaleNumbers sale={s} />
                    <div className="flex gap-1">
                      {isNew && <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-[hsl(var(--chart-1))] text-white">New</span>}
                      <StatusTag status={s.status} />
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground truncate">
                    <MonitorSmartphone className="w-3 h-3 shrink-0" />{s.terminalSerial ?? "No terminal"}
                    <span className="mx-1">·</span>
                    <MapPin className="w-3 h-3 shrink-0" />{s.location ?? "Location not set"}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <div className="px-5 py-2 border-t text-[10px] text-muted-foreground flex items-center justify-between gap-2">
        <span>Times are Accra (GMT). Hover a time for the exact second.</span>
        <span className="tabular-nums">Last sale {ago(state.lastSaleAt, now)}</span>
      </div>
    </Panel>
  );
}

/* ── page ────────────────────────────────────────────────────────────────── */

const FRESH_MS = 6_000;
const HOT_MS = 4_000;

export default function LiveTicker() {
  // Rows and numbers that have just arrived, so they can be picked out for a
  // few seconds. Kept apart from the ticker state: they are about this
  // screen's moment, not about the day's figures.
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [hot, setHot] = useState<Set<number>>(new Set());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const onSale = useCallback((sale: TickerSale) => {
    setFresh((prev) => new Set(prev).add(sale.id));
    const nums = ticketNumbers(sale);
    setHot(new Set(nums));
    timers.current.push(
      setTimeout(() => setFresh((prev) => { const n = new Set(prev); n.delete(sale.id); return n; }), FRESH_MS),
      setTimeout(() => setHot((prev) => (nums.every((x) => prev.has(x)) && prev.size === nums.length ? new Set() : prev)), HOT_MS),
    );
  }, []);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const { state, connection, error, reload } = useLiveTicker({ onSale });
  const now = useNow(5_000);

  const dayLabel = state
    ? new Date(`${state.day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    : "";
  const avg = state && state.tickets > 0 ? state.stakes / state.tickets : 0;
  const activeAgencies = state ? state.agencies.size : 0;

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <Radio className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-black tracking-tight">Live Ticker</h1>
            <p className="text-xs text-muted-foreground truncate">Every POS stake the moment it is sold{dayLabel ? ` · ${dayLabel}` : ""}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ConnectionPill connection={connection} />
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void reload()} title="Reload today's figures">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {connection === "forbidden" && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          The live stream is available to directors and administrators only.
        </div>
      )}
      {error && state && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-300">
          Could not refresh today's figures ({error}). Showing what was last loaded{connection === "live" ? "; new sales are still streaming in" : ""}.
        </div>
      )}

      {!state ? (
        <div className="rounded-2xl border bg-card p-16 flex flex-col items-center gap-3 text-muted-foreground">
          {error ? (
            <>
              <WifiOff className="w-8 h-8 opacity-40" />
              <p className="text-sm font-semibold">{error}</p>
              <Button size="sm" variant="outline" onClick={() => void reload()}>Try again</Button>
            </>
          ) : (
            <>
              <Loader2 className="w-7 h-7 animate-spin" />
              <p className="text-sm">Loading today's sales…</p>
            </>
          )}
        </div>
      ) : (
        <>
          {/* ── Today at a glance ── */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <StatTile label="Stakes today" value={fmtGHS(state.stakes)} sub={`Average ${fmtGHS(avg)} a ticket`} icon={<Coins className="w-4 h-4" />} accent="bg-[hsl(var(--chart-1))]" />
            <StatTile label="Tickets sold" value={state.tickets.toLocaleString()} sub={`Last sale ${ago(state.lastSaleAt, now)}`} icon={<Ticket className="w-4 h-4" />} accent="bg-[hsl(var(--chart-2))]" />
            <StatTile label="Active writers" value={state.writers.size.toLocaleString()} sub="Sold at least one ticket today" icon={<UsersIcon className="w-4 h-4" />} accent="bg-emerald-500" />
            <StatTile label="Agencies selling" value={activeAgencies.toLocaleString()} sub={`${state.games.size} game${state.games.size === 1 ? "" : "s"} taking stakes`} icon={<Building2 className="w-4 h-4" />} accent="bg-violet-500" />
          </div>

          {/* ── The headline: which numbers the day is backing ── */}
          <TopNumbers state={state} hot={hot} />

          {/* ── Agency performance, and how the day is moving ── */}
          <div className="grid gap-5 xl:grid-cols-5">
            <AgencyPerformance state={state} now={now} />
            <StakesPerMinute state={state} now={now} />
          </div>

          {/* ── Where the money is coming from ── */}
          <SalesMix state={state} />

          {/* ── Every stake ── */}
          <LiveFeed state={state} fresh={fresh} now={now} />
        </>
      )}
    </div>
  );
}
