import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useListAgents, useUpdateUser, AgentWithUser, getListAgentsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Map as PigeonMapBase, Overlay, type MapProps } from "pigeon-maps";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type PigeonMapProps = MapProps & { height?: number; attribution?: boolean; children?: React.ReactNode };
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
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cls}`}>
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
  color, label, code, photo, name, onClick,
}: {
  color: string; label: string; code: string;
  photo?: string | null; name: string; onClick: () => void;
}) {
  const initials = name.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div
      onClick={onClick}
      className="cursor-pointer group"
      style={{ transform: "translate(-50%, -100%)", display: "inline-flex", flexDirection: "column", alignItems: "center" }}
    >
      {/* Bubble card */}
      <div className="flex items-center gap-2 bg-white rounded-2xl shadow-xl border border-slate-200 px-2.5 py-1.5 group-hover:shadow-2xl group-hover:-translate-y-0.5 transition-all duration-150 whitespace-nowrap">
        {/* Avatar — photo or coloured initials */}
        <div
          className="w-8 h-8 rounded-full flex-shrink-0 overflow-hidden flex items-center justify-center text-white font-bold text-xs"
          style={{ boxShadow: `0 0 0 2px ${color}` }}
        >
          {photo ? (
            <img src={photo} alt={name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center" style={{ background: color }}>
              {initials || "?"}
            </div>
          )}
        </div>
        {/* Text */}
        <div style={{ maxWidth: 120 }}>
          <div className="text-[11px] font-bold text-slate-800 leading-tight truncate">{label}</div>
          <div className="text-[9px] font-mono text-slate-400 leading-tight">{code}</div>
        </div>
      </div>
      {/* Arrow tip pointing down to the exact location */}
      <div style={{
        width: 0, height: 0,
        borderLeft: "7px solid transparent",
        borderRight: "7px solid transparent",
        borderTop: "8px solid white",
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

function StatCard({ label, count, color, icon }: { label: string; count: number; color: string; icon: React.ReactNode }) {
  return (
    <div className={`flex items-center gap-3 bg-white border rounded-xl p-4 shadow-sm`}>
      <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center flex-shrink-0`}>
        {icon}
      </div>
      <div>
        <div className="text-2xl font-bold text-slate-800 leading-none">{count}</div>
        <div className="text-xs text-slate-500 mt-0.5">{label}</div>
      </div>
    </div>
  );
}

/* ─── grid view ───────────────────────────────────────────────────────────── */

