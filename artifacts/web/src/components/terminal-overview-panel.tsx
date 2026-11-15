import { useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Smartphone, CheckCircle, Link2, Activity, Wrench, Settings2 } from "lucide-react";
import type { TerminalWithStatus } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import type { TerminalMetricsShape } from "@/components/terminals-manager";

/**
 * The Inventory overview's terminal panel, drawn the way the Digital Padlock
 * Auditor beside it is drawn: four accent-edged figure cards, a distribution
 * ring, and status buffers.
 *
 * The figure cards read the same TerminalMetricsShape the Terminals tab
 * shows, so the two screens still agree on what "in stock" means. The ring
 * needs slices that add up to the fleet, so it sorts every terminal into
 * exactly one bucket - a device that is somehow both assigned and marked for
 * repair is counted once, where it is (with a writer), not twice.
 */

const COLORS = {
  inStock: "#10b981",
  active: "#6366f1",
  silent: "#f59e0b",
  repair: "#f43f5e",
  other: "#94a3b8",
};

function pct(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function RingTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number }> }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background/95 border border-border shadow-lg p-3 rounded-xl text-xs backdrop-blur-sm">
      <p className="font-semibold text-foreground">{payload[0]!.name}</p>
      <p className="text-muted-foreground font-mono mt-1">
        Count: <span className="font-black text-primary">{payload[0]!.value}</span>
      </p>
    </div>
  );
}

