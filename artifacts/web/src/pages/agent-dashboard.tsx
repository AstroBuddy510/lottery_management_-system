import { useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  useGetMyAgent, getGetMyAgentQueryKey,
  useListWriters, getListWritersQueryKey,
  useListSales, useGetUnreadCount,
  useListGrossEntries, useListWinsEntries,
  getGetUnreadCountQueryKey, getGetMeQueryKey,
  useUpdateMyPhoto,
} from "@workspace/api-client-react";
import { fmtGHS } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

const AVATAR_COLORS = [
  "bg-blue-600","bg-emerald-600","bg-violet-600","bg-orange-500",
  "bg-pink-600","bg-teal-600","bg-cyan-600","bg-rose-600",
];

function Avatar({ name, src, size = "md" }: { name: string; src?: string | null; size?: "sm" | "md" | "lg" }) {
  const initials = name.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const color = AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
  const sz = size === "lg" ? "w-14 h-14 text-xl" : size === "sm" ? "w-8 h-8 text-xs" : "w-10 h-10 text-sm";
  if (src) {
    return <img src={src} alt={name} className={`${sz} rounded-full object-cover flex-shrink-0`} />;
  }
  return (
    <div className={`${sz} rounded-full ${color} flex items-center justify-center text-white font-bold flex-shrink-0`}>
      {initials || "?"}
    </div>
  );
}

function ArrowRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function getGreeting() {
  const h = new Date().getHours();
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
  const now = new Date();
  const d = new Date(dateStr);
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

export function AgentDashboard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const updatePhotoMutation = useUpdateMyPhoto();
  const today = new Date().toISOString().split("T")[0];
  const firstName = user?.fullName?.split(" ")[0] ?? "Agent";

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

  const { data: agent, isLoading: agentLoading } = useGetMyAgent({
    query: { queryKey: getGetMyAgentQueryKey() }
  });
  const { data: writers, isLoading: writersLoading } = useListWriters(agent?.id ?? "", {}, {
    query: { queryKey: getListWritersQueryKey(agent?.id ?? "", {}), enabled: !!agent?.id }
  });
  const { data: sales } = useListSales({ dateFrom: today, dateTo: today });
  const { data: grossEntries } = useListGrossEntries({ dateFrom: today, dateTo: today });
  const { data: winsEntries } = useListWinsEntries({ dateFrom: today, dateTo: today });
  const { data: unread } = useGetUnreadCount({ query: { queryKey: getGetUnreadCountQueryKey() } });

  const writerList = Array.isArray(writers) ? writers : [];
  const salesList = Array.isArray(sales) ? sales : [];
  const grossList = Array.isArray(grossEntries) ? grossEntries : [];
  const winsList = Array.isArray(winsEntries) ? winsEntries : [];

  const todayGross = useMemo(() => grossList.reduce((s, e) => s + Number(e.grossAmount ?? 0), 0), [grossList]);
  const todayWins = useMemo(() => winsList.reduce((s, e) => s + Number(e.winsAmount ?? 0), 0), [winsList]);
  const activeWriters = writerList.filter(w => w.isActive).length;
  const unreadCount = unread?.count ?? 0;

  const recentActivity = useMemo(() => {
    type ActivityItem = { id: string; type: "sale" | "gross" | "wins"; label: string; amount: number; time: string };
    const items: ActivityItem[] = [
      ...salesList.map(s => ({
        id: s.id, type: "sale" as const,
        label: `Sale · ${s.gameType ?? "—"}`,
        amount: Number(s.ticketAmount ?? 0),
        time: s.createdAt ?? s.saleDate ?? "",
      })),
      ...grossList.map(e => ({
        id: e.id, type: "gross" as const,
        label: `Gross Entry`,
        amount: Number(e.grossAmount ?? 0),
        time: e.createdAt ?? e.entryDate ?? "",
      })),
      ...winsList.map(e => ({
        id: e.id, type: "wins" as const,
        label: `Wins Entry`,
        amount: Number(e.winsAmount ?? 0),
        time: e.createdAt ?? e.entryDate ?? "",
      })),
    ];
    return items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 6);
  }, [salesList, grossList, winsList]);

  const typeStyle = {
    sale:  { dot: "bg-blue-500",    pill: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
    gross: { dot: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
    wins:  { dot: "bg-amber-500",   pill: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  };

  return (
    <div className="px-4 pt-5 pb-4 space-y-5 max-w-xl mx-auto md:max-w-2xl">

      {/* Greeting */}
      <div className="flex items-center gap-3">
        {/* Tappable avatar — opens file picker */}
        <button
          type="button"
          className="relative flex-shrink-0 group"
          onClick={() => photoInputRef.current?.click()}
          disabled={photoUploading}
          aria-label="Change profile photo"
        >
          <Avatar name={user?.fullName ?? "Agent"} src={user?.profilePicture} size="lg" />
          <span className="absolute inset-0 rounded-full flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
            {photoUploading ? (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            )}
          </span>
        </button>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoChange(f); e.target.value = ""; }}
        />
        <div className="flex-1 min-w-0">
          <div className="text-base font-semibold text-foreground leading-tight">
            {getGreeting()}, {firstName}
          </div>
          {agentLoading ? (
            <Skeleton className="h-4 w-24 mt-1" />
          ) : agent ? (
            <div className="flex items-center gap-2 mt-1">
              <span className="font-mono text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">
                {agent.fullCode}
              </span>
              <span className="text-xs text-muted-foreground">{activeWriters} active writers</span>
            </div>
          ) : null}
        </div>
        {unreadCount > 0 && (
          <Link href="/notifications">
            <div className="flex items-center gap-1.5 bg-red-500/10 text-red-600 dark:text-red-400 px-2.5 py-1.5 rounded-xl cursor-pointer active:scale-95 transition-transform">
              <span className="text-xs font-bold">{unreadCount}</span>
              <span className="text-xs">new</span>
            </div>
          </Link>
        )}
      </div>

      {/* Today stat cards — 2×2 grid */}
      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
          Today · {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-card border border-border p-4">
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Sales Logged</div>
            <div className="text-2xl font-bold text-foreground">{salesList.length}</div>
            <div className="text-xs text-muted-foreground mt-0.5">tickets today</div>
          </div>
          <div className="rounded-2xl bg-card border border-border p-4">
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Gross Today</div>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{todayGross > 0 ? fmtGHS(todayGross) : "—"}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{grossList.length} entries</div>
          </div>
          <div className="rounded-2xl bg-card border border-border p-4">
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Wins Today</div>
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">{todayWins > 0 ? fmtGHS(todayWins) : "—"}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{winsList.length} entries</div>
          </div>
          <div className="rounded-2xl bg-card border border-border p-4">
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Writers</div>
            <div className="text-2xl font-bold text-foreground">{activeWriters}</div>
            <div className="text-xs text-muted-foreground mt-0.5">of {writerList.length} active</div>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Quick Actions</div>
        <div className="grid grid-cols-3 gap-2.5">
          <Link href="/sales">
            <button className="w-full flex flex-col items-center gap-2 py-4 px-2 rounded-2xl bg-blue-600 text-white active:scale-95 transition-transform shadow-sm">
              <PlusIcon />
              <span className="text-xs font-semibold leading-tight">Log Sale</span>
            </button>
          </Link>
          <Link href="/entries/gross">
            <button className="w-full flex flex-col items-center gap-2 py-4 px-2 rounded-2xl bg-emerald-600 text-white active:scale-95 transition-transform shadow-sm">
              <PlusIcon />
              <span className="text-xs font-semibold leading-tight">Gross Entry</span>
            </button>
          </Link>
          <Link href="/entries/wins">
            <button className="w-full flex flex-col items-center gap-2 py-4 px-2 rounded-2xl bg-amber-600 text-white active:scale-95 transition-transform shadow-sm">
              <PlusIcon />
              <span className="text-xs font-semibold leading-tight">Wins Entry</span>
            </button>
          </Link>
        </div>
      </div>

      {/* My Writers */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">My Writers</div>
          <Link href="/my-writers">
            <button className="flex items-center gap-1 text-xs text-primary font-medium active:opacity-70">
              Manage <ArrowRight />
            </button>
          </Link>
        </div>
        {writersLoading ? (
          <div className="space-y-2">
            {[1, 2].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}
          </div>
        ) : writerList.length === 0 ? (
          <div className="rounded-2xl bg-muted/40 border border-dashed border-border py-6 text-center">
            <div className="text-sm text-muted-foreground">No writers yet</div>
            <Link href="/my-writers">
              <button className="mt-2 text-xs text-primary font-medium">+ Add your first writer</button>
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {writerList.slice(0, 4).map(w => (
              <div key={w.id} className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3">
                <Avatar name={w.fullName} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{w.fullName}</div>
                  <div className="text-xs font-mono text-muted-foreground">{w.fullCode}</div>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  w.isActive
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                    : "bg-muted text-muted-foreground"
                }`}>
                  {w.isActive ? "Active" : "Inactive"}
                </span>
              </div>
            ))}
            {writerList.length > 4 && (
              <Link href="/my-writers">
                <div className="text-center text-xs text-primary font-medium py-1.5 active:opacity-70">
                  +{writerList.length - 4} more writers
                </div>
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Recent Activity */}
      {recentActivity.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Today's Activity</div>
          <div className="rounded-2xl border border-border bg-card overflow-hidden divide-y divide-border">
            {recentActivity.map(item => {
              const s = typeStyle[item.type];
              const label = item.type === "sale" ? "Sale" : item.type === "gross" ? "Gross" : "Wins";
              return (
                <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{item.label}</div>
                    <div className="text-xs text-muted-foreground">{relTime(item.time)}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-sm font-bold font-mono tabular-nums">{fmtGHS(item.amount)}</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${s.pill}`}>{label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
