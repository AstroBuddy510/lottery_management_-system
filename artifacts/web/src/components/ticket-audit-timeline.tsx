import { format } from "date-fns";
import {
  Receipt,
  ScanLine,
  Trophy,
  XCircle,
  BadgeCheck,
  Banknote,
  Ban,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type AnomalySeverity = "medium" | "high" | "critical";

export interface Anomaly {
  code: string;
  severity: AnomalySeverity;
  ticketId: string;
  ticketNumber: string;
  detail: string;
  at: string | null;
  writerName?: string | null;
  writerCode?: string | null;
  agentCode?: string | null;
  gameName?: string | null;
  eventNumber?: string | null;
  stakeAmount?: string | null;
}

export interface TicketEvent {
  id: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorRole: string | null;
  actorName: string | null;
  source: string;
  note: string | null;
  occurredAt: string;
}

const EVENT_STYLE: Record<string, { label: string; icon: LucideIcon; tone: string }> = {
  sold: { label: "Sold", icon: Receipt, tone: "text-blue-600 dark:text-blue-400" },
  validated: { label: "Checked", icon: ScanLine, tone: "text-slate-500" },
  settled_won: { label: "Settled — won", icon: Trophy, tone: "text-emerald-600 dark:text-emerald-400" },
  settled_lost: { label: "Settled — lost", icon: XCircle, tone: "text-slate-500" },
  claim_approved: { label: "Claim approved", icon: BadgeCheck, tone: "text-emerald-600 dark:text-emerald-400" },
  claim_rejected: { label: "Claim rejected", icon: XCircle, tone: "text-red-600 dark:text-red-400" },
  paid: { label: "Paid", icon: Banknote, tone: "text-emerald-600 dark:text-emerald-400" },
  voided: { label: "Voided", icon: Ban, tone: "text-red-600 dark:text-red-400" },
  cancelled: { label: "Cancelled", icon: Ban, tone: "text-red-600 dark:text-red-400" },
};

export const SEVERITY_CHIP: Record<AnomalySeverity, string> = {
  critical: "bg-red-500/10 text-red-700 border-red-300/60 dark:text-red-300 dark:border-red-500/30",
  high: "bg-orange-500/10 text-orange-700 border-orange-300/60 dark:text-orange-300 dark:border-orange-500/30",
  medium: "bg-amber-400/10 text-amber-700 border-amber-300/60 dark:text-amber-300 dark:border-amber-500/30",
};

export function AnomalyBadge({ severity, children }: { severity: AnomalySeverity; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
        SEVERITY_CHIP[severity],
      )}
    >
      <ShieldAlert className="h-2.5 w-2.5" />
      {children}
    </span>
  );
}

export function anomalyLabel(code: string): string {
  return code.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * What happened to this ticket, oldest first.
 *
 * The order is the point: it is what makes "checked before it was sold" or
 * "paid twice" visible at a glance rather than something you have to
 * reconstruct from a status column.
 */
export function TicketAuditTimeline({
  events,
  anomalies,
}: {
  events: TicketEvent[];
  anomalies: Anomaly[];
}) {
  if (events.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">
        No history recorded for this ticket. Tickets sold before auditing was switched on have
        none.
      </p>
    );
  }

  const anomalyAt = new Map<string, Anomaly[]>();
  for (const a of anomalies) {
    if (!a.at) continue;
    const list = anomalyAt.get(a.at);
    if (list) list.push(a);
    else anomalyAt.set(a.at, [a]);
  }

  return (
    <ol className="relative space-y-0">
      {events.map((e, i) => {
        const style = EVENT_STYLE[e.eventType] ?? {
          label: e.eventType.replace(/_/g, " "),
          icon: Receipt,
          tone: "text-muted-foreground",
        };
        const Icon = style.icon;
        const flags = anomalyAt.get(e.occurredAt) ?? [];
        const last = i === events.length - 1;

        return (
          <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
            {!last && <span className="absolute left-[11px] top-6 h-full w-px bg-border" />}
            <span
              className={cn(
                "relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-background",
                flags.length ? "border-red-400" : "border-border",
              )}
            >
              <Icon className={cn("h-3 w-3", flags.length ? "text-red-600" : style.tone)} />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-xs font-semibold">{style.label}</span>
                {e.fromStatus && e.toStatus && e.fromStatus !== e.toStatus && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {e.fromStatus} → {e.toStatus}
                  </span>
                )}
                <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
                  {format(new Date(e.occurredAt), "d MMM yyyy, HH:mm:ss")}
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {e.actorName ?? (e.source === "settlement" ? "System" : "—")}
                {e.actorRole ? ` · ${e.actorRole}` : ""}
                <span className="ml-1.5 rounded bg-muted px-1 py-px font-mono text-[9px] uppercase">
                  {e.source}
                </span>
              </div>
              {e.note && <div className="mt-0.5 text-[11px] text-muted-foreground">{e.note}</div>}
              {flags.length > 0 && (
                <div className="mt-1.5 space-y-1">
                  {flags.map((a, j) => (
                    <div key={j} className="flex flex-wrap items-center gap-1.5">
                      <AnomalyBadge severity={a.severity}>{anomalyLabel(a.code)}</AnomalyBadge>
                      <span className="text-[11px] text-red-700 dark:text-red-400">{a.detail}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
