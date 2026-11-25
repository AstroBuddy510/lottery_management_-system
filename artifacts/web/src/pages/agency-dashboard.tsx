import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { 
  useListAgents, 
  useUpdateUser, 
  AgentWithUser, 
  getListAgentsQueryKey, 
  useListPayments, 
  Payment,
  getListPaymentsQueryKey,
  useListPadlockAssignments,
  useListTerminals,
  getListTerminalsQueryKey,
  type TerminalWithStatus,
  useGetAgencyRoster,
  getGetAgencyRosterQueryKey,
  type RosterEntry,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { apiGet } from "@/lib/finance-api";
import { Pager } from "@/components/data-kit";
import { useToast } from "@/hooks/use-toast";
import { Map as PigeonMapBase, Overlay, type MapProps } from "pigeon-maps";
import { tileProvider, hasTileKey, TILE_ATTRIBUTION } from "@/lib/map-tiles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  List as ListIcon,
  LayoutGrid,
  Map as MapIcon,
  ChevronLeft,
  ChevronRight,
  Search,
  ArrowUpRight,
  ArrowDownLeft,
  TrendingUp,
  Clock,
  Coins,
  AlertTriangle,
  FileText,
  RefreshCw,
  SlidersHorizontal,
  User,
  MapPin,
  Phone,
  ArrowRight,
  Calendar,
  AlertCircle,
  Flame,
  Smartphone,
  Users,
  KeyRound,
  CircleSlash
} from "lucide-react";

type PigeonMapProps = MapProps & {
  height?: number;
  attribution?: React.ReactNode | false;
  provider?: (x: number, y: number, z: number, dpr?: number) => string;
  children?: React.ReactNode;
};
// Wrap to avoid TS confusing pigeon-maps Map with the global JS Map constructor
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PigeonMap(props: PigeonMapProps) { return React.createElement(PigeonMapBase as any, props); }

/* ─── helpers ─────────────────────────────────────────────────────────────── */

function debtDays(debtSince: string | null | undefined): number | null {
  if (!debtSince) return null;
  return Math.floor((Date.now() - new Date(debtSince).getTime()) / 86_400_000);
}

type AgencyStatus = "active-clear" | "active-debt" | "closed";

function getStatus(a: AgentWithUser): AgencyStatus {
  if (a.status === "closed") return "closed";
  if (parseFloat(a.outstandingDebt) < 0) return "active-debt";
  return "active-clear";
}

const STATUS_CFG = {
  "active-clear": {
    label: "Active — Clear / surplus",
    badge: "bg-emerald-100 text-emerald-700 border-emerald-200",
    border: "border-l-emerald-500",
    iconBg: "bg-emerald-500",
    dot: "bg-emerald-500",
    pin: "#10b981",
  },
  "active-debt": {
    label: "Active — Agent owes Company",
    badge: "bg-amber-100 text-amber-700 border-amber-200",
    border: "border-l-amber-500",
    iconBg: "bg-amber-500",
    dot: "bg-amber-500",
    pin: "#f59e0b",
  },
  "closed": {
    label: "Closed",
    badge: "bg-slate-100 text-slate-500 border-slate-200",
    border: "border-l-slate-400",
    iconBg: "bg-slate-400",
    dot: "bg-slate-400",
    pin: "#94a3b8",
  },
} as const;

function AgingBadge({ debtSince, debt }: { debtSince: string | null | undefined; debt: string }) {
  if (parseFloat(debt) >= 0 || !debtSince) return null;
  const days = debtDays(debtSince) ?? 0;
  const cls = days < 7
    ? "bg-emerald-50 text-emerald-600 border-emerald-200"
    : days < 30
    ? "bg-amber-50 text-amber-600 border-amber-200"
    : "bg-rose-50 text-rose-600 border-rose-200";
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cls}`}>
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
      {days === 0 ? "Today" : `${days}d pending`}
    </span>
  );
}

/* ─── helpers ─────────────────────────────────────────────────────────────── */

function resizeImageToDataUrl(file: File, maxPx: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = reject;
    img.src = url;
  });
}

/* ─── agency icon ─────────────────────────────────────────────────────────── */

function AgencyIcon({ status, size = "md" }: { status: AgencyStatus; size?: "sm" | "md" | "lg" }) {
  const cfg = STATUS_CFG[status];
  const sizes = { sm: "w-8 h-8", md: "w-12 h-12", lg: "w-16 h-16" };
  const icon = { sm: "w-4 h-4", md: "w-6 h-6", lg: "w-8 h-8" };
  return (
    <div className={`${sizes[size]} rounded-2xl ${cfg.iconBg} flex items-center justify-center flex-shrink-0 shadow-md`}>
      <svg className={`${icon[size]} text-white`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
    </div>
  );
}

/* ─── map helpers ─────────────────────────────────────────────────────────── */

function fitBounds(lats: number[], lngs: number[]): { center: [number, number]; zoom: number } {
  if (lats.length === 0) return { center: [7.9465, -1.0232], zoom: 7 };
  if (lats.length === 1) return { center: [lats[0], lngs[0]], zoom: 13 };

  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const center: [number, number] = [(minLat + maxLat) / 2, (minLng + maxLng) / 2];

  const latSpan = maxLat - minLat;
  const lngSpan = maxLng - minLng;
  // Add 40% padding so pins aren't right at the edge
  const padded = Math.max(latSpan, lngSpan) * 1.4;
  // Formula: at zoom z, ~720° of lon-equivalent fits in the viewport
  const zoom = Math.max(5, Math.min(14, Math.floor(Math.log2(720 / Math.max(padded, 0.005)))));
  return { center, zoom };
}

/* ─── custom map pin ──────────────────────────────────────────────────────── */

function PinMarker({
  color, label, code, photo, name, onClick, activePadlock,
}: {
  color: string; label: string; code: string;
  photo?: string | null; name: string; onClick: () => void;
  activePadlock?: { padlockSerialNumber: string; destination: string };
}) {
  const initials = name.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div
      onClick={onClick}
      className="cursor-pointer group"
      style={{ transform: "translate(-50%, -100%)", display: "inline-flex", flexDirection: "column", alignItems: "center" }}
    >
      <style>{`
        @keyframes neon-pulse {
          0% {
            box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.85);
            border-color: rgba(34, 197, 94, 1);
          }
          70% {
            box-shadow: 0 0 16px 8px rgba(34, 197, 94, 0.4);
            border-color: rgba(34, 197, 94, 1);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.85);
            border-color: rgba(34, 197, 94, 1);
          }
        }
        .neon-pulsing-active {
          animation: neon-pulse 1.8s infinite ease-in-out;
          border-color: #22c55e !important;
          background-color: #f0fdf4 !important;
        }
      `}</style>

      {/* Bubble card */}
      <div className={`flex items-center gap-2 bg-white rounded-2xl shadow-xl border border-slate-200 px-2.5 py-1.5 group-hover:shadow-2xl group-hover:-translate-y-0.5 transition-all duration-150 whitespace-nowrap ${activePadlock ? "neon-pulsing-active" : ""}`}>
        {/* Avatar with relative wrapper for corner badge overlay */}
        <div className="relative flex-shrink-0">
          <div
            className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center text-white font-bold text-xs"
            style={{ boxShadow: `0 0 0 2px ${activePadlock ? "#22c55e" : color}` }}
          >
            {photo ? (
              <img src={photo} alt={name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center" style={{ background: color }}>
                {initials || "?"}
              </div>
            )}
          </div>
          {/* Small padlock corner badge */}
          {activePadlock && (
            <div className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border border-white flex items-center justify-center shadow-md">
              <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
          )}
        </div>
        {/* Text */}
        <div style={{ maxWidth: 140 }}>
          <div className="text-[11px] font-bold text-slate-800 leading-tight truncate">{label}</div>
          <div className="text-[9px] font-mono text-slate-400 leading-tight">{code}</div>
          {activePadlock && (
            <div className="mt-1.5 border-t pt-1 border-emerald-100 flex flex-col gap-0.5 text-[9px] font-bold text-emerald-600">
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-ping inline-block" />
                <span>🔒 Padlock: {activePadlock.padlockSerialNumber}</span>
              </div>
              <div className="text-slate-500 font-medium truncate max-w-[120px]" title={activePadlock.destination}>
                📍 Dest: {activePadlock.destination}
              </div>
            </div>
          )}
        </div>
      </div>
      {/* Arrow tip pointing down to the exact location */}
      <div style={{
        width: 0, height: 0,
        borderLeft: "7px solid transparent",
        borderRight: "7px solid transparent",
        borderTop: `8px solid ${activePadlock ? "#f0fdf4" : "white"}`,
        filter: "drop-shadow(0 2px 2px rgba(0,0,0,0.15))",
        marginTop: -1,
      }} />
    </div>
  );
}

/* ─── detail modal ────────────────────────────────────────────────────────── */

function AgencyDetailModal({ agent, onClose }: { agent: AgentWithUser | null; onClose: () => void }) {
  if (!agent) return null;
  const status = getStatus(agent);
  const cfg = STATUS_CFG[status];
  const days = debtDays(agent.debtSince);

  return (
    <Dialog open={!!agent} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-4">
            <AgencyIcon status={status} size="lg" />
            <div>
              <DialogTitle className="text-xl">{agent.agencyName ?? agent.user.fullName}</DialogTitle>
              <code className="text-sm text-muted-foreground font-mono">{agent.fullCode}</code>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Status */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border">
            <span className="text-sm font-medium text-slate-600">Operational Status</span>
            <span className={`text-xs font-bold px-3 py-1 rounded-full border ${cfg.badge}`}>{cfg.label}</span>
          </div>

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-3">
            <InfoCell label="Agent Name" value={agent.user.fullName} />
            <InfoCell label="Phone" value={agent.user.phone ?? "—"} mono />
            <InfoCell label="Agency Name" value={agent.agencyName ?? "—"} />
            <InfoCell label="Agent Code" value={agent.agentCode} mono />
            {agent.location && <InfoCell label="Location" value={agent.location} full />}
          </div>

          {/* Debt section */}
          <div className={`p-4 rounded-xl border-l-4 ${cfg.border} bg-slate-50`}>
            {(() => {
              const val = parseFloat(agent.outstandingDebt || "0");
              const isCompanyOwes = val > 0;
              const isAgentOwes = val < 0;
              const absVal = Math.abs(val);
              return (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-slate-700">
                      {isCompanyOwes ? "Company owes Agent" : isAgentOwes ? "Agent owes Company" : "Clear Balance"}
                    </span>
                    {isAgentOwes && agent.debtSince && (
                      <AgingBadge debtSince={agent.debtSince} debt={agent.outstandingDebt} />
                    )}
                  </div>
                  <div className={`text-2xl font-bold ${isAgentOwes ? "text-amber-600" : "text-emerald-600"}`}>
                    GHS {absVal.toLocaleString("en-GH", { minimumFractionDigits: 2 })}
                  </div>
                  {isAgentOwes && agent.debtSince && (
                    <p className="text-xs text-slate-400 mt-1">
                      Since {new Date(agent.debtSince).toLocaleDateString("en-GH", { day: "numeric", month: "long", year: "numeric" })}
                    </p>
                  )}
                </>
              );
            })()}
          </div>

          {/* Map coords */}
          {(agent.lat && agent.lng) ? (
            <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="11" r="3"/><path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/></svg>
              {parseFloat(agent.lat).toFixed(4)}, {parseFloat(agent.lng).toFixed(4)}
            </div>
          ) : (
            <p className="text-xs text-slate-400 italic">No map coordinates set for this agency.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InfoCell({ label, value, mono, full }: { label: string; value: string; mono?: boolean; full?: boolean }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">{label}</p>
      <p className={`text-sm font-medium text-slate-800 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

