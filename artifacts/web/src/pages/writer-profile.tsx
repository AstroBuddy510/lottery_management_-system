import { useMemo } from "react";
import { useLocation, useParams } from "wouter";
import {
  useGetWriterProfile, getGetWriterProfileQueryKey,
} from "@workspace/api-client-react";
import { Map as PigeonMapBase, Overlay, type MapProps } from "pigeon-maps";
import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtGHS } from "@/lib/utils";
import { tileProvider, hasTileKey, TILE_ATTRIBUTION } from "@/lib/map-tiles";
import {
  MapPin, Smartphone, Phone, KeyRound, AlertTriangle, Building2, Clock,
} from "lucide-react";

/**
 * One writer, everything about them on one page.
 *
 * Until now a writer existed only as a row inside an agency's Writers tab,
 * which meant the terminal map had nowhere to send a click: a supervisor who
 * spotted a red marker could see the code and nothing else. This is that
 * destination. It answers, in order, the four things somebody arriving from a
 * marker actually wants: who is this, where do they sell, what device are they
 * holding, and are they selling at all.
 */

type PigeonMapProps = MapProps & {
  attribution?: React.ReactNode | false;
  provider?: (x: number, y: number, z: number, dpr?: number) => string;
  children?: React.ReactNode;
};
function PigeonMap(props: PigeonMapProps) {
  return React.createElement(PigeonMapBase as never, props);
}

/** The window the terminal map uses for "active". Same number, same meaning. */
const ACTIVE_WINDOW_MINUTES = 60;

