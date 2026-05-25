import { useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { getServerNow } from "../lib/time-sync";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  useGetMyAgent, getGetMyAgentQueryKey,
  useListWriters, getListWritersQueryKey,
  useListSales, useGetUnreadCount, useListGames,
  useListGrossEntries, useListWinsEntries,
  getGetUnreadCountQueryKey, getGetMeQueryKey,
  useUpdateMyPhoto,
} from "@workspace/api-client-react";
import { fmtGHS } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { CountdownTimer } from "@/pages/games";

const AVATAR_COLORS = [
  "#2563eb","#059669","#7c3aed","#ea580c",
  "#db2777","#0d9488","#0891b2","#e11d48",
];
function avatarBg(name: string) {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
}

function Avatar({ name, src, size = "md", onPress, uploading }: {
  name: string; src?: string | null; size?: "sm" | "md" | "lg";
  onPress?: () => void; uploading?: boolean;
}) {
  const initials = name.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const bg = avatarBg(name);
  const sz = size === "lg" ? "w-14 h-14 text-xl" : size === "sm" ? "w-9 h-9 text-xs" : "w-11 h-11 text-sm";
  const content = src
    ? <img src={src} alt={name} className={`${sz} rounded-full object-cover flex-shrink-0`} />
    : (
      <div className={`${sz} rounded-full flex items-center justify-center text-white font-bold flex-shrink-0`} style={{ background: bg }}>
        {initials || "?"}
      </div>
    );
  if (!onPress) return content;
  return (
    <button type="button" onClick={onPress} disabled={uploading} className="relative flex-shrink-0">
      {content}
      <span className="absolute inset-0 rounded-full flex items-center justify-center bg-black/40 opacity-0 hover:opacity-100 active:opacity-100 transition-opacity">
        {uploading
          ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
        }
      </span>
    </button>
  );
}

function getGreeting() {
  const h = getServerNow().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

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

function relTime(dateStr: string): string {
  const now = getServerNow();
  const d = new Date(dateStr);
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

// ── Icon components ──────────────────────────────────────────
function IconSale() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2"/>
      <path d="M9 7h6M9 11h6M9 15h4"/>
    </svg>
  );
}
function IconGross() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
      <polyline points="17 6 23 6 23 12"/>
    </svg>
  );
}
function IconWins() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
      <path d="M4 22h16"/>
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
    </svg>
  );
}
function IconWriters() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  );
}
function IconPlus({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  );
}
function IconChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  );
}