function GridView({
  agents,
  onSelect,
  onPhotoClick,
}: {
  agents: AgentWithUser[];
  onSelect: (a: AgentWithUser) => void;
  onPhotoClick: (a: AgentWithUser) => void;
}) {
  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-400">
        <svg className="w-14 h-14 mb-4 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
        <p className="font-medium text-slate-500">No agencies match this filter</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {agents.map(a => {
        const status = getStatus(a);
        const cfg = STATUS_CFG[status];
        const debt = parseFloat(a.outstandingDebt);
        const photo = (a.user as { profilePicture?: string | null }).profilePicture;
        return (
          <div
            key={a.id}
            onClick={() => onSelect(a)}
            className={`group bg-white border border-l-4 ${cfg.border} rounded-2xl p-5 shadow-sm hover:shadow-lg transition-all duration-200 cursor-pointer hover:-translate-y-0.5`}
          >
            {/* Header row — icon is a separate upload target, rest of card opens detail */}
            <div className="flex items-start justify-between mb-4">
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
                    className="w-12 h-12 rounded-2xl object-cover shadow-md"
                  />
                ) : (
                  <AgencyIcon status={status} size="md" />
                )}
                <span className="absolute inset-0 rounded-2xl flex items-center justify-center bg-black/40 opacity-0 group-hover/icon:opacity-100 transition-opacity">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                    <circle cx="12" cy="13" r="4"/>
                  </svg>
                </span>
              </button>
              <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${cfg.badge}`}>
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
              <div className="flex items-center gap-1 mt-2 text-xs text-slate-500 truncate">
                <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="11" r="3"/><path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
                </svg>
                {a.location}
              </div>
            )}

            {/* Debt section */}
            <div className={`mt-4 pt-3 border-t ${debt < 0 ? "border-amber-100" : "border-slate-100"}`}>
              {debt < 0 ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">Agent owes Company</span>
                    <AgingBadge debtSince={a.debtSince} debt={a.outstandingDebt} />
                  </div>
                  <div className="text-lg font-bold text-amber-600 mt-0.5">
                    GHS {Math.abs(debt).toLocaleString("en-GH", { minimumFractionDigits: 2 })}
                  </div>
                </>
              ) : debt > 0 ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">Company owes Agent</span>
                  </div>
                  <div className="text-lg font-bold text-emerald-600 mt-0.5">
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
            <div className="mt-3 flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-600 flex-shrink-0">
                {a.user.fullName.charAt(0)}
              </div>
              <span className="text-xs text-slate-500 truncate">{a.user.fullName}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── map view ────────────────────────────────────────────────────────────── */

function MapView({ agents, onSelect }: { agents: AgentWithUser[]; onSelect: (a: AgentWithUser) => void }) {
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

      <div className="relative rounded-2xl overflow-hidden border shadow-sm" style={{ height: 520 }}>
        <PigeonMap
          center={center}
          zoom={zoom}
          attribution={false}
          onBoundsChanged={({ center: c, zoom: z }) => { setCenter(c as [number, number]); setZoom(z); }}
        >
          {mapped.map(a => {
            const status = getStatus(a);
            const color = STATUS_CFG[status].pin;
            const photo = (a.user as { profilePicture?: string | null }).profilePicture;
            const label = a.agencyName ?? a.user.fullName;
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

/* ─── main page ───────────────────────────────────────────────────────────── */

type ViewMode = "grid" | "map";
type FilterMode = "all" | "active-clear" | "active-debt" | "closed";

export function AgencyDashboard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: agents, isLoading } = useListAgents(
    {},
    { query: { queryKey: getListAgentsQueryKey({}), refetchInterval: 60_000 } },
  );
  const updateUserMutation = useUpdateUser();

  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoAgent, setPhotoAgent] = useState<AgentWithUser | null>(null);

  const [view, setView] = useState<ViewMode>("grid");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AgentWithUser | null>(null);

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

  const stats = useMemo(() => ({
    total: agentList.length,
    clear: agentList.filter(a => getStatus(a) === "active-clear").length,
    debt: agentList.filter(a => getStatus(a) === "active-debt").length,
    closed: agentList.filter(a => getStatus(a) === "closed").length,
  }), [agentList]);

  const filtered = useMemo(() => {
    let list = agentList;
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
    return list;
  }, [agentList, filter, search]);

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
              <p className="text-xs text-slate-400 mt-0.5">Network overview — {stats.total} registered {stats.total === 1 ? "agency" : "agencies"}</p>
            </div>
          </div>

          {/* View toggle */}
          <div className="flex items-center bg-slate-100 rounded-xl p-1 gap-1">
            {([["grid", "Grid"], ["map", "Map"]] as [ViewMode, string][]).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={[
                  "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150",
                  view === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700",
                ].join(" ")}
              >
                {v === "grid" ? (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="11" r="3"/><path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/></svg>
                )}
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
          <StatCard
            label="Total Agencies"
            count={stats.total}
            color="bg-slate-700"
            icon={<svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>}
          />
          <StatCard
            label="Active — Clear"
            count={stats.clear}
            color="bg-emerald-500"
            icon={<svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><polyline points="20 6 9 17 4 12"/></svg>}
          />
          <StatCard
            label="Active — Has Debt"
            count={stats.debt}
            color="bg-amber-500"
            icon={<svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>}
          />
          <StatCard
            label="Closed"
            count={stats.closed}
            color="bg-slate-400"
            icon={<svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>}
          />
        </div>
      </div>

      {/* Toolbar */}
      <div className="px-6 py-4 bg-white border-b flex items-center gap-3 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-48 max-w-xs">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search agencies…"
            className="pl-8 h-9 text-sm bg-slate-50"
          />
        </div>

        {/* Filter pills */}
        <div className="flex items-center gap-1.5">
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

        <button
          onClick={() => qc.invalidateQueries({ queryKey: getListAgentsQueryKey({}) })}
          className="ml-auto p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          title="Refresh"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
        </button>
      </div>

      {/* Content */}
      <div className="px-6 py-6">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="bg-white rounded-2xl border p-5 animate-pulse space-y-3">
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
          <GridView agents={filtered} onSelect={setSelected} onPhotoClick={handlePhotoClick} />
        ) : (
          <MapView agents={filtered} onSelect={setSelected} />
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
    </div>
  );
}