/* ─── stat card ───────────────────────────────────────────────────────────── */

function StatCard({
  label,
  value,
  color,
  icon,
  detail,
}: {
  label: string;
  value: React.ReactNode;
  color: string;
  icon: React.ReactNode;
  detail?: string;
}) {
  return (
    <div className="min-w-0 bg-white border rounded-2xl p-4 shadow-sm hover:shadow-md transition-all flex items-start gap-4">
      {/* The icon gives way on narrower screens, where four cards share a row. */}
      <div className={`w-11 h-11 rounded-2xl ${color} hidden sm:flex lg:hidden xl:flex items-center justify-center flex-shrink-0 shadow-sm`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 leading-none">{label}</div>
        <div className="text-lg xl:text-xl font-black text-slate-800 leading-snug whitespace-nowrap">{value}</div>
        {detail && <div className="text-[10px] text-slate-400 mt-1 leading-none font-medium">{detail}</div>}
      </div>
    </div>
  );
}

/* ─── last payment badge ─────────────────────────────────────────────────── */

function LastPaymentBadge({ payment }: { payment?: Payment }) {
  const [, setLocation] = useLocation();

  if (!payment) {
    return (
      <span className="text-[11px] text-slate-400 italic flex items-center gap-1">
        <Clock className="w-3.5 h-3.5 opacity-60" /> No payments yet
      </span>
    );
  }

  const isPayIn = payment.transactionType === "pay_in";
  const amountVal = parseFloat(payment.amount);
  const paymentDateOnly = payment.paymentDate?.split("T")[0] || "";

  const handleAmountClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setLocation(`/payments?agentId=${payment.agentId}&dateFrom=${paymentDateOnly}&dateTo=${paymentDateOnly}`);
  };
  
  return (
    <div className="flex items-center gap-1.5 text-xs">
      {isPayIn ? (
        <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
      ) : (
        <ArrowUpRight className="w-3.5 h-3.5 text-rose-500 flex-shrink-0" />
      )}
      <button
        onClick={handleAmountClick}
        className="font-semibold text-slate-700 hover:text-primary hover:underline text-left focus:outline-none transition-colors"
        title="Click to view transaction on Payments page"
      >
        {isPayIn ? "Pay-in" : "Pay-out"}: <strong className="font-mono text-primary group-hover:text-primary-hover">GHS {amountVal.toLocaleString("en-GH", { minimumFractionDigits: 2 })}</strong>
      </button>
      <span className="text-[10px] text-slate-400 flex-shrink-0">
        • {new Date(payment.paymentDate).toLocaleDateString("en-GH", { day: "numeric", month: "short" })}
      </span>
    </div>
  );
}

/* ─── roster badges and their breakdown ───────────────────────────────────── */

/**
 * Headcount and devices, on the agency card.
 *
 * Two numbers a supervisor otherwise had to go and count: how many writers
 * this agency runs, and how many of them are actually holding a device. The
 * gap between the two is the point - six writers and two terminals is four
 * people who cannot sell - so the badges sit side by side rather than in
 * different corners of the card.
 *
 * Each badge is a button, not decoration. The card underneath opens the
 * agency's financial detail, so these stop their click from reaching it.
 */
function RosterBadges({
  agent, onOpen,
}: {
  agent: AgentWithUser & { writerCount?: number; activeWriterCount?: number; terminalCount?: number };
  onOpen: (agent: AgentWithUser, tab: "writers" | "terminals") => void;
}) {
  const writers = agent.writerCount ?? 0;
  const terminals = agent.terminalCount ?? 0;
  const unequipped = Math.max(0, writers - terminals);

  const badge = (
    kind: "writers" | "terminals",
    Icon: typeof Users,
    count: number,
    title: string,
  ) => (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onOpen(agent, kind); }}
      title={title}
      aria-label={title}
      className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-slate-200 bg-slate-50/80 hover:bg-slate-100 hover:border-slate-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
    >
      <Icon className="w-3.5 h-3.5 text-slate-500" />
      <span className="text-xs font-bold text-slate-700 tabular-nums">{count}</span>
    </button>
  );

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {badge("writers", Users, writers, `${writers} writer${writers === 1 ? "" : "s"} — click for the list`)}
      {badge("terminals", Smartphone, terminals, `${terminals} terminal${terminals === 1 ? "" : "s"} issued — click for the list`)}
      {/* Said in words rather than left as arithmetic between two badges. */}
      {unequipped > 0 && (
        <span
          className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-1 rounded-lg"
          title={`${unequipped} writer${unequipped === 1 ? " has" : "s have"} no terminal`}
        >
          {unequipped} without
        </span>
      )}
    </div>
  );
}

/** The window the rest of the dashboard uses for "active". */
const ROSTER_ACTIVE_MINUTES = 60;