// ── Main Dashboard ───────────────────────────────────────────
export function AgentDashboard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const updatePhotoMutation = useUpdateMyPhoto();
  const today = new Date(getServerNow()).toISOString().split("T")[0];
  const firstName = user?.fullName?.split(" ")[0] ?? "Agent";
  const todayLabel = new Date(getServerNow()).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  const handlePhotoChange = async (file: File) => {
    setPhotoUploading(true);
    try {
      const dataUrl = await resizeImageToDataUrl(file, 320);
      await updatePhotoMutation.mutateAsync({ data: { profilePicture: dataUrl } });
      qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
      toast({ title: "Profile photo updated" });
    } catch {
      toast({ title: "Failed to upload photo", variant: "destructive" });
    } finally {
      setPhotoUploading(false);
    }
  };

  const { data: agent, isLoading: agentLoading } = useGetMyAgent({ query: { queryKey: getGetMyAgentQueryKey() } });
  const { data: writers, isLoading: writersLoading } = useListWriters(agent?.id ?? "", {}, {
    query: { queryKey: getListWritersQueryKey(agent?.id ?? "", {}), enabled: !!agent?.id }
  });
  const { data: sales } = useListSales({ dateFrom: today, dateTo: today });
  const { data: grossEntries } = useListGrossEntries({ dateFrom: today, dateTo: today });
  const { data: winsEntries } = useListWinsEntries({ dateFrom: today, dateTo: today });
  const { data: unread } = useGetUnreadCount({ query: { queryKey: getGetUnreadCountQueryKey() } });
  const { data: games } = useListGames();

  const gameList = Array.isArray(games) ? games : [];
  const liveGames = useMemo(() => {
    return gameList.filter(g => g.status === "live");
  }, [gameList]);

  const writerList = Array.isArray(writers) ? writers : [];
  const salesList = Array.isArray(sales) ? sales : [];
  const grossList = Array.isArray(grossEntries) ? grossEntries : [];
  const winsList = Array.isArray(winsEntries) ? winsEntries : [];

  const todayGross = useMemo(() => {
    const liveGameIds = new Set(liveGames.map(g => g.id));
    return grossList
      .filter(e => e.gameId && liveGameIds.has(e.gameId))
      .reduce((s, e) => s + Number(e.grossAmount ?? 0), 0);
  }, [grossList, liveGames]);

  const todayWins = useMemo(() => {
    const liveGameIds = new Set(liveGames.map(g => g.id));
    return winsList
      .filter(e => e.gameId && liveGameIds.has(e.gameId))
      .reduce((s, e) => s + Number(e.winsAmount ?? 0), 0);
  }, [winsList, liveGames]);

  const activeWriters = writerList.filter(w => w.isActive).length;
  const unreadCount = unread?.count ?? 0;

  const recentActivity = useMemo(() => {
    type Item = { id: string; type: "sale" | "gross" | "wins"; label: string; amount: number; time: string };
    const liveGameIds = new Set(liveGames.map(g => g.id));
    const items: Item[] = [
      ...salesList.map(s => ({ id: s.id, type: "sale" as const, label: `Sale · ${s.gameType ?? "—"}`, amount: Number(s.ticketAmount ?? 0), time: s.createdAt ?? s.saleDate ?? "" })),
      ...grossList
        .filter(e => e.gameId && liveGameIds.has(e.gameId))
        .map(e => ({ id: e.id, type: "gross" as const, label: "Gross Entry", amount: Number(e.grossAmount ?? 0), time: e.createdAt ?? e.entryDate ?? "" })),
      ...winsList
        .filter(e => e.gameId && liveGameIds.has(e.gameId))
        .map(e => ({ id: e.id, type: "wins" as const, label: "Wins Entry", amount: Number(e.winsAmount ?? 0), time: e.createdAt ?? e.entryDate ?? "" })),
    ];
    return items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 6);
  }, [salesList, grossList, winsList, liveGames]);

  const actStyle = {
    sale:  { dot: "#3b82f6", badge: { bg: "#eff6ff", color: "#1d4ed8" }, label: "Sale"  },
    gross: { dot: "#10b981", badge: { bg: "#ecfdf5", color: "#065f46" }, label: "Gross" },
    wins:  { dot: "#f59e0b", badge: { bg: "#fffbeb", color: "#92400e" }, label: "Wins"  },
  };

  return (
    <div className="px-4 max-w-xl mx-auto md:max-w-2xl mt-4 pb-6 space-y-5">

      {/* Page Title Block */}
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-bold tracking-tight text-gray-900">Dashboard</h1>
        <span className="text-[10px] font-bold uppercase tracking-wider bg-gray-200 text-gray-700 px-2 py-0.5 rounded-md">Agent</span>
      </div>

      {/* ── Hero greeting banner card ── */}
      <div
        className="rounded-3xl p-5 text-white shadow-xl"
        style={{
          background: "linear-gradient(135deg, #1e3a5f 0%, #1d4ed8 100%)",
          boxShadow: "0 8px 30px rgba(29, 78, 216, 0.15)",
        }}
      >
        <div className="flex items-center gap-4">
          {/* Avatar */}
          <div className="relative">
            <Avatar
              name={user?.fullName ?? "Agent"}
              src={user?.profilePicture}
              size="lg"
              onPress={() => photoInputRef.current?.click()}
              uploading={photoUploading}
            />
            {/* Camera badge */}
            <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-white rounded-full flex items-center justify-center shadow-md pointer-events-none">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
            </div>
          </div>
          <input ref={photoInputRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoChange(f); e.target.value = ""; }}
          />

          {/* Greeting */}
          <div className="flex-1 min-w-0">
            <div className="text-white/70 text-xs font-medium tracking-wide">{getGreeting()}</div>
            <div className="text-white text-xl font-black leading-tight truncate">{firstName}</div>
            {agentLoading ? (
              <Skeleton className="h-5 w-24 mt-1 bg-white/20" />
            ) : agent ? (
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className="text-[11px] font-black font-mono bg-white/20 text-white px-2.5 py-1 rounded-lg tracking-wider">
                  {agent.fullCode}
                </span>
                <span className="text-white/60 text-xs">{activeWriters} active writer{activeWriters !== 1 ? "s" : ""}</span>
              </div>
            ) : null}
          </div>

          {/* Notification chip */}
          {unreadCount > 0 && (
            <Link href="/notifications">
              <div className="flex flex-col items-center bg-red-500 text-white px-3 py-1.5 rounded-2xl active:opacity-80 transition-opacity shadow-lg">
                <span className="text-base font-black leading-none">{unreadCount}</span>
                <span className="text-[9px] font-semibold leading-tight mt-0.5">new</span>
              </div>
            </Link>
          )}
        </div>

        {/* Date and Balance section */}
        <div className="flex flex-col gap-3 mt-4">
          {/* Date chip */}
          <div className="inline-flex items-center gap-1.5 bg-white/10 rounded-xl px-3 py-1.5 self-start">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            <span className="text-white/80 text-xs font-medium">{todayLabel}</span>
          </div>

          {/* Active Game Event Cards */}
          {liveGames.length > 0 ? (
            <div className="space-y-2 w-full">
              {liveGames.map(g => (
                <div key={g.id} className="bg-white/10 backdrop-blur-md rounded-2xl p-3 flex items-center gap-3 border border-white/10 w-full mt-1">
                  {g.logoUrl ? (
                    <img src={g.logoUrl} alt={g.name} className="w-10 h-10 object-contain rounded bg-white p-1 shadow-sm flex-shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center text-lg font-bold text-white flex-shrink-0 shadow-inner">
                      🎮
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="text-[9px] font-bold text-white/70 uppercase tracking-wider block">
                      Active Game Event
                    </span>
                    <div className="flex items-center gap-2 flex-wrap mt-0.5">
                      <span className="text-xs font-mono font-bold text-yellow-300 px-1.5 py-0.5 bg-white/10 rounded">
                        {g.eventNumber}
                      </span>
                      <span className="text-sm font-black tracking-tight leading-tight text-white truncate">
                        {g.name}
                      </span>
                      <span className="text-[9px] font-bold bg-emerald-500 text-white px-2 py-0.5 rounded-full shadow-sm animate-pulse">
                        LIVE
                      </span>
                      <CountdownTimer closeAt={g.closeAt} status={g.status} className="flex items-center gap-1.5 text-[9px] font-bold text-yellow-300 bg-white/10 border border-white/20 px-2 py-0.5 rounded-lg animate-pulse" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-3 flex items-center gap-3 border border-white/10 w-full mt-1 text-white/60 text-xs font-semibold">
              <span className="text-white/40 text-lg">🎮</span>
              No active game event at the moment
            </div>
          )}

          {/* Balance card */}
          {agent && (
            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-3 flex items-center justify-between border border-white/10 w-full mt-1">
              {(() => {
                const val = parseFloat(agent.outstandingDebt || "0");
                const isCompanyOwes = val > 0;
                const isAgentOwes = val < 0;
                const absVal = Math.abs(val);
                return (
                  <>
                    <div>
                      <span className="text-[10px] font-semibold text-white/70 uppercase tracking-wider block">
                        {isCompanyOwes ? "Company Owes You" : isAgentOwes ? "You owe Company" : "Clear Balance"}
                      </span>
                      <span className="text-lg font-black font-mono text-white tracking-tight">
                        <span className="font-normal opacity-70 text-sm mr-1">GH₵</span>
                        {absVal.toFixed(2)}
                      </span>
                    </div>
                    <Link href="/online-payment">
                      <button className="bg-white text-[#1d4ed8] font-bold text-xs px-3.5 py-2 rounded-xl hover:bg-blue-50 active:scale-95 transition-all shadow-md flex items-center gap-1.5">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="2" y="4" width="20" height="16" rx="2"/>
                          <line x1="2" y1="10" x2="22" y2="10"/>
                        </svg>
                        {isAgentOwes ? "Pay Now" : "Deposit"}
                      </button>
                    </Link>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-5">

        {/* ── Today's Summary Card ── */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
          <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Today's Summary</div>
          <div className="space-y-1">
            
            {/* Sales Logged Row */}
            <div className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl text-blue-600 bg-blue-50 flex items-center justify-center flex-shrink-0">
                  <IconSale />
                </div>
                <div>
                  <div className="text-sm font-semibold text-gray-800">Sales Logged</div>
                  <div className="text-[11px] text-gray-400">{salesList.length === 1 ? "1 ticket" : `${salesList.length} tickets`} today</div>
                </div>
              </div>
              <div className="text-base font-bold text-gray-900 font-mono">{salesList.length}</div>
            </div>

            {/* Gross Today Row */}
            <div className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl text-emerald-600 bg-emerald-50 flex items-center justify-center flex-shrink-0">
                  <IconGross />
                </div>
                <div>
                  <div className="text-sm font-semibold text-gray-800">Gross Sales</div>
                  <div className="text-[11px] text-gray-400">{grossList.length === 1 ? "1 entry" : `${grossList.length} entries`} today</div>
                </div>
              </div>
              <div className="text-base font-black text-gray-900 font-mono">
                {todayGross > 0 ? (
                  <>
                    <span className="font-normal text-gray-400 text-xs mr-0.5">GH₵</span>
                    {todayGross.toFixed(2)}
                  </>
                ) : (
                  "—"
                )}
              </div>
            </div>

            {/* Wins Today Row */}
            <div className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl text-amber-600 bg-amber-50 flex items-center justify-center flex-shrink-0">
                  <IconWins />
                </div>
                <div>
                  <div className="text-sm font-semibold text-gray-800">Wins Claimed</div>
                  <div className="text-[11px] text-gray-400">{winsList.length === 1 ? "1 entry" : `${winsList.length} entries`} today</div>
                </div>
              </div>
              <div className="text-base font-black text-gray-900 font-mono">
                {todayWins > 0 ? (
                  <>
                    <span className="font-normal text-gray-400 text-xs mr-0.5">GH₵</span>
                    {todayWins.toFixed(2)}
                  </>
                ) : (
                  "—"
                )}
              </div>
            </div>

            {/* Active Writers Row */}
            <div className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl text-violet-600 bg-violet-50 flex items-center justify-center flex-shrink-0">
                  <IconWriters />
                </div>
                <div>
                  <div className="text-sm font-semibold text-gray-800">Active Writers</div>
                  <div className="text-[11px] text-gray-400">{activeWriters} of {writerList.length} active</div>
                </div>
              </div>
              <div className="text-base font-bold text-gray-900 font-mono">{activeWriters}</div>
            </div>

          </div>
        </div>

        {/* ── Quick actions ── */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
          <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Quick Actions</div>
          <Link href="/sales">
            <button className="w-full flex items-center justify-between rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-5 py-3.5 mb-4 font-bold text-sm shadow-md hover:shadow-lg transition-all active:scale-[0.98]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0 text-white">
                  <IconSale />
                </div>
                <div className="text-left">
                  <div className="font-bold text-sm text-white">Log a Sale</div>
                  <div className="text-[10px] text-blue-100 font-medium">Record a new ticket sale</div>
                </div>
              </div>
              <div className="text-white/70"><IconChevronRight /></div>
            </button>
          </Link>
          <div className="grid grid-cols-2 gap-3">
            <Link href="/entries/gross" className="w-full">
              <button className="w-full flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-700 px-4 py-3 font-semibold text-xs transition-colors active:scale-[0.98]">
                <span className="text-emerald-600"><IconGross /></span>
                Gross Entry
              </button>
            </Link>
            <Link href="/entries/wins" className="w-full">
              <button className="w-full flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-700 px-4 py-3 font-semibold text-xs transition-colors active:scale-[0.98]">
                <span className="text-amber-600"><IconWins /></span>
                Wins Entry
              </button>
            </Link>
          </div>
        </div>

        {/* ── My Writers ── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-bold text-gray-400 uppercase tracking-widest">My Writers</div>
            <Link href="/my-writers">
              <button className="flex items-center gap-1 text-xs text-[#1d4ed8] font-semibold active:opacity-70">
                Manage <IconChevronRight />
              </button>
            </Link>
          </div>

          {writersLoading ? (
            <div className="space-y-2.5">
              {[1, 2].map(i => <Skeleton key={i} className="h-16 rounded-2xl" />)}
            </div>
          ) : writerList.length === 0 ? (
            <div className="rounded-2xl bg-white border border-dashed border-gray-200 py-8 text-center shadow-sm">
              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-2">
                <IconWriters />
              </div>
              <div className="text-sm font-semibold text-gray-700">No writers yet</div>
              <Link href="/my-writers">
                <button className="mt-1.5 text-xs text-[#1d4ed8] font-semibold">+ Add your first writer</button>
              </Link>
            </div>
          ) : (
            <div className="space-y-2.5">
              {writerList.slice(0, 4).map(w => (
                <div key={w.id} className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3 shadow-sm"
                  style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                  {/* Coloured left accent */}
                  <div className="w-1 h-10 rounded-full flex-shrink-0" style={{ background: w.isActive ? "#10b981" : "#d1d5db" }} />
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                    style={{ background: avatarBg(w.fullName) }}>
                    {w.fullName.split(" ").filter(Boolean).map((n: string) => n[0]).slice(0,2).join("").toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-gray-900 truncate">{w.fullName}</div>
                    <div className="text-xs font-mono text-gray-400">{w.fullCode}</div>
                  </div>
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                    w.isActive ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"
                  }`}>
                    {w.isActive ? "Active" : "Inactive"}
                  </span>
                </div>
              ))}
              {writerList.length > 4 && (
                <Link href="/my-writers">
                  <div className="text-center text-xs text-[#1d4ed8] font-semibold py-2 active:opacity-70">
                    +{writerList.length - 4} more writers →
                  </div>
                </Link>
              )}
            </div>
          )}
        </div>

        {/* ── Recent Activity ── */}
        {recentActivity.length > 0 && (
          <div>
            <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Today's Activity</div>
            <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
              {recentActivity.map((item, idx) => {
                const s = actStyle[item.type];
                return (
                  <div key={item.id} className={`flex items-center gap-3 px-4 py-3.5 ${idx > 0 ? "border-t border-gray-50" : ""}`}>
                    {/* Coloured dot */}
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.dot, boxShadow: `0 0 6px ${s.dot}80` }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-gray-800 truncate">{item.label}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{relTime(item.time)}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-sm font-black font-mono tabular-nums text-gray-800">
                        <span className="font-normal text-gray-400 text-xs mr-0.5">GH₵</span>
                        {Number(item.amount).toFixed(2)}
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg" style={{ background: s.badge.bg, color: s.badge.color }}>
                        {s.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