function relative(ts: string | null | undefined): string {
  if (!ts) return "never";
  const then = new Date(ts).getTime();
  if (!Number.isFinite(then)) return "never";
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-xl font-black mt-1 tabular-nums">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export function WriterProfile() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const writerId = params.id ?? "";

  const { data, isLoading, error } = useGetWriterProfile(writerId, {
    query: {
      queryKey: getGetWriterProfileQueryKey(writerId),
      enabled: !!writerId,
      // Same cadence as the terminal map, so moving between them does not show
      // two different answers to "has this writer sold".
      refetchInterval: 30_000,
    },
  });

  const coords = useMemo<[number, number] | null>(() => {
    const lat = data?.writer?.lat, lng = data?.writer?.lng;
    if (!lat || !lng) return null;
    const la = parseFloat(lat), ln = parseFloat(lng);
    return Number.isFinite(la) && Number.isFinite(ln) ? [la, ln] : null;
  }, [data?.writer?.lat, data?.writer?.lng]);

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 space-y-6">
        <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => history.back()}>
          ← Back
        </Button>
        <p className="text-sm text-destructive">That writer could not be loaded.</p>
      </div>
    );
  }

  const { writer, agency, terminal, sales } = data;
  const lastSale = sales.lastSaleAt ?? null;
  const active = !!lastSale && Date.now() - new Date(lastSale).getTime() < ACTIVE_WINDOW_MINUTES * 60_000;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => history.back()}>
          ← Back
        </Button>
        <div className="h-4 w-px bg-border" />
        <div>
          <h1 className="text-xl font-semibold">{writer.fullName}</h1>
          <span className="text-sm font-mono text-muted-foreground">{writer.fullCode}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge
            className={active
              ? "bg-emerald-100 text-emerald-700 border-emerald-200"
              : "bg-red-100 text-red-700 border-red-200"}
          >
            {active ? "Active" : "Idle"}
          </Badge>
          <Badge variant={writer.isActive ? "default" : "secondary"}>
            {writer.isActive ? "Enabled" : "Disabled"}
          </Badge>
        </div>
      </div>

      {/* The two states that quietly stop a writer selling, said at the top
          rather than left for somebody to deduce from a zero. */}
      {!data.hasPin && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-2.5 text-xs text-amber-800 flex items-center gap-2">
          <KeyRound className="w-4 h-4 shrink-0" />
          <span>
            This writer has no PIN, so they cannot sign in to a terminal at all. Issue one from
            their agency's Writers tab.
          </span>
        </div>
      )}
      {data.isRedFlagged && (
        <div className="rounded-xl border border-red-200 bg-red-50/60 px-4 py-2.5 text-xs text-red-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            Red-flagged in Risk Management{data.redFlagReason ? ` — ${data.redFlagReason}` : "."}
          </span>
        </div>
      )}

      {/* Figures */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label="Sold today"
          value={fmtGHS(sales.stakesToday ?? "0")}
          sub={`${sales.salesToday} ticket${sales.salesToday === 1 ? "" : "s"}`}
        />
        <Stat label="Last sale" value={relative(lastSale)} sub={active ? `within the last ${ACTIVE_WINDOW_MINUTES} min` : "silent"} />
        <Stat
          label="Lifetime gross"
          value={fmtGHS(sales.totalStakes)}
          sub={`${sales.ticketCount} ticket${sales.ticketCount === 1 ? "" : "s"}`}
        />
        <Stat
          label="Wins paid"
          value={fmtGHS(sales.totalWins)}
          sub={`${sales.winningTickets} winning ticket${sales.winningTickets === 1 ? "" : "s"}`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Details */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Writer</p>
              <div className="flex items-start gap-2.5 text-sm">
                <Building2 className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                <button
                  className="text-left hover:underline"
                  onClick={() => navigate(`/agents/${agency.agentId}/detail`)}
                >
                  {agency.agencyName ?? "Agency"}
                  <span className="block text-xs font-mono text-muted-foreground">{agency.agentCode}</span>
                </button>
              </div>
              <div className="flex items-start gap-2.5 text-sm">
                <Phone className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                <span>{writer.phone ?? <span className="text-muted-foreground">No phone recorded</span>}</span>
              </div>
              <div className="flex items-start gap-2.5 text-sm">
                <KeyRound className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                <span>{data.hasPin ? "PIN issued" : <span className="text-amber-700">No PIN</span>}</span>
              </div>
              <div className="flex items-start gap-2.5 text-sm">
                <Clock className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                <span className="capitalize">{writer.operationModel ?? "postpaid"}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Terminal</p>
              {terminal ? (
                <>
                  <div className="flex items-start gap-2.5 text-sm">
                    <Smartphone className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                    <div>
                      <span className="font-mono font-semibold">{terminal.serialNumber}</span>
                      <span className="block text-xs text-muted-foreground">
                        {terminal.brand} {terminal.model}
                      </span>
                      <span className="block text-xs text-muted-foreground font-mono">
                        IMEI {terminal.imei}
                      </span>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Held since {terminal.assignedAt ? new Date(terminal.assignedAt).toLocaleDateString() : "—"}
                    {(data.terminalHistoryCount ?? 0) > 1 && ` · ${data.terminalHistoryCount} devices over time`}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs w-full"
                    onClick={() => navigate("/inventory")}
                  >
                    Open in Inventory
                  </Button>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No terminal assigned. Assign one from Inventory → Terminals.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Where they sell */}
        <Card className="lg:col-span-2">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Location</p>
              <span className="text-xs text-muted-foreground">
                {writer.location ?? "No location recorded"}
              </span>
            </div>
            <div className="rounded-xl overflow-hidden border bg-slate-100" style={{ height: 340 }}>
              {!coords ? (
                <div className="h-full flex items-center justify-center text-center px-6">
                  <p className="text-xs text-muted-foreground max-w-xs">
                    {writer.location
                      ? "An address is recorded but no map pin has been set, so this writer does not appear on the terminal map. Set one from Edit Writer on the agency profile."
                      : "No location recorded for this writer yet."}
                  </p>
                </div>
              ) : !hasTileKey() ? (
                <div className="h-full flex items-center justify-center text-center px-6">
                  <p className="text-xs text-amber-700">
                    Pinned at {writer.lat}, {writer.lng} — the basemap needs VITE_MAPTILER_KEY.
                  </p>
                </div>
              ) : (
                <PigeonMap
                  center={coords}
                  zoom={15}
                  provider={tileProvider}
                  attribution={<span className="text-[10px] text-slate-500">{TILE_ATTRIBUTION}</span>}
                >
                  <Overlay anchor={coords}>
                    <div style={{ transform: "translate(-50%, -100%)" }}>
                      <MapPin
                        className="w-8 h-8 drop-shadow"
                        style={{ color: active ? "#22c55e" : "#ef4444" }}
                        fill={active ? "#22c55e" : "#ef4444"}
                      />
                    </div>
                  </Overlay>
                </PigeonMap>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default WriterProfile;
