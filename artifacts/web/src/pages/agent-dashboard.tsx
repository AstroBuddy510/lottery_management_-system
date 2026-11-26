import { AgentCommissionWallet } from "@/components/agent-commission-wallet";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { getServerNow } from "../lib/time-sync";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  useGetMyAgent, getGetMyAgentQueryKey,
  useListWriters, getListWritersQueryKey,
  useListSales, useGetUnreadCount, useListGames,
  useListGrossEntries, useListWinsEntries,
  getGetUnreadCountQueryKey, getGetMeQueryKey,
  useUpdateMyPhoto,
} from "@workspace/api-client-react";
import { fmtGHS, cn } from "@/lib/utils";
import {
  TrendingUp, Trophy, Users, Ticket, CalendarDays, Bell, ChevronRight, Plus,
  CreditCard, Gamepad2, Activity, ScanLine, Camera, type LucideIcon,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { CountdownTimer } from "@/pages/games";
import { MySummarySection } from "@/components/my-summary";

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
    <button
      type="button"
      onClick={onPress}
      disabled={uploading}
      // An avatar and a camera glyph, no words: without this the button
      // is announced as just "button".
      aria-label={uploading ? "Uploading profile photo" : "Change profile photo"}
      className="relative flex-shrink-0"
    >
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

// ── Main Dashboard ───────────────────────────────────────────
export function AgentDashboard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const updatePhotoMutation = useUpdateMyPhoto();
  const today = new Date(getServerNow()).toISOString().split("T")[0];
  const [selectedDate, setSelectedDate] = useState(today);
  const firstName = user?.fullName?.split(" ")[0] ?? "Agent";
  const todayLabel = new Date(selectedDate + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  /*
   * The profile menu's "Wallet" lands here as /dashboard?wallet=1: open the
   * folded wallet, bring it into view, and tidy the address so a refresh or
   * a second tap behaves the same.
   */
  const [walletOpen, setWalletOpen] = useState(false);
  const search = useSearch();
  const [, navigate] = useLocation();
  const [scrollToWallet, setScrollToWallet] = useState(false);
  useEffect(() => {
    if (!new URLSearchParams(search).has("wallet")) return;
    setWalletOpen(true);
    setScrollToWallet(true);
    navigate("/dashboard", { replace: true });
  }, [search, navigate]);
  // The wallet appears once its figures have loaded; wait for it (up to a few
  // seconds), then bring it into view.
  useEffect(() => {
    if (!scrollToWallet) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = document.getElementById("commission-wallet");
      if (el || ++tries > 40) {
        window.clearInterval(timer);
        setScrollToWallet(false);
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [scrollToWallet]);

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
  const { data: sales } = useListSales({ dateFrom: selectedDate, dateTo: selectedDate });
  const { data: grossEntries } = useListGrossEntries({ dateFrom: selectedDate, dateTo: selectedDate });
  const { data: winsEntries } = useListWinsEntries({ dateFrom: selectedDate, dateTo: selectedDate });
  const { data: unread } = useGetUnreadCount({ query: { queryKey: getGetUnreadCountQueryKey() } });
  const { data: games } = useListGames();

  const gameList = Array.isArray(games) ? games : [];
  const liveGames = useMemo(() => {
    return gameList.filter(g => {
      const gameDateStr = g.closeAt ? g.closeAt.split("T")[0] : "";
      const isSelectedDay = gameDateStr === selectedDate;
      const isOpenOrPreCalc = g.status === "live" || (g.status === "closed" && !(g as any).calculationsRun);
      return isSelectedDay && isOpenOrPreCalc;
    });
  }, [gameList, selectedDate]);

  const writerList = Array.isArray(writers) ? writers : [];
  const salesList = Array.isArray(sales) ? sales : [];
  const grossList = Array.isArray(grossEntries) ? grossEntries : [];
  const winsList = Array.isArray(winsEntries) ? winsEntries : [];

  /**
   * Gross sales as they actually happen.
   *
   * This card used to read gross_entries - a figure somebody types in after the
   * fact - so it showed nothing until it was declared, and then showed whatever
   * was declared rather than what was sold. It now counts tickets, scoped by
   * the server to this agent's own writers, refreshed on the same 15 second
   * cadence the rest of the live screens use.
   */
  const { data: liveDay } = useQuery<{
    date: string;
    totals: { ticketCount: number; totalStakes: string; winningTickets: number; totalWins: string };
    byGame: { gameId: string; gameName: string; ticketCount: number; totalStakes: string }[];
  }>({
    queryKey: ["/api/live-sales/day", selectedDate],
    queryFn: async () => {
      const res = await fetch(`/api/live-sales/day?date=${selectedDate}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` },
      });
      if (!res.ok) throw new Error("Could not load live sales");
      return res.json();
    },
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  const liveGross = Number(liveDay?.totals.totalStakes ?? 0);
  const liveTickets = liveDay?.totals.ticketCount ?? 0;

  /** What was declared through gross entries, kept for the comparison below. */
  const declaredGross = useMemo(() => {
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
      // ...salesList.map(s => ({ id: s.id, type: "sale" as const, label: `Sale · ${s.gameType ?? "—"}`, amount: Number(s.ticketAmount ?? 0), time: s.createdAt ?? s.saleDate ?? "" })),
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
    sale:  { dot: "bg-blue-500",    chip: "bg-blue-500/10 text-blue-700 dark:text-blue-300",       label: "Sale"  },
    gross: { dot: "bg-emerald-500", chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", label: "Gross" },
    wins:  { dot: "bg-amber-500",   chip: "bg-amber-500/10 text-amber-700 dark:text-amber-300",    label: "Wins"  },
  };

  const balance = parseFloat(agent?.outstandingDebt || "0");
  const companyOwes = balance > 0;
  const agentOwes = balance < 0;
  const isToday = selectedDate === today;
  const grossGap = declaredGross > 0 && Math.abs(declaredGross - liveGross) >= 0.01 ? declaredGross - liveGross : 0;

  return (
    <div className="px-4 md:px-6 max-w-xl mx-auto md:max-w-3xl lg:max-w-6xl mt-4 pb-6 space-y-5">

      {/* ── Hero: who, what they owe, what is running ── */}
      <section
        className="relative overflow-hidden rounded-3xl text-white shadow-lg"
        style={{ background: "linear-gradient(135deg, #0f2747 0%, #1e3a8a 45%, #1d4ed8 100%)" }}
      >
        {/* Soft shapes for depth; purely decorative. */}
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/[0.06]" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 right-1/3 h-56 w-56 rounded-full bg-sky-300/[0.07]" />

        <div className="relative p-5 sm:p-6 space-y-5">
          <div className="flex items-center gap-4">
            <div className="relative">
              <Avatar
                name={user?.fullName ?? "Agent"}
                src={user?.profilePicture}
                size="lg"
                onPress={() => photoInputRef.current?.click()}
                uploading={photoUploading}
              />
              <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white text-blue-700 shadow-md">
                <Camera className="h-2.5 w-2.5" strokeWidth={2.5} />
              </span>
            </div>
            <input ref={photoInputRef} type="file" accept="image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoChange(f); e.target.value = ""; }}
            />

            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-white/70">{getGreeting()}</div>
              <div className="truncate text-xl sm:text-2xl font-black leading-tight">{firstName}</div>
              {agentLoading ? (
                <Skeleton className="h-5 w-24 mt-1.5 bg-white/20" />
              ) : agent ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="rounded-md bg-white/15 px-2 py-0.5 font-mono text-[11px] font-black tracking-wider">{agent.fullCode}</span>
                  {agent.agencyName && <span className="truncate text-xs text-white/70">{agent.agencyName}</span>}
                </div>
              ) : null}
            </div>

            {unreadCount > 0 && (
              <Link href="/notifications" aria-label={`${unreadCount} unread notifications`}
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-bold hover:bg-white/25 transition-colors">
                <Bell className="h-3.5 w-3.5" />
                <span className="tabular-nums">{unreadCount}</span>
                <span className="hidden sm:inline font-medium text-white/80">new</span>
              </Link>
            )}
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
            {/* Balance */}
            {agent ? (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur-md">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white/70">
                    <span className={cn("h-1.5 w-1.5 rounded-full", agentOwes ? "bg-amber-300" : companyOwes ? "bg-emerald-300" : "bg-white/60")} />
                    {companyOwes ? "Company owes you" : agentOwes ? "You owe the company" : "Balance clear"}
                  </div>
                  <div className="mt-1 whitespace-nowrap font-mono text-2xl font-black tracking-tight tabular-nums">
                    <span className="mr-1 text-sm font-normal opacity-70">GH₵</span>
                    {Math.abs(balance).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
                <Link href="/online-payment"
                  className="flex shrink-0 items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-xs font-bold text-blue-700 shadow-md hover:bg-blue-50 active:scale-95 transition-all">
                  <CreditCard className="h-3.5 w-3.5" />
                  {agentOwes ? "Pay now" : "Deposit"}
                </Link>
              </div>
            ) : agentLoading ? (
              <Skeleton className="h-[84px] rounded-2xl bg-white/15" />
            ) : null}

            {/* Draws open on the chosen day */}
            <div className="rounded-2xl border border-white/10 bg-white/10 p-3 backdrop-blur-md">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-white/70">
                  {isToday ? "Today's draws" : "Draws"}
                </span>
                <span className="text-[10px] text-white/60">{liveGames.length} open</span>
              </div>
              {liveGames.length > 0 ? (
                <ul className="space-y-1.5">
                  {liveGames.map(g => {
                    const isGrossClosed = new Date(g.closeAt) <= getServerNow() || g.status === "closed";
                    return (
                      <li key={g.id} className="flex items-center gap-3 rounded-xl bg-white/[0.07] px-2.5 py-2">
                        {g.logoUrl ? (
                          <img src={g.logoUrl} alt="" className="h-9 w-9 shrink-0 rounded-lg bg-white object-contain p-1" />
                        ) : (
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15"><Gamepad2 className="h-4 w-4" /></span>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="shrink-0 rounded bg-white/10 px-1.5 py-px font-mono text-[10px] font-bold text-yellow-300">{g.eventNumber}</span>
                            <span className="truncate text-sm font-bold">{g.name}</span>
                          </div>
                          <CountdownTimer closeAt={g.closeAt} status={g.status} className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold text-white/70" />
                        </div>
                        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wide",
                          isGrossClosed ? "bg-amber-400/90 text-amber-950" : "bg-emerald-400 text-emerald-950")}>
                          {isGrossClosed ? "GROSS CLOSED" : "LIVE"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="flex items-center gap-2.5 rounded-xl bg-white/[0.05] px-3 py-3 text-xs font-medium text-white/60">
                  <Gamepad2 className="h-4 w-4 text-white/40" />
                  No draw open {isToday ? "right now" : "on this day"}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── The day at a glance ── */}
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-base font-bold tracking-tight">{isToday ? "Today at a glance" : "Day at a glance"}</h1>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live · refreshes every 15 seconds
          </p>
        </div>
        <label className="relative inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl border bg-card px-3 text-xs font-semibold shadow-sm hover:bg-muted/50 transition-colors">
          <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="sm:hidden">{new Date(selectedDate + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</span>
          <span className="hidden sm:inline">{todayLabel}</span>
          <input
            type="date"
            value={selectedDate}
            max={today}
            onChange={e => setSelectedDate(e.target.value || today)}
            aria-label="Show figures for"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={TrendingUp} tone="text-emerald-600 bg-emerald-500/10" label="Gross sales" live
          value={fmtGHS(liveGross)}
          sub={grossGap !== 0
            ? <span className="text-amber-600 dark:text-amber-400 font-medium">Declared {fmtGHS(declaredGross)} · {grossGap > 0 ? "over" : "under"} by {fmtGHS(Math.abs(grossGap))}</span>
            : "from tickets sold"} />
        <Kpi icon={Ticket} tone="text-blue-600 bg-blue-500/10" label="Tickets sold"
          value={liveTickets.toLocaleString("en-GB")} sub={`${liveDay?.totals.winningTickets ?? 0} winning`} />
        <Kpi icon={Trophy} tone="text-amber-600 bg-amber-500/10" label="Wins claimed"
          value={fmtGHS(todayWins)} sub={`${winsList.length} ${winsList.length === 1 ? "entry" : "entries"}`} />
        <Kpi icon={Users} tone="text-violet-600 bg-violet-500/10" label="Active writers"
          value={String(activeWriters)} sub={`of ${writerList.length} registered`} />
      </div>

      {/* ── Quick actions ── */}
      <nav aria-label="Quick actions" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <QuickAction href="/entries/gross" icon={TrendingUp} tone="text-emerald-600 bg-emerald-500/10" title="Gross entry" sub="Record a writer's sales" />
        <QuickAction href="/entries/wins" icon={Trophy} tone="text-amber-600 bg-amber-500/10" title="Wins entry" sub="Record wins paid out" />
        <QuickAction href="/ticket-lookup" icon={ScanLine} tone="text-blue-600 bg-blue-500/10" title="Validate ticket" sub="Scan or look one up" />
        <QuickAction href="/my-writers" icon={Plus} tone="text-violet-600 bg-violet-500/10" title="Writers" sub="Add or manage" />
      </nav>

      {/* ── Detail: figures on the left, people and activity on the right ── */}
      <div className="grid gap-5 lg:grid-cols-3 lg:items-start">
        <div className="space-y-5 lg:col-span-2 min-w-0">
          {/* Live agency figures, in the platform's waterfall. */}
          <MySummarySection title="My Agency · Live" className="rounded-2xl shadow-sm" />
        </div>

        <div className="space-y-5 min-w-0">
          {/* Commission earned on the writers' sales, and the way to ask for it.
              Folded to its icon until tapped. */}
          <AgentCommissionWallet id="commission-wallet" collapsible open={walletOpen} onOpenChange={setWalletOpen}
            agencyCode={agent?.fullCode} agencyName={agent?.agencyName ?? null} agentName={user?.fullName} />

          {/* ── Writers ── */}
          <Panel title="My writers" icon={Users}
            action={<Link href="/my-writers" className="inline-flex items-center gap-0.5 text-xs font-semibold text-primary hover:underline">Manage <ChevronRight className="h-3.5 w-3.5" /></Link>}>
            {writersLoading ? (
              <div className="space-y-2 p-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-11 rounded-xl" />)}</div>
            ) : writerList.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Users className="mx-auto h-7 w-7 text-muted-foreground/40" />
                <div className="mt-2 text-sm font-semibold">No writers yet</div>
                <Link href="/my-writers" className="mt-1 inline-block text-xs font-semibold text-primary">+ Add your first writer</Link>
              </div>
            ) : (
              <>
                <ul className="divide-y">
                  {writerList.slice(0, 5).map(w => (
                    <li key={w.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                        style={{ background: avatarBg(w.fullName) }}>
                        {w.fullName.split(" ").filter(Boolean).map((n: string) => n[0]).slice(0, 2).join("").toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{w.fullName}</div>
                        <div className="truncate font-mono text-[11px] text-muted-foreground">{w.fullCode}</div>
                      </div>
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", w.isActive ? "bg-emerald-500" : "bg-muted-foreground/30")}
                        title={w.isActive ? "Active" : "Inactive"} aria-label={w.isActive ? "Active" : "Inactive"} />
                    </li>
                  ))}
                </ul>
                {writerList.length > 5 && (
                  <Link href="/my-writers" className="block border-t px-4 py-2.5 text-center text-xs font-semibold text-primary hover:bg-muted/40">
                    View all {writerList.length} writers
                  </Link>
                )}
              </>
            )}
          </Panel>

          {/* ── Activity ── */}
          <Panel title={isToday ? "Today's activity" : "Activity"} icon={Activity}>
            {recentActivity.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">No entries recorded {isToday ? "yet today" : "on this day"}.</p>
            ) : (
              <ul className="divide-y">
                {recentActivity.map(item => {
                  const st = actStyle[item.type];
                  return (
                    <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", st.dot)} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{item.label}</div>
                        <div className="text-[11px] text-muted-foreground">{relTime(item.time)}</div>
                      </div>
                      <span className="whitespace-nowrap text-sm font-bold tabular-nums">{fmtGHS(item.amount)}</span>
                      <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold", st.chip)}>{st.label}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ── Building blocks ──────────────────────────────────────────
function Kpi({ icon: Icon, tone, label, value, sub, live }: {
  icon: LucideIcon; tone: string; label: string; value: string; sub?: React.ReactNode; live?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-2xl border bg-card p-3.5 sm:p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", tone)}><Icon className="h-4 w-4" /></span>
        {live && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
          </span>
        )}
      </div>
      <div className="mt-2.5 sm:mt-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-lg sm:text-xl font-black tabular-nums leading-tight">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function QuickAction({ href, icon: Icon, tone, title, sub }: { href: string; icon: LucideIcon; tone: string; title: string; sub: string }) {
  return (
    <Link href={href}
      className="group flex min-w-0 items-center gap-2.5 sm:gap-3 rounded-2xl border bg-card px-3 sm:px-3.5 py-3 shadow-sm transition-all hover:-translate-y-px hover:border-primary/30 hover:shadow-md active:scale-[0.98]">
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", tone)}><Icon className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] sm:text-sm font-bold">{title}</span>
        <span className="hidden sm:block truncate text-[11px] text-muted-foreground">{sub}</span>
      </span>
      <ChevronRight className="hidden sm:block h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function Panel({ title, icon: Icon, action, children }: { title: string; icon: LucideIcon; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-bold"><Icon className="h-4 w-4 text-muted-foreground" />{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}