export function TerminalOverviewPanel({
  terminals,
  metrics,
  loading,
  activeWindowMinutes,
  onOpenManagement,
}: {
  terminals: TerminalWithStatus[];
  metrics: TerminalMetricsShape;
  loading: boolean;
  activeWindowMinutes: number;
  onOpenManagement: () => void;
}) {
  const ring = useMemo(() => {
    const b = { inStock: 0, active: 0, silent: 0, repair: 0, other: 0 };
    for (const t of terminals) {
      if (t.writerId) {
        if (t.isActive) b.active++;
        else b.silent++;
      } else if (t.status === "available") b.inStock++;
      else if (t.status === "repair" || ["lost", "retired", "damaged"].includes(t.status)) b.repair++;
      else b.other++;
    }
    return [
      { name: "In Stock", value: b.inStock, color: COLORS.inStock },
      { name: "Assigned · Active", value: b.active, color: COLORS.active },
      { name: "Assigned · Silent", value: b.silent, color: COLORS.silent },
      { name: "Repair / Out of Service", value: b.repair, color: COLORS.repair },
      ...(b.other > 0 ? [{ name: "Other", value: b.other, color: COLORS.other }] : []),
    ];
  }, [terminals]);

  const downCount = metrics.repair + metrics.outOfService;
  const stockRate = pct(metrics.inStock, metrics.total);
  const assignmentRate = pct(metrics.assigned, metrics.total);
  const liveRate = pct(metrics.active, metrics.assigned);
  const downRate = pct(downCount, metrics.total);

  const cards = [
    {
      label: "Registered Terminals",
      value: metrics.total,
      sub: "POS devices on the network",
      color: "text-foreground border-l-slate-300 dark:border-l-slate-700",
    },
    {
      label: "In Stock",
      value: metrics.inStock,
      sub: "Ready to hand to a writer",
      color: "text-emerald-600 dark:text-emerald-400 border-l-emerald-500 font-bold",
    },
    {
      label: "Assigned to Writers",
      value: metrics.assigned,
      sub: `${metrics.active} active · ${metrics.inactive} silent`,
      color: "text-indigo-600 dark:text-indigo-400 border-l-indigo-500 font-bold",
    },
    {
      label: "Repair / Out of Service",
      value: downCount,
      sub: `${metrics.repair} in repair · ${metrics.outOfService} lost or retired`,
      color: "text-rose-600 dark:text-rose-400 border-l-rose-500",
    },
  ];

  const buffers = [
    {
      icon: <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />,
      label: "Stock Availability",
      value: stockRate,
      text: "text-emerald-600 dark:text-emerald-400",
      bar: "[&>div]:bg-emerald-500",
      note: "Unassigned terminals in working order, ready to issue",
    },
    {
      icon: <Link2 className="w-3.5 h-3.5 text-indigo-500" />,
      label: "Assignment Rate",
      value: assignmentRate,
      text: "text-indigo-600 dark:text-indigo-400",
      bar: "[&>div]:bg-indigo-600 dark:[&>div]:bg-indigo-400",
      note: "Share of the fleet currently in a writer's hands",
    },
    {
      icon: <Activity className="w-3.5 h-3.5 text-amber-500" />,
      label: "Live Activity",
      value: liveRate,
      text: "text-amber-600 dark:text-amber-400",
      bar: "[&>div]:bg-amber-500",
      note: `Assigned terminals that sold in the last ${activeWindowMinutes} minutes`,
    },
    {
      icon: <Wrench className="w-3.5 h-3.5 text-rose-500" />,
      label: "Out-of-Service Rate",
      value: downRate,
      text: "text-rose-600 dark:text-rose-400",
      bar: "[&>div]:bg-rose-500",
      note: "In repair, lost, damaged or retired - not available to issue",
    },
  ];

  return (
    <div className="border border-border/80 bg-card rounded-3xl p-6 shadow-sm space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-6 bg-sky-500 rounded-full shadow-glow" />
          <div>
            <h2 className="text-lg font-bold text-foreground">Terminal Overview</h2>
            <p className="text-[11px] text-muted-foreground">POS hardware across the network — stock, assignment and activity</p>
          </div>
        </div>
        <Badge variant="outline" className="text-xs bg-sky-50/50 text-sky-700 dark:bg-sky-950/20 dark:text-sky-400 border-sky-200 dark:border-sky-900">
          <Smartphone className="w-3 h-3 mr-1" /> POS Hardware Network
        </Badge>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {cards.map(c => (
            <div key={c.label} className={`bg-card/45 border-l-4 ${c.color} border border-y-border border-r-border rounded-2xl p-4 shadow-sm hover:shadow-md transition-all duration-300 flex flex-col justify-between min-h-28 min-w-0`}>
              <div className="text-[10px] text-muted-foreground uppercase font-black tracking-wider">{c.label}</div>
              <div className="font-mono text-2xl font-black tracking-tight mt-1">{c.value}</div>
              <div className="text-[10px] text-muted-foreground font-medium mt-1">{c.sub}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
        <div className="lg:col-span-5 border rounded-2xl p-5 bg-card/30 flex flex-col items-center justify-center min-h-[300px]">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4">Fleet Distribution</h3>
          {loading ? (
            <Skeleton className="w-48 h-48 rounded-full" />
          ) : metrics.total === 0 ? (
            <div className="text-xs text-muted-foreground italic">No terminals registered yet</div>
          ) : (
            <div className="w-full h-56 relative flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={ring} cx="50%" cy="50%" innerRadius={65} outerRadius={85} paddingAngle={4} dataKey="value">
                    {ring.map(entry => <Cell key={entry.name} fill={entry.color} />)}
                  </Pie>
                  <Tooltip content={<RingTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute text-center pointer-events-none">
                <span className="text-2xl font-black tracking-tight">{metrics.total}</span>
                <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest mt-0.5">Total</p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 mt-2">
            {ring.map(d => (
              <div key={d.name} className="flex items-center gap-2 text-xs font-bold">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
                <span className="text-muted-foreground">{d.name}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-7 border rounded-2xl p-6 bg-card/30 flex flex-col justify-between">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-6">Fleet Status Buffers</h3>
            <div className="space-y-5">
              {buffers.map(b => (
                <div key={b.label} className="space-y-2">
                  <div className="flex justify-between text-xs font-bold">
                    <span className="text-muted-foreground flex items-center gap-1.5">{b.icon} {b.label}</span>
                    <span className={b.text}>{b.value}%</span>
                  </div>
                  <Progress value={b.value} className={`h-2 bg-muted ${b.bar}`} />
                  <p className="text-[10px] text-muted-foreground font-medium">{b.note}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="border-t pt-4 mt-6 flex flex-wrap justify-between items-center gap-2 text-[11px] text-muted-foreground font-medium">
            <span className="flex items-center gap-1.5"><Settings2 className="w-3.5 h-3.5 text-primary" /> Silent terminals are assigned but have not sold recently.</span>
            <button onClick={onOpenManagement} className="text-[11px] font-semibold text-primary hover:underline">
              Open Terminals Management →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