function RosterDialog({
  agent, tab, onClose, onOpenWriter,
}: {
  agent: AgentWithUser | null;
  tab: "writers" | "terminals";
  onClose: () => void;
  onOpenWriter: (writerId: string) => void;
}) {
  const agentId = agent?.id ?? "";
  const { data, isLoading } = useGetAgencyRoster(agentId, {
    query: { queryKey: getGetAgencyRosterQueryKey(agentId), enabled: !!agentId },
  });
  const rows: RosterEntry[] = Array.isArray(data) ? data : [];
  const withTerminal = rows.filter(r => !!r.terminalId);
  const shown = tab === "terminals" ? withTerminal : rows;

  const isActive = (r: RosterEntry) =>
    !!r.lastSaleAt && Date.now() - new Date(r.lastSaleAt).getTime() < ROSTER_ACTIVE_MINUTES * 60_000;

  return (
    <Dialog open={!!agent} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {tab === "terminals" ? "Devices" : "Writers"} — {agent?.agencyName ?? agent?.user.fullName}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          <span className="font-mono">{agent?.fullCode}</span> ·{" "}
          {rows.length} writer{rows.length === 1 ? "" : "s"} · {withTerminal.length} holding a device
        </p>

        <div className="max-h-[60vh] overflow-y-auto -mx-2 px-2">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              {tab === "terminals" ? "No devices issued to this agency yet." : "No writers under this agency yet."}
            </p>
          ) : (
            <div className="space-y-1.5">
              {shown.map(r => (
                <button
                  key={r.writerId}
                  type="button"
                  onClick={() => onOpenWriter(r.writerId)}
                  className="w-full text-left flex items-center gap-3 p-2.5 rounded-xl border hover:bg-slate-50 hover:border-slate-300 transition-colors"
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: isActive(r) ? "#22c55e" : "#ef4444" }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800 truncate">{r.fullName}</span>
                      <code className="text-[10px] text-slate-400 font-mono">{r.fullCode}</code>
                      {!r.isActive && (
                        <span className="text-[9px] font-bold uppercase text-slate-500 bg-slate-100 px-1.5 py-px rounded">
                          Disabled
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {r.location ?? "No location"}
                      {r.phone ? ` · ${r.phone}` : ""}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {r.terminalId ? (
                      <>
                        <div className="font-mono text-[11px] font-semibold text-slate-700">{r.serialNumber}</div>
                        <div className="text-[10px] text-slate-400">{r.brand} {r.model}</div>
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700">
                        <CircleSlash className="w-3 h-3" /> No device
                      </span>
                    )}
                    {!r.hasPin && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 mt-0.5">
                        <KeyRound className="w-3 h-3" /> No PIN
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── commission wallet ───────────────────────────────────────────────────── */

/** One agency's commission, as /finance/commissions/wallets reports it. */
export interface CommissionWallet {
  agentId: string;
  totalEarned: number;
  earnedClosed: number;
  currentWeek: number;
  paid: number;
  pending: number;
  /** Earned and not yet paid out, the running week included. */
  accrued: number;
  /** Closed weeks, less what is paid or already requested. */
  available: number;
}

const ghsFmt = (v: number) => `GHS ${v.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function walletTitle(w?: CommissionWallet): string {
  if (!w) return "No commission earned yet";
  return [
    `Accrued (unpaid): ${ghsFmt(w.accrued)}`,
    `This week, accruing: ${ghsFmt(w.currentWeek)}`,
    `Available to request: ${ghsFmt(Math.max(0, w.available))}`,
    `Requested, pending: ${ghsFmt(w.pending)}`,
    `Paid to date: ${ghsFmt(w.paid)}`,
  ].join("\n");
}

/** The commission the company owes this agency, with its wallet icon. */
function CommissionWalletBadge({ wallet, loading, compact }: { wallet?: CommissionWallet; loading?: boolean; compact?: boolean }) {
  const accrued = wallet?.accrued ?? 0;
  if (compact) {
    return (
      <div className="flex items-center gap-2" title={walletTitle(wallet)}>
        <span className="w-7 h-7 rounded-lg bg-violet-50 text-violet-600 border border-violet-100 flex items-center justify-center flex-shrink-0">
          <Wallet className="w-3.5 h-3.5" />
        </span>
        <div className="min-w-0">
          <div className="font-mono font-bold text-slate-800 whitespace-nowrap">{loading ? "…" : ghsFmt(accrued)}</div>
          {wallet && wallet.currentWeek > 0 && (
            <div className="text-[10px] text-slate-400 whitespace-nowrap">{ghsFmt(wallet.currentWeek)} this week</div>
          )}
        </div>
      </div>
    );
  }
  return (
    // Label over amount, so the figure keeps the card's full width even when
    // four cards share a row on a laptop.
    <div className="rounded-xl border border-violet-100 bg-violet-50/60 px-3 py-2.5" title={walletTitle(wallet)}>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="w-6 h-6 rounded-md bg-white text-violet-600 shadow-sm border border-violet-100 flex items-center justify-center flex-shrink-0">
          <Wallet className="w-3.5 h-3.5" />
        </span>
        <span className="text-[9px] text-violet-500 font-bold uppercase tracking-wider truncate">
          {/* Four to a row on a laptop leaves room for one word only. */}
          <span className="lg:hidden xl:inline">Commission accrued</span>
          <span className="hidden lg:inline xl:hidden">Commission</span>
        </span>
      </div>
      <div className="mt-1.5 font-mono font-bold text-[15px] leading-tight text-violet-700 whitespace-nowrap">{loading ? "…" : ghsFmt(accrued)}</div>
      <div className="text-[10px] text-slate-400 truncate">
        {loading ? "\u00a0" : wallet && wallet.currentWeek > 0 ? `incl. ${ghsFmt(wallet.currentWeek)} this week` : "nothing accruing this week"}
      </div>
    </div>
  );
}

/* ─── grid view ───────────────────────────────────────────────────────────── */

function GridView({
  agents,
  lastPaymentsMap,
  walletMap,
  walletsLoading,
  onSelect,
  onPhotoClick,
  onOpenRoster,
}: {
  agents: AgentWithUser[];
  lastPaymentsMap: Record<string, Payment>;
  walletMap: Record<string, CommissionWallet>;
  walletsLoading?: boolean;
  onSelect: (a: AgentWithUser) => void;
  onPhotoClick: (a: AgentWithUser) => void;
  onOpenRoster: (a: AgentWithUser, tab: "writers" | "terminals") => void;
}) {
  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-400">
        <AlertCircle className="w-14 h-14 mb-4 opacity-30" />
        <p className="font-medium text-slate-500">No agencies match this filter</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {agents.map(a => {
        const status = getStatus(a);
        const cfg = STATUS_CFG[status];
        const debt = parseFloat(a.outstandingDebt);
        const photo = (a.user as { profilePicture?: string | null }).profilePicture;
        const lastPayment = lastPaymentsMap[a.id];
        return (
          <div
            key={a.id}
            onClick={() => onSelect(a)}
            className={`group min-w-0 bg-white border border-l-4 ${cfg.border} rounded-2xl p-4 shadow-sm hover:shadow-lg transition-all duration-200 cursor-pointer hover:-translate-y-0.5 flex flex-col justify-between`}
          >
            <div>
              {/* Header row */}
              <div className="flex items-start justify-between gap-2 mb-3">
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); onPhotoClick(a); }}
                  className="relative group/icon flex-shrink-0 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                  aria-label="Change agency profile photo"
                  title="Click to change photo"
                >
                  {photo ? (
                    <img
                      src={photo}
                      alt={a.agencyName ?? a.user.fullName}
                      className="w-12 h-12 rounded-2xl object-cover shadow-sm border border-slate-100"
                    />
                  ) : (
                    <AgencyIcon status={status} size="md" />
                  )}
                  <span className="absolute inset-0 rounded-2xl flex items-center justify-center bg-black/40 opacity-0 group-hover/icon:opacity-100 transition-opacity">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                      <circle cx="12" cy="13" r="4"/>
                    </svg>
                  </span>
                </button>
                <span className={`text-[10px] font-bold px-2 py-1 rounded-full border whitespace-nowrap ${cfg.badge}`}>
                  {status === "active-clear" ? "Clear" : status === "active-debt" ? "Has Debt" : "Closed"}
                </span>
              </div>

              {/* Agency name */}
              <h3 className="font-bold text-slate-800 text-base leading-tight mb-0.5 group-hover:text-slate-900 truncate">
                {a.agencyName ?? a.user.fullName}
              </h3>
              <code className="text-xs text-slate-400 font-mono">{a.fullCode}</code>

              {/* Location */}
              {a.location && (
                <div className="flex items-center gap-1 mt-2 text-xs text-slate-500 truncate font-medium">
                  <MapPin className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                  {a.location}
                </div>
              )}

              {/* Who works here and what they are holding. */}
              <div className="mt-3">
                <RosterBadges agent={a} onOpen={onOpenRoster} />
              </div>

              {/* Commission the company owes the agency, earned on its writers'
                  sales. In the top block so it lines up across a row. */}
              <div className="mt-3">
                <CommissionWalletBadge wallet={walletMap[a.id]} loading={walletsLoading} />
              </div>
            </div>

            <div className="mt-3 space-y-3">
              {/* Last Transaction Box */}
              <div className="bg-slate-50/75 p-2.5 rounded-xl border border-slate-100/50">
                <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mb-1">
                  Last Transaction
                </div>
                <LastPaymentBadge payment={lastPayment} />
              </div>

              {/* Debt section */}
              <div className={`pt-3 border-t ${debt < 0 ? "border-amber-100" : "border-slate-100"}`}>
                {debt < 0 ? (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <span className="text-xs text-slate-500">Agent owes Company</span>
                      <AgingBadge debtSince={a.debtSince} debt={a.outstandingDebt} />
                    </div>
                    <div className="text-base font-bold text-amber-600 mt-0.5 font-mono truncate">
                      GHS {Math.abs(debt).toLocaleString("en-GH", { minimumFractionDigits: 2 })}
                    </div>
                  </>
                ) : debt > 0 ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500">Company owes Agent</span>
                    </div>
                    <div className="text-base font-bold text-emerald-600 mt-0.5 font-mono truncate">
                      GHS {debt.toLocaleString("en-GH", { minimumFractionDigits: 2 })}
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-1.5 text-emerald-600 text-xs font-semibold">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><polyline points="20 6 9 17 4 12"/></svg>
                    Clear Balance
                  </div>
                )}
              </div>

              {/* Agent info footer */}
              <div className="pt-2.5 border-t border-slate-100 flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-600 flex-shrink-0">
                  {a.user.fullName.charAt(0)}
                </div>
                <span className="text-xs text-slate-500 truncate font-semibold">{a.user.fullName}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── list view ───────────────────────────────────────────────────────────── */

function ListView({
  agents,
  lastPaymentsMap,
  walletMap,
  walletsLoading,
  onSelect,
  onPhotoClick,
  onOpenRoster,
}: {
  agents: AgentWithUser[];
  lastPaymentsMap: Record<string, Payment>;
  walletMap: Record<string, CommissionWallet>;
  walletsLoading?: boolean;
  onSelect: (a: AgentWithUser) => void;
  onPhotoClick: (a: AgentWithUser) => void;
  onOpenRoster: (a: AgentWithUser, tab: "writers" | "terminals") => void;
}) {
  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-400">
        <AlertCircle className="w-14 h-14 mb-4 opacity-30" />
        <p className="font-medium text-slate-500">No agencies match this filter</p>
      </div>
    );
  }

  return (
    <div className="bg-white border rounded-2xl overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm text-slate-600">
          <thead className="bg-slate-50/75 border-b text-slate-400 text-[10px] font-bold uppercase tracking-wider">
            <tr>
              <th className="px-6 py-4">Agency</th>
              <th className="px-6 py-4">Agent Name & Phone</th>
              <th className="px-6 py-4">Location</th>
              <th className="px-6 py-4">Team</th>
              <th className="px-6 py-4">Last Transaction</th>
              <th className="px-6 py-4">Commission</th>
              <th className="px-6 py-4">Balance / Debt</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {agents.map(a => {
              const status = getStatus(a);
              const cfg = STATUS_CFG[status];
              const debt = parseFloat(a.outstandingDebt);
              const photo = (a.user as { profilePicture?: string | null }).profilePicture;
              const lastPayment = lastPaymentsMap[a.id];

              return (
                <tr
                  key={a.id}
                  onClick={() => onSelect(a)}
                  className="hover:bg-slate-50/50 transition-colors cursor-pointer group"
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          onPhotoClick(a);
                        }}
                        className="relative group/icon flex-shrink-0 focus:outline-none rounded-xl"
                        title="Click to change photo"
                      >
                        {photo ? (
                          <img
                            src={photo}
                            alt={a.agencyName ?? a.user.fullName}
                            className="w-10 h-10 rounded-xl object-cover shadow-sm border border-slate-100"
                          />
                        ) : (
                          <div className={`w-10 h-10 rounded-xl ${cfg.iconBg} flex items-center justify-center text-white font-bold text-sm shadow-sm`}>
                            <User className="w-5 h-5" />
                          </div>
                        )}
                        <span className="absolute inset-0 rounded-xl flex items-center justify-center bg-black/40 opacity-0 group-hover/icon:opacity-100 transition-opacity">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                            <circle cx="12" cy="13" r="4"/>
                          </svg>
                        </span>
                      </button>
                      <div>
                        <div className="font-bold text-slate-800 leading-snug group-hover:text-slate-900">
                          {a.agencyName ?? a.user.fullName}
                        </div>
                        <div className="text-xs text-slate-400 font-mono mt-0.5">{a.fullCode}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-slate-700 font-semibold">{a.user.fullName}</div>
                    <div className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                      <Phone className="w-3 h-3" /> {a.user.phone ?? "—"}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {a.location ? (
                      <div className="flex items-center gap-1 text-slate-600 font-medium">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                        <span className="truncate max-w-[150px]">{a.location}</span>
                      </div>
                    ) : (
                      <span className="text-slate-400 italic text-xs">No location</span>
                    )}
                  </td>
                  {/* Same two badges as the grid card, so switching view does
                      not lose the headcount. */}
                  <td className="px-6 py-4">
                    <RosterBadges agent={a} onOpen={onOpenRoster} />
                  </td>
                  <td className="px-6 py-4">
                    <LastPaymentBadge payment={lastPayment} />
                  </td>
                  <td className="px-6 py-4">
                    <CommissionWalletBadge wallet={walletMap[a.id]} loading={walletsLoading} compact />
                  </td>
                  <td className="px-6 py-4">
                    {debt < 0 ? (
                      <div className="space-y-1">
                        <div className="text-amber-600 font-bold font-mono">
                          GHS {Math.abs(debt).toLocaleString("en-GH", { minimumFractionDigits: 2 })}
                        </div>
                        <AgingBadge debtSince={a.debtSince} debt={a.outstandingDebt} />
                      </div>
                    ) : debt > 0 ? (
                      <div className="text-emerald-600 font-bold font-mono">
                        GHS {debt.toLocaleString("en-GH", { minimumFractionDigits: 2 })}
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Clear Balance
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(a);
                      }}
                      className="h-8 text-xs font-semibold text-slate-500 hover:text-slate-900 rounded-lg"
                    >
                      Details <ArrowRight className="w-3 h-3 ml-1" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── map view ────────────────────────────────────────────────────────────── */

function MapView({
  agents,
  onSelect,
  activeAssignmentsMap = {},
}: {
  agents: AgentWithUser[];
  onSelect: (a: AgentWithUser) => void;
  activeAssignmentsMap?: Record<string, any>;
}) {
  const mapped   = agents.filter(a => a.lat && a.lng);
  const unmapped = agents.filter(a => !a.lat || !a.lng);

  // Derive the bounding box key so we can re-fit when agencies change
  const boundsKey = mapped.map(a => `${a.id}:${a.lat},${a.lng}`).join("|");

  const computeFit = useCallback(() => {
    const lats = mapped.map(a => parseFloat(a.lat!));
    const lngs = mapped.map(a => parseFloat(a.lng!));
    return fitBounds(lats, lngs);
  }, [boundsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const [center, setCenter] = useState<[number, number]>(() => computeFit().center);
  const [zoom,   setZoom]   = useState<number>(() => computeFit().zoom);

  // Re-fit whenever the set of mapped agencies (or their coords) changes
  useEffect(() => {
    const fit = computeFit();
    setCenter(fit.center);
    setZoom(fit.zoom);
  }, [boundsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFitAll = () => {
    const fit = computeFit();
    setCenter(fit.center);
    setZoom(fit.zoom);
  };

  return (
    <div className="space-y-4">
      {unmapped.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
          <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span><strong>{unmapped.length}</strong> {unmapped.length === 1 ? "agency has" : "agencies have"} no coordinates set and won't appear on the map: {unmapped.map(a => a.fullCode).join(", ")}</span>
        </div>
      )}

      {/* No key, no tiles. Say so, rather than rendering 520px of grey and
          letting someone spend an afternoon on it - which is exactly what the
          CSP and the OSM block each cost once already. */}
      {!hasTileKey() ? (
        <div
          className="rounded-2xl border border-amber-200 bg-amber-50/60 flex items-center justify-center text-center px-6"
          style={{ height: 520 }}
        >
          <div className="max-w-md space-y-2">
            <p className="text-sm font-semibold text-amber-800">Map tiles are not configured</p>
            <p className="text-xs text-amber-700">
              VITE_MAPTILER_KEY is not set for this deployment, so there is no tile
              source to draw. The {mapped.length} mapped {mapped.length === 1 ? "agency is" : "agencies are"} listed below and
              their coordinates are fine - only the basemap is missing.
            </p>
            <p className="text-[11px] text-amber-600">
              Set it in Vercel &rarr; Project &rarr; Settings &rarr; Environment Variables, then redeploy.
            </p>
          </div>
        </div>
      ) : (
      <div className="relative rounded-2xl overflow-hidden border shadow-sm" style={{ height: 520 }}>
        <PigeonMap
          center={center}
          zoom={zoom}
          provider={tileProvider}
          attribution={<span className="text-[10px] text-slate-500">{TILE_ATTRIBUTION}</span>}
          onBoundsChanged={({ center: c, zoom: z }) => { setCenter(c as [number, number]); setZoom(z); }}
        >
          {mapped.map(a => {
            const status = getStatus(a);
            const color = STATUS_CFG[status].pin;
            const photo = (a.user as { profilePicture?: string | null }).profilePicture;
            const label = a.agencyName ?? a.user.fullName;
            const activePadlock = activeAssignmentsMap[a.id];
            return (
              <Overlay
                key={a.id}
                anchor={[parseFloat(a.lat!), parseFloat(a.lng!)] as [number, number]}
              >
                <PinMarker
                  color={color}
                  label={label}
                  code={a.fullCode}
                  photo={photo}
                  name={a.user.fullName}
                  onClick={() => onSelect(a)}
                  activePadlock={activePadlock}
                />
              </Overlay>
            );
          })}
        </PigeonMap>

        {/* Fit-all button — top-right corner of the map */}
        {mapped.length > 0 && (
          <button
            onClick={handleFitAll}
            title="Fit all agencies"
            className="absolute top-3 right-3 z-10 bg-white border border-slate-200 shadow-md rounded-xl px-3 py-2 flex items-center gap-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
            </svg>
            Fit all
          </button>
        )}
      </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-6 px-1">
        {(["active-clear", "active-debt", "closed"] as AgencyStatus[]).map(s => (
          <div key={s} className="flex items-center gap-2 text-xs text-slate-600">
            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: STATUS_CFG[s].pin }} />
            {STATUS_CFG[s].label}
          </div>
        ))}
      </div>

      {/* Map pins summary */}
      {mapped.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {mapped.map(a => {
            const status = getStatus(a);
            const cfg = STATUS_CFG[status];
            const photo = (a.user as { profilePicture?: string | null }).profilePicture;
            const initials = a.user.fullName.split(" ").filter(Boolean).map((w: string) => w[0]).slice(0, 2).join("").toUpperCase();
            return (
              <button
                key={a.id}
                onClick={() => onSelect(a)}
                className={`flex items-center gap-2.5 p-2.5 bg-white border border-l-4 ${cfg.border} rounded-xl text-left hover:shadow-md transition-all`}
              >
                <div
                  className="w-7 h-7 rounded-full flex-shrink-0 overflow-hidden flex items-center justify-center text-white font-bold text-[10px]"
                  style={{ boxShadow: `0 0 0 1.5px ${cfg.pin}` }}
                >
                  {photo ? (
                    <img src={photo} alt={a.user.fullName} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center" style={{ background: cfg.pin }}>
                      {initials}
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-800 truncate">{a.agencyName ?? a.user.fullName}</p>
                  <p className="text-[10px] text-slate-400 font-mono">{a.fullCode}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── terminal map ────────────────────────────────────────────────────────── */

/**
 * One assigned terminal, marked where its writer works.
 *
 * A small dot and the writer's code, nothing more. The four-line card this
 * replaces was legible but it was also 170px wide, and a dozen of them over
 * Accra covered the city they were meant to describe - markers overlapped each
 * other and hid the streets, so the map stopped being a map. What stays on
 * screen permanently is the minimum that still identifies somebody: the code,
 * which is what a supervisor knows a person by.
 *
 * Everything else moves to hover, where it costs nothing until it is wanted,
 * and the whole marker is a link to that writer's profile.
 *
 * Green means the writer has sold within the active window; red means the
 * device is issued and silent. Colour is never the only signal - the hover
 * card and the title both spell the state out in words - because a red/green
 * pair is the most common form of colour blindness.
 */
function TerminalPin({
  terminal, highlighted = false, hovered = false, onHover, onOpen,
}: {
  terminal: TerminalWithStatus;
  highlighted?: boolean;
  hovered?: boolean;
  onHover: (id: string | null) => void;
  onOpen: (writerId: string) => void;
}) {
  const active = terminal.isActive;
  const ring = active ? "#22c55e" : "#ef4444";
  const label = `${terminal.writerCode} — ${terminal.writerName}\n${terminal.serialNumber} (${terminal.brand} ${terminal.model})\n${active ? "Active" : "Inactive"}${terminal.writerLocation ? `\n${terminal.writerLocation}` : ""}`;

  return (
    <div
      style={{
        transform: "translate(-50%, -100%)",
        position: "relative",
        /*
         * Only the drawn marker catches the pointer.
         *
         * pigeon-maps keeps each Overlay's wrapper at the anchor point while
         * the content above translates itself up and left to sit over it. The
         * wrapper is left behind as an empty, still-hit-testable box below and
         * right of the marker - and with markers a few hundred metres apart,
         * those empty boxes land squarely on their neighbours' labels and
         * swallow the click. Caught by elementFromPoint returning
         * .pigeon-click-block where a label plainly was.
         *
         * So the wrapper is made transparent to the pointer (see the Overlay)
         * and only this content takes it back.
         */
        pointerEvents: "auto",
      }}
      onMouseEnter={() => onHover(terminal.id)}
      onMouseLeave={() => onHover(null)}
    >
      {/* The card. Rendered above the marker so it never covers the point it
          describes, and pointer-events off so moving onto it is not required
          and cannot flicker the hover off. */}
      {hovered && (
        <div
          className="absolute left-1/2 bottom-full mb-2 -translate-x-1/2 w-60 rounded-xl bg-white shadow-xl border px-3 py-2.5 text-left pointer-events-none"
          style={{ borderColor: ring }}
        >
          <div className="flex items-center gap-1.5">
            <span className="inline-block rounded-full" style={{ width: 8, height: 8, background: ring }} aria-hidden="true" />
            <span className="font-mono text-xs font-bold text-slate-800">{terminal.writerCode}</span>
            <span className="text-[9px] font-bold uppercase ml-auto" style={{ color: ring }}>
              {active ? "Active" : "Idle"}
            </span>
          </div>
          <p className="text-sm font-semibold text-slate-800 mt-1 truncate">{terminal.writerName}</p>
          {terminal.writerLocation && (
            <p className="text-[11px] text-slate-500 truncate">{terminal.writerLocation}</p>
          )}
          <div className="border-t mt-2 pt-2 space-y-0.5">
            <p className="font-mono text-[11px] font-semibold text-slate-700">{terminal.serialNumber}</p>
            <p className="text-[10px] text-slate-500">{terminal.brand} {terminal.model}</p>
            <p className="text-[10px] text-slate-500">
              {terminal.lastSaleAt
                ? `Last sale ${relativeTime(terminal.lastSaleAt)} · ${terminal.salesToday} today`
                : "No sales recorded"}
            </p>
            {terminal.agentCode && (
              <p className="text-[10px] text-slate-400 font-mono">{terminal.agentCode}</p>
            )}
          </div>
          <p className="text-[10px] text-sky-600 font-semibold mt-1.5">Click to open this writer</p>
        </div>
      )}

      <button
        type="button"
        title={label}
        aria-label={label}
        onClick={() => terminal.writerId && onOpen(terminal.writerId)}
        className="flex flex-col items-center cursor-pointer bg-transparent border-0 p-0"
      >
        {/* The label that always shows. A pill, so it stays readable over any
            tile, and narrow enough that neighbours rarely collide. */}
        <span
          className={`font-mono text-[10px] font-bold px-1.5 py-px rounded bg-white/95 shadow-sm whitespace-nowrap mb-0.5 ${highlighted ? "ring-2 ring-sky-400" : ""}`}
          style={{ color: ring, border: `1px solid ${ring}` }}
        >
          {terminal.writerCode}
        </span>
        <span
          className={`block rounded-full ${highlighted ? "ring-4 ring-sky-400/60" : ""}`}
          style={{
            width: hovered ? 14 : 10,
            height: hovered ? 14 : 10,
            background: ring,
            border: "2px solid white",
            boxShadow: "0 1px 3px rgba(0,0,0,.4)",
            transition: "width .1s, height .1s",
          }}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}

/** "14 min ago". Used on the hover card, where an exact timestamp is noise. */
function relativeTime(ts: string | Date | null | undefined): string {
  if (!ts) return "never";
  const then = new Date(ts).getTime();
  if (!Number.isFinite(then)) return "never";
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * How wide an idle blob should be drawn, in pixels, to cover a fixed distance
 * on the ground.
 *
 * A fixed pixel radius would be meaningless: zoomed out it would shade half of
 * Ghana, zoomed in it would be a dot. This keeps each blob at roughly 1.2km so
 * the shading means the same thing at every zoom, clamped so it stays visible
 * when zoomed far out and does not swallow the screen when zoomed in.
 */
function heatRadiusPx(zoom: number, lat: number): number {
  const metresPerPixel = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
  if (!Number.isFinite(metresPerPixel) || metresPerPixel <= 0) return 80;
  return Math.max(36, Math.min(300, 1200 / metresPerPixel));
}

/**
 * Where the company's assigned hardware physically is.
 *
 * Only terminals that are both assigned and whose writer has coordinates can
 * be drawn. Everything excluded is counted and named underneath, because a map
 * that quietly omits half the estate is worse than one that admits it: a
 * supervisor needs to know whether "six pins" means six terminals or six of
 * nineteen.
 */
function TerminalMapView({ focusId }: { focusId?: string }) {
  const [, navigate] = useLocation();
  const params = { activeWindowMinutes: 60 };
  const { data, isLoading, error } = useListTerminals(params, {
    query: { queryKey: getListTerminalsQueryKey(params), refetchInterval: 30_000, refetchOnWindowFocus: true },
  });
  const all: TerminalWithStatus[] = Array.isArray(data) ? data : [];

  const [hoverId, setHoverId] = useState<string | null>(null);
  const [agencyFilter, setAgencyFilter] = useState<string>("all");
  const [showHeat, setShowHeat] = useState(false);

  /*
   * Agencies to choose between, built from the terminals themselves rather
   * than from the agency list: an agency with no terminals has nothing to show
   * on this map, and offering it as a filter only produces an empty screen.
   */
  const agencies = useMemo(() => {
    const seen = new Map<string, string>();
    for (const t of all) {
      if (t.agentId && !seen.has(t.agentId)) {
        seen.set(t.agentId, t.agencyName ? `${t.agencyName} (${t.agentCode})` : (t.agentCode ?? ""));
      }
    }
    return [...seen].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [all]);

  const terminals = useMemo(
    () => (agencyFilter === "all" ? all : all.filter(t => t.agentId === agencyFilter)),
    [all, agencyFilter],
  );

  const mapped = useMemo(
    () => terminals.filter(t => t.writerId && t.writerLat && t.writerLng),
    [terminals],
  );
  /*
   * Two different problems, which this used to report as one.
   *
   * A pin needs coordinates, so the filter above is on lat/lng - but the
   * message underneath said "no location set", which is false and misleading
   * for a writer who has "Manet Junction" saved and simply never got a pin.
   * The operator reads that, opens the writer, sees a location, and concludes
   * the map is broken. They are two separate jobs: one writer needs a location
   * typed, the other needs a pin dropped on an address already recorded.
   */
  const locationNoPin = useMemo(
    () => terminals.filter(t => t.writerId && (!t.writerLat || !t.writerLng) && !!t.writerLocation?.trim()),
    [terminals],
  );
  const noLocationAtAll = useMemo(
    () => terminals.filter(t => t.writerId && (!t.writerLat || !t.writerLng) && !t.writerLocation?.trim()),
    [terminals],
  );
  const unmappedAssigned = locationNoPin.length + noLocationAtAll.length;
  const inStock = useMemo(() => terminals.filter(t => !t.writerId), [terminals]);

  const boundsKey = mapped.map(t => `${t.id}:${t.writerLat},${t.writerLng}`).join("|");
  const computeFit = useCallback(
    () => fitBounds(mapped.map(t => parseFloat(t.writerLat!)), mapped.map(t => parseFloat(t.writerLng!))),
    [boundsKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [center, setCenter] = useState<[number, number]>(() => computeFit().center);
  const [zoom, setZoom] = useState<number>(() => computeFit().zoom);
  useEffect(() => {
    const fit = computeFit();
    setCenter(fit.center);
    setZoom(fit.zoom);
  }, [boundsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeCount = mapped.filter(t => t.isActive).length;
  /* Issued and silent. Stock is not idle - it is in a cupboard. */
  const mappedIdle = useMemo(() => mapped.filter(t => !t.isActive), [mapped]);
  const mappedIdleCount = mappedIdle.length;
  const focused = focusId ? mapped.find(t => t.id === focusId) : undefined;

  /*
   * Arriving from the registry's Location link, centre on that one terminal.
   *
   * Deliberately only on arrival: re-centring every time the 30-second refresh
   * lands would drag the map back from wherever the viewer had panned to.
   */
  useEffect(() => {
    if (!focused?.writerLat || !focused.writerLng) return;
    setCenter([parseFloat(focused.writerLat), parseFloat(focused.writerLng)]);
    setZoom(15);
  }, [focused?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 flex-wrap px-1">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
          {activeCount} active
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
          {mapped.length - activeCount} idle
        </span>
        <span className="text-xs text-muted-foreground">
          Active = the holding writer sold within the last 60 minutes. Refreshes every 30s.
        </span>

        {/* Controls sit on this row, to the right, because they qualify
            exactly what the counts to their left are counting. */}
        <div className="ml-auto flex items-center gap-2">
          <Select value={agencyFilter} onValueChange={setAgencyFilter}>
            <SelectTrigger className="h-8 w-[200px] text-xs">
              <SelectValue placeholder="All agencies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All agencies</SelectItem>
              {agencies.map(a => (
                <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant={showHeat ? "default" : "outline"}
            className="h-8 text-xs"
            aria-pressed={showHeat}
            onClick={() => setShowHeat(v => !v)}
            title="Shade where terminals are issued but silent"
          >
            <Flame className="w-3.5 h-3.5 mr-1.5" />
            Idle heat
          </Button>
        </div>
      </div>

      {showHeat && (
        <p className="text-[11px] text-muted-foreground px-1 -mt-2">
          Shading marks terminals that are issued and silent — the denser the red, the more
          idle devices sit within about a kilometre of each other.
          {mappedIdleCount === 0 && " Nothing is idle in this view right now."}
        </p>
      )}

      {focusId && (
        <div className={`rounded-xl border px-4 py-2.5 text-xs ${focused ? "border-sky-200 bg-sky-50 text-sky-800" : "border-amber-200 bg-amber-50/60 text-amber-800"}`}>
          {focused
            ? <>Showing <strong>{focused.serialNumber}</strong> with {focused.writerCode} — {focused.writerName}{focused.writerLocation ? ` at ${focused.writerLocation}` : ""}.</>
            : <>That terminal could not be shown on the map — it is either unassigned, or its writer has no map pin yet. A writer with an address but no pin can be pinned from Edit Writer on the agency's profile.</>}
        </div>
      )}

      {(unmappedAssigned > 0 || inStock.length > 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-2.5 text-xs text-amber-800 space-y-1">
          <p>
            Not on the map:{" "}
            {[
              locationNoPin.length > 0
                ? `${locationNoPin.length} whose writer has an address but no map pin (${locationNoPin.map(t => t.writerCode).filter(Boolean).join(", ")})`
                : null,
              noLocationAtAll.length > 0
                ? `${noLocationAtAll.length} whose writer has no location recorded (${noLocationAtAll.map(t => t.writerCode).filter(Boolean).join(", ")})`
                : null,
              inStock.length > 0 ? `${inStock.length} in stock` : null,
            ].filter(Boolean).join("; ")}
            .
          </p>
          {locationNoPin.length > 0 && (
            <p className="text-[11px]">
              Open the agency profile, use Edit Writer and press <strong>Set pin</strong> — search
              the saved address or click the map — and the terminal appears here.
            </p>
          )}
        </div>
      )}

      <div className="relative rounded-2xl overflow-hidden border shadow-sm bg-slate-100" style={{ height: 520 }}>
        {isLoading ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            Loading terminals…
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center text-sm text-destructive">
            Could not load terminals.
          </div>
        ) : !hasTileKey() ? (
          /* Same guard as the agency map: without a tile key this would be
             520px of grey with pins floating on it, which is the failure that
             already cost two rounds of diagnosis once. */
          <div className="h-full flex items-center justify-center text-center px-6">
            <div className="max-w-md space-y-2">
              <p className="text-sm font-semibold text-amber-800">Map tiles are not configured</p>
              <p className="text-xs text-amber-700">
                VITE_MAPTILER_KEY is not set for this deployment. The {mapped.length} mappable
                terminal{mapped.length !== 1 ? "s are" : " is"} listed below with their coordinates;
                only the basemap is missing.
              </p>
            </div>
          </div>
        ) : mapped.length === 0 ? (
          <div className="h-full flex items-center justify-center text-center px-6">
            <div className="max-w-md space-y-2">
              <p className="text-sm font-semibold text-slate-700">No terminals to map yet</p>
              <p className="text-xs text-muted-foreground">
                A terminal appears here once it is assigned to a writer who has a map pin.
                {inStock.length > 0 && ` ${inStock.length} terminal${inStock.length !== 1 ? "s are" : " is"} in stock, unassigned.`}
                {locationNoPin.length > 0 && ` ${locationNoPin.length} assigned terminal${locationNoPin.length !== 1 ? "s have writers with an address but no pin" : " has a writer with an address but no pin"} — set it from Edit Writer.`}
                {noLocationAtAll.length > 0 && ` ${noLocationAtAll.length} assigned terminal${noLocationAtAll.length !== 1 ? "s need" : " needs"} a writer location.`}
              </p>
            </div>
          </div>
        ) : (
          <PigeonMap
            center={center}
            zoom={zoom}
            provider={tileProvider}
            attribution={<span className="text-[10px] text-slate-500">{TILE_ATTRIBUTION}</span>}
            onBoundsChanged={({ center: c, zoom: z }) => { setCenter(c as [number, number]); setZoom(z); }}
          >
            {/* Heat first, so it sits under every marker rather than greying
                them out. One soft blob per idle terminal: where several
                overlap the red compounds, which is the clustering the toggle
                exists to show. */}
            {showHeat && mappedIdle.map(t => {
              const lat = parseFloat(t.writerLat!), lng = parseFloat(t.writerLng!);
              const r = heatRadiusPx(zoom, lat);
              return (
                <Overlay key={`heat-${t.id}`} anchor={[lat, lng] as [number, number]} style={{ pointerEvents: "none" }}>
                  <div
                    style={{
                      width: r * 2, height: r * 2,
                      transform: "translate(-50%, -50%)",
                      borderRadius: "50%",
                      background: "radial-gradient(circle, rgba(239,68,68,.45) 0%, rgba(239,68,68,.22) 45%, rgba(239,68,68,0) 72%)",
                      pointerEvents: "none",
                    }}
                    aria-hidden="true"
                  />
                </Overlay>
              );
            })}
            {mapped.map(t => (
              <Overlay
                key={t.id}
                anchor={[parseFloat(t.writerLat!), parseFloat(t.writerLng!)] as [number, number]}
                /*
                 * The lift belongs on the wrapper, not on the marker inside it.
                 *
                 * pigeon-maps positions each Overlay with a transform, and a
                 * transform creates a stacking context - so a z-index set on
                 * the marker only orders it against its own siblings, and
                 * between markers the later one in the DOM always wins. The
                 * hovered marker's card was being painted over by the three
                 * neighbours that happened to come after it.
                 */
                style={{ pointerEvents: "none", zIndex: hoverId === t.id ? 40 : 1 }}
              >
                <TerminalPin
                  terminal={t}
                  highlighted={t.id === focusId}
                  hovered={hoverId === t.id}
                  onHover={setHoverId}
                  onOpen={id => navigate(`/writers/${id}`)}
                />
              </Overlay>
            ))}
          </PigeonMap>
        )}
      </div>

      {/* A readable fallback list. Useful when tiles are missing, and useful
          anyway for anyone who wants the figures rather than the picture. */}
      {mapped.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {mapped.map(t => (
            <div
              key={t.id}
              className={`flex items-center gap-2.5 p-2.5 bg-white border border-l-4 rounded-xl ${t.isActive ? "border-l-emerald-500" : "border-l-red-500"}`}
            >
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ background: t.isActive ? "#22c55e" : "#ef4444" }}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-xs font-bold font-mono text-slate-800 truncate">
                  {t.writerCode} <span className="font-normal text-slate-400">{t.serialNumber}</span>
                </p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {t.isActive ? "Active" : "Idle"} · {t.writerLocation ?? "location not set"}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── main page ───────────────────────────────────────────────────────────── */

type ViewMode = "grid" | "list" | "map" | "terminals";
type FilterMode = "all" | "active-clear" | "active-debt" | "closed";
type SortMode = "name-asc" | "name-desc" | "debt-desc" | "surplus-desc" | "recent";

export function AgencyDashboard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  
  const { data: agents, isLoading: isAgentsLoading } = useListAgents(
    {},
    { query: { queryKey: getListAgentsQueryKey({}), refetchInterval: 60_000 } },
  );

  const { data: payments, isLoading: isPaymentsLoading } = useListPayments(
    {},
    { query: { queryKey: getListPaymentsQueryKey({}), refetchInterval: 60_000 } }
  );

  const { data: padlockAssignments } = useListPadlockAssignments();

  const activeAssignmentsMap = useMemo(() => {
    const map: Record<string, any> = {};
    if (!Array.isArray(padlockAssignments)) return map;
    const sorted = [...padlockAssignments].sort(
      (a, b) => new Date(b.assignedAt).getTime() - new Date(a.assignedAt).getTime()
    );
    for (const a of sorted) {
      if (!a.returnedAt && !map[a.agentId]) {
        map[a.agentId] = a;
      }
    }
    return map;
  }, [padlockAssignments]);

  const updateUserMutation = useUpdateUser();

  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoAgent, setPhotoAgent] = useState<AgentWithUser | null>(null);

  /*
   * The registry links here as /agencies?view=terminals&focus=<id>, so the
   * initial view and the focused pin come from the URL. Read once at mount:
   * the view is state afterwards, and re-reading would fight the toggles.
   */
  const initialParams = useMemo(() => {
    if (typeof window === "undefined") return { view: null as string | null, focus: null as string | null };
    const q = new URLSearchParams(window.location.search);
    return { view: q.get("view"), focus: q.get("focus") };
  }, []);
  const focusParam = initialParams.focus;
  const [view, setView] = useState<ViewMode>(
    initialParams.view === "terminals" ? "terminals" : "grid",
  );
  const [filter, setFilter] = useState<FilterMode>("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortMode>("name-asc");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AgentWithUser | null>(null);
  const [, navigateTo] = useLocation();
  /* Which agency's roster is open, and which of its two lists is showing. */
  const [roster, setRoster] = useState<{ agent: AgentWithUser; tab: "writers" | "terminals" } | null>(null);

  // Multiples of four, so the last row of the four-column grid is full.
  const [pageSize, setPageSize] = useState(12);
  const gridTopRef = useRef<HTMLDivElement>(null);
  const goToPage = (p: number) => {
    setPage(p);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    gridTopRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  const { data: walletData, isLoading: walletsLoading } = useQuery({
    queryKey: ["/api/finance/commissions/wallets"],
    queryFn: apiGet<{ wallets: CommissionWallet[] }>("/finance/commissions/wallets"),
    refetchInterval: 120_000,
  });
  const walletMap = useMemo(() => {
    const m: Record<string, CommissionWallet> = {};
    for (const w of walletData?.wallets ?? []) m[w.agentId] = w;
    return m;
  }, [walletData]);
  const totalAccrued = useMemo(
    () => (walletData?.wallets ?? []).reduce((s, w) => s + w.accrued, 0),
    [walletData],
  );
  const isLoading = isAgentsLoading || isPaymentsLoading;

  const handlePhotoClick = (a: AgentWithUser) => {
    setPhotoAgent(a);
    photoInputRef.current?.click();
  };

  const handlePhotoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !photoAgent) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file, 320);
      await updateUserMutation.mutateAsync({
        id: (photoAgent.user as { id: string }).id,
        data: { profilePicture: dataUrl },
      });
      qc.invalidateQueries({ queryKey: getListAgentsQueryKey({}) });
      toast({ title: "Agency photo updated" });
    } catch {
      toast({ title: "Failed to upload photo", variant: "destructive" });
    } finally {
      setPhotoAgent(null);
    }
  };

  const agentList = Array.isArray(agents) ? agents : [];

  const lastPaymentsMap = useMemo(() => {
    const map: Record<string, Payment> = {};
    if (!Array.isArray(payments)) return map;
    for (const p of payments) {
      if (!map[p.agentId] && p.status === "completed") {
        map[p.agentId] = p;
      }
    }
    return map;
  }, [payments]);

  const stats = useMemo(() => ({
    total: agentList.length,
    clear: agentList.filter(a => getStatus(a) === "active-clear").length,
    debt: agentList.filter(a => getStatus(a) === "active-debt").length,
    closed: agentList.filter(a => getStatus(a) === "closed").length,
  }), [agentList]);

  const totals = useMemo(() => {
    let companyOwes = 0;
    let agenciesOwe = 0;
    let oldDebtCount = 0;

    agentList.forEach(a => {
      const val = parseFloat(a.outstandingDebt || "0");
      if (val > 0) {
        companyOwes += val;
      } else if (val < 0) {
        agenciesOwe += Math.abs(val);
        if (a.debtSince) {
          const days = debtDays(a.debtSince) ?? 0;
          if (days > 7) {
            oldDebtCount++;
          }
        }
      }
    });

    return {
      companyOwes,
      agenciesOwe,
      netPosition: agenciesOwe - companyOwes,
      oldDebtCount,
    };
  }, [agentList]);

  const filteredAndSorted = useMemo(() => {
    let list = [...agentList];
    if (filter !== "all") list = list.filter(a => getStatus(a) === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(a =>
        (a.agencyName ?? "").toLowerCase().includes(q) ||
        a.fullCode.toLowerCase().includes(q) ||
        a.user.fullName.toLowerCase().includes(q) ||
        (a.location ?? "").toLowerCase().includes(q),
      );
    }

    list.sort((a, b) => {
      if (sortBy === "name-asc") {
        const nameA = a.agencyName ?? a.user.fullName;
        const nameB = b.agencyName ?? b.user.fullName;
        return nameA.localeCompare(nameB);
      }
      if (sortBy === "name-desc") {
        const nameA = a.agencyName ?? a.user.fullName;
        const nameB = b.agencyName ?? b.user.fullName;
        return nameB.localeCompare(nameA);
      }
      if (sortBy === "debt-desc") {
        const valA = parseFloat(a.outstandingDebt || "0");
        const valB = parseFloat(b.outstandingDebt || "0");
        return valA - valB;
      }
      if (sortBy === "surplus-desc") {
        const valA = parseFloat(a.outstandingDebt || "0");
        const valB = parseFloat(b.outstandingDebt || "0");
        return valB - valA;
      }
      if (sortBy === "recent") {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      return 0;
    });

    return list;
  }, [agentList, filter, search, sortBy]);

  // Reset page when sorting/filtering changes
  useEffect(() => {
    setPage(1);
  }, [filter, search, sortBy, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedAgents = useMemo(() => {
    return filteredAndSorted.slice((safePage - 1) * pageSize, safePage * pageSize);
  }, [filteredAndSorted, safePage, pageSize]);

  const pager = filteredAndSorted.length > 0 && (
    <div className="mt-6 bg-white border rounded-2xl shadow-sm overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center">
        <Pager className="flex-1 border-t-0 bg-transparent" page={safePage} totalPages={totalPages} onPage={goToPage}
          total={filteredAndSorted.length} size={pageSize} noun={filteredAndSorted.length === 1 ? "agency" : "agencies"} />
        <label className="flex items-center justify-center gap-2 px-5 pb-3 sm:pb-0 text-xs text-slate-500">
          Per page
          <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))}
            className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-semibold text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400">
            {[8, 12, 16, 24, 48].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-5">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-2xl bg-slate-900 flex items-center justify-center shadow-sm">
              <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Agency Dashboard</h1>
              <p className="text-xs text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-1.5">
                <span>Network overview — {stats.total} registered {stats.total === 1 ? "agency" : "agencies"}</span>
                {totalAccrued > 0 && (
                  <span className="inline-flex items-center gap-1 text-violet-600 font-semibold">
                    · <Wallet className="w-3 h-3" /> {ghsFmt(totalAccrued)} commission accrued
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* View toggle */}
          <div className="flex items-center bg-slate-100 rounded-xl p-1 gap-1">
            {([["grid", "Grid"], ["list", "List"], ["map", "Map"], ["terminals", "Terminals"]] as [ViewMode, string][]).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={[
                  "flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150",
                  view === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700",
                ].join(" ")}
              >
                {v === "grid" && <LayoutGrid className="w-3.5 h-3.5" />}
                {v === "list" && <ListIcon className="w-3.5 h-3.5" />}
                {v === "map" && <MapIcon className="w-3.5 h-3.5" />}
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Polished summary metrics bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          <StatCard
            label="Network Overview"
            value={`${stats.total} Registered`}
            color="bg-slate-800 text-white"
            icon={<User className="w-5 h-5 text-white" />}
            detail={`${stats.clear} Clear · ${stats.debt} In Debt · ${stats.closed} Closed`}
          />
          <StatCard
            label="We Owe Agencies"
            value={<span className="text-emerald-600 font-mono">GHS {totals.companyOwes.toLocaleString("en-GH", { minimumFractionDigits: 2 })}</span>}
            color="bg-emerald-50 text-emerald-600"
            icon={<ArrowDownLeft className="w-5 h-5 text-emerald-600" />}
            detail="Payable surplus agent balances"
          />
          <StatCard
            label="Agencies Owe Us"
            value={<span className="text-amber-600 font-mono">GHS {totals.agenciesOwe.toLocaleString("en-GH", { minimumFractionDigits: 2 })}</span>}
            color="bg-amber-50 text-amber-600"
            icon={<ArrowUpRight className="w-5 h-5 text-amber-600" />}
            detail={totals.oldDebtCount > 0 ? `${totals.oldDebtCount} agencies > 7d overdue` : "Receivable agent balances"}
          />
          <StatCard
            label="Net Position"
            value={
              <span className={totals.netPosition >= 0 ? "text-emerald-600 font-mono" : "text-rose-600 font-mono"}>
                GHS {Math.abs(totals.netPosition).toLocaleString("en-GH", { minimumFractionDigits: 2 })}
              </span>
            }
            color={totals.netPosition >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}
            icon={<Coins className={totals.netPosition >= 0 ? "w-5 h-5 text-emerald-600" : "w-5 h-5 text-rose-600"} />}
            detail={totals.netPosition >= 0 ? "Net receivable surplus" : "Net payable deficit"}
          />
        </div>
      </div>

      {/* Toolbar */}
      <div className="px-6 py-4 bg-white border-b flex items-center gap-3 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-48 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search agencies…"
            className="pl-8 h-9 text-sm bg-slate-50 rounded-xl"
          />
        </div>

        {/* Filter pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {([
            ["all", "All", "bg-slate-800 text-white", "bg-white text-slate-500 border hover:bg-slate-50"],
            ["active-clear", "Clear", "bg-emerald-500 text-white", "bg-white text-slate-500 border hover:bg-emerald-50"],
            ["active-debt", "Has Debt", "bg-amber-500 text-white", "bg-white text-slate-500 border hover:bg-amber-50"],
            ["closed", "Closed", "bg-slate-400 text-white", "bg-white text-slate-400 border hover:bg-slate-50"],
          ] as [FilterMode, string, string, string][]).map(([f, label, active, inactive]) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${filter === f ? active : inactive}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Sort selector dropdown */}
        <div className="flex items-center gap-1.5 ml-0 sm:ml-3">
          <span className="text-xs text-slate-400 font-bold uppercase flex items-center gap-1">
            <SlidersHorizontal className="w-3.5 h-3.5" /> Sort:
          </span>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortMode)}
            className="text-xs font-semibold h-9 px-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            <option value="name-asc">Name (A-Z)</option>
            <option value="name-desc">Name (Z-A)</option>
            <option value="debt-desc">Highest Debt</option>
            <option value="surplus-desc">Highest Surplus</option>
            <option value="recent">Recently Added</option>
          </select>
        </div>

        <button
          onClick={() => qc.invalidateQueries({ queryKey: getListAgentsQueryKey({}) })}
          className="ml-auto p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div ref={gridTopRef} className="px-6 py-6 scroll-mt-4">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
              <div key={i} className="bg-white rounded-2xl border p-5 animate-pulse space-y-3 shadow-sm">
                <div className="flex justify-between">
                  <div className="w-12 h-12 rounded-2xl bg-slate-200" />
                  <div className="w-16 h-6 rounded-full bg-slate-100" />
                </div>
                <div className="h-4 w-3/4 bg-slate-200 rounded" />
                <div className="h-3 w-1/2 bg-slate-100 rounded" />
                <div className="h-px bg-slate-100" />
                <div className="h-5 w-1/3 bg-slate-100 rounded" />
              </div>
            ))}
          </div>
        ) : view === "grid" ? (
          <>
            <GridView
              agents={paginatedAgents}
              lastPaymentsMap={lastPaymentsMap}
              walletMap={walletMap}
              walletsLoading={walletsLoading}
              onSelect={setSelected}
              onPhotoClick={handlePhotoClick}
              onOpenRoster={(a, tab) => setRoster({ agent: a, tab })}
            />
            {pager}
          </>
        ) : view === "list" ? (
          <>
            <ListView
              agents={paginatedAgents}
              lastPaymentsMap={lastPaymentsMap}
              walletMap={walletMap}
              walletsLoading={walletsLoading}
              onSelect={setSelected}
              onPhotoClick={handlePhotoClick}
              onOpenRoster={(a, tab) => setRoster({ agent: a, tab })}
            />
            {pager}
          </>
        ) : view === "terminals" ? (
          <TerminalMapView focusId={focusParam ?? undefined} />
        ) : (
          <MapView agents={filteredAndSorted} onSelect={setSelected} activeAssignmentsMap={activeAssignmentsMap} />
        )}
      </div>

      {/* Hidden file input for photo upload */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handlePhotoFileChange}
      />

      {/* Detail modal */}
      <AgencyDetailModal agent={selected} onClose={() => setSelected(null)} />
      <RosterDialog
        agent={roster?.agent ?? null}
        tab={roster?.tab ?? "writers"}
        onClose={() => setRoster(null)}
        onOpenWriter={id => { setRoster(null); navigateTo(`/writers/${id}`); }}
      />
    </div>
  );
}
