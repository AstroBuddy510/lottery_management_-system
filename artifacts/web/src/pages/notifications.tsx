import { useState, useMemo } from "react";
import {
  useListNotifications, useGetUnreadCount, useSendNotification, useMarkNotificationRead, useDeleteReadNotifications,
  getListNotificationsQueryKey, getGetUnreadCountQueryKey,
  NotificationWithReceipt, NotificationInputTargetType, NotificationInputMessageType,
} from "@workspace/api-client-react";
import { useWriterLookup } from "@/lib/use-writer-lookup";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Bell, Check, CheckCheck, Trash2, PenSquare, Inbox, Megaphone, Siren, BellRing, CreditCard, AlertTriangle,
  Trophy, FileQuestion, Mail, CalendarDays, Search, type LucideIcon,
} from "lucide-react";
import { Panel, Pager, usePaged, ReportActions, StatTile } from "@/components/data-kit";
import { exportReportPdf, printReport, type TableReport } from "@/lib/table-report";

const NOTIF_PAGE = 15;

function SectionRule({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="h-px flex-1 bg-border" />
      <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

/* ─── helpers ───────────────────────────────────────────────────────────── */

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-GH", { day: "numeric", month: "short" });
}

function fullDate(iso: string) {
  return new Date(iso).toLocaleString("en-GH", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/* ─── type config ────────────────────────────────────────────────────────── */

const TYPE_CFG = {
  announcement: {
    label: "Announcement",
    border: "border-l-blue-500",
    bg: "bg-blue-50 dark:bg-blue-500/10",
    dot: "bg-blue-500",
    badgeBg: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
    iconBg: "bg-blue-500",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} className="w-4 h-4">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
      </svg>
    ),
  },
  alert: {
    label: "Alert",
    border: "border-l-red-500",
    bg: "bg-red-50 dark:bg-red-500/10",
    dot: "bg-red-500",
    badgeBg: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
    iconBg: "bg-red-500",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} className="w-4 h-4">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    ),
  },
  reminder: {
    label: "Reminder",
    border: "border-l-amber-500",
    bg: "bg-amber-50 dark:bg-amber-500/10",
    dot: "bg-amber-500",
    badgeBg: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    iconBg: "bg-amber-500",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} className="w-4 h-4">
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>
      </svg>
    ),
  },
  payment_received: {
    label: "Payment Received",
    border: "border-l-emerald-500",
    bg: "bg-emerald-50 dark:bg-emerald-500/10",
    dot: "bg-emerald-500",
    badgeBg: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    iconBg: "bg-emerald-500",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} className="w-4 h-4">
        <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
        <line x1="1" y1="10" x2="23" y2="10"/>
      </svg>
    ),
  },
  wins_summary: {
    label: "Wins Summary",
    border: "border-l-violet-500",
    bg: "bg-violet-50 dark:bg-violet-500/10",
    dot: "bg-violet-500",
    badgeBg: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
    iconBg: "bg-violet-500",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} className="w-4 h-4">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
  },
  deficit_alert: {
    label: "Deficit Alert",
    border: "border-l-rose-600",
    bg: "bg-rose-50 dark:bg-rose-500/10",
    dot: "bg-rose-600",
    badgeBg: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
    iconBg: "bg-rose-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} className="w-4 h-4">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
    ),
  },
  debt_query: {
    label: "Debt Query",
    border: "border-l-orange-500",
    bg: "bg-orange-50 dark:bg-orange-500/10",
    dot: "bg-orange-500",
    badgeBg: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
    iconBg: "bg-orange-500",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} className="w-4 h-4">
        <circle cx="12" cy="12" r="10"/>
        <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    ),
  },
} as const;

const TARGET_LABELS: Record<string, string> = {
  all: "Everyone",
  all_agents: "All Agents",
  agent: "Agent",
  writer: "Writer",
  system: "System",
};

/* ─── skeleton card ──────────────────────────────────────────────────────── */

function SkeletonCard() {
  return (
    <div className="flex animate-pulse gap-4 rounded-2xl border border-border/80 bg-card p-5 shadow-sm">
      <div className="h-9 w-9 shrink-0 rounded-xl bg-muted" />
      <div className="flex-1 space-y-2.5">
        <div className="flex items-center gap-2">
          <div className="h-3 w-32 rounded-full bg-muted" />
          <div className="h-3 w-16 rounded-full bg-muted/60" />
        </div>
        <div className="h-3 w-full rounded-full bg-muted/60" />
        <div className="h-3 w-2/3 rounded-full bg-muted/60" />
      </div>
    </div>
  );
}

/* ─── empty state ────────────────────────────────────────────────────────── */

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-16">
      <div className="relative mb-5">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border bg-muted/60 text-muted-foreground">
          <Bell className="h-7 w-7" />
        </div>
        <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-card bg-emerald-500">
          <Check className="h-3 w-3 text-white" />
        </div>
      </div>
      <p className="mb-1 text-sm font-bold">
        {filtered ? "No notifications match this filter" : "Your inbox is empty"}
      </p>
      <p className="max-w-xs text-center text-xs text-muted-foreground">
        {filtered ? "Try another category or clear the search." : "Notifications sent to you will appear here."}
      </p>
    </div>
  );
}

/* ─── notification row ───────────────────────────────────────────────────── */

function NotifCard({
  n,
  isRead,
  onRead,
}: {
  n: NotificationWithReceipt;
  isRead: boolean;
  onRead: (n: NotificationWithReceipt) => void;
}) {
  const cfg = TYPE_CFG[n.messageType as keyof typeof TYPE_CFG] ?? TYPE_CFG.announcement;
  const isUnread = !isRead;

  return (
    <article
      onClick={() => { if (isUnread) onRead(n); }}
      onKeyDown={(e) => { if (isUnread && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onRead(n); } }}
      tabIndex={isUnread ? 0 : -1}
      aria-label={`${isUnread ? "Unread" : "Read"} ${cfg.label}: ${n.title}`}
      className={[
        "group relative overflow-hidden rounded-2xl border border-l-4 border-border/80 bg-card shadow-sm transition-all duration-200",
        cfg.border,
        isUnread ? "cursor-pointer hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" : "opacity-75 hover:opacity-100",
      ].join(" ")}
    >
      {isUnread && <div className={`pointer-events-none absolute inset-0 ${cfg.bg} opacity-40`} />}

      <div className="relative flex items-start gap-4 p-4 sm:p-5">
        <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${cfg.iconBg} shadow-sm`}>
          {cfg.icon}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                {isUnread && <span className={`h-2 w-2 shrink-0 animate-pulse rounded-full ${cfg.dot}`} />}
                <span className={`text-sm font-bold leading-tight ${isUnread ? "text-foreground" : "text-muted-foreground"}`}>{n.title}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${cfg.badgeBg}`}>{cfg.label}</span>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  → {TARGET_LABELS[n.targetType] ?? n.targetType}
                </span>
              </div>
              <p className={`whitespace-pre-line break-words text-sm leading-relaxed ${isUnread ? "text-foreground/80" : "text-muted-foreground"}`}>
                {n.body}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end sm:gap-1">
              <span className="whitespace-nowrap text-xs font-medium text-muted-foreground" title={fullDate(n.createdAt)}>
                {relativeTime(n.createdAt)}
              </span>
              {isRead ? (
                <span className="flex items-center gap-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                  <Check className="h-3 w-3" /> Read
                </span>
              ) : (
                <span className="text-[10px] text-muted-foreground transition-colors group-hover:text-foreground">Click to mark read</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

/* ─── compose sheet ──────────────────────────────────────────────────────── */

function ComposeSheet({
  open,
  onClose,
  agentList,
  allWriters,
}: {
  open: boolean;
  onClose: () => void;
  agentList: { id: string; fullCode: string; user?: { fullName?: string } | null }[];
  allWriters: { id: string; fullCode: string; fullName: string }[];
}) {
  const sendMutation = useSendNotification();
  const qc = useQueryClient();
  const [form, setForm] = useState<{
    messageType: NotificationInputMessageType;
    title: string;
    body: string;
    targetType: NotificationInputTargetType;
    targetId: string;
  }>({ messageType: "announcement", title: "", body: "", targetType: "all", targetId: "" });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetUnreadCountQueryKey() });
  };

  const needsTargetId = form.targetType === "agent" || form.targetType === "writer";
  const targetOptions = form.targetType === "agent"
    ? agentList.map(a => ({ id: a.id, label: `${a.fullCode} — ${a.user?.fullName ?? ""}` }))
    : allWriters.map(w => ({ id: w.id, label: `${w.fullCode} — ${w.fullName}` }));

  const cfg = TYPE_CFG[form.messageType as keyof typeof TYPE_CFG] ?? TYPE_CFG.announcement;
  const bodyLen = form.body.length;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await sendMutation.mutateAsync({
        data: {
          messageType: form.messageType,
          title: form.title,
          body: form.body,
          targetType: form.targetType,
          targetId: needsTargetId ? form.targetId : undefined,
        },
      });
      toast.success("Notification sent successfully");
      onClose();
      setForm({ messageType: "announcement", title: "", body: "", targetType: "all", targetId: "" });
      invalidate();
    } catch {
      toast.error("Failed to send notification");
    }
  };

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-md p-0 flex flex-col">
        {/* Header */}
        <SheetHeader className="px-6 pt-6 pb-4 border-b bg-muted/40">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
              <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </div>
            <div>
              <SheetTitle className="text-base font-bold leading-tight">Compose Notification</SheetTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Send to your team or specific members</p>
            </div>
          </div>
        </SheetHeader>

        <form onSubmit={handleSend} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Live preview badge row */}
          <div className={`flex items-center gap-2 p-3 rounded-xl border-l-4 ${cfg.border} ${cfg.bg}`}>
            <div className={`w-7 h-7 rounded-lg ${cfg.iconBg} flex items-center justify-center flex-shrink-0`}>{cfg.icon}</div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-foreground truncate">{form.title || "Notification preview…"}</p>
              <p className="text-[11px] text-muted-foreground truncate">{form.body || "Message body will appear here"}</p>
            </div>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cfg.badgeBg}`}>{cfg.label}</span>
          </div>

          {/* Type + Audience */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">Message Type</Label>
              <Select value={form.messageType} onValueChange={v => setForm(f => ({ ...f, messageType: v as NotificationInputMessageType }))}>
                <SelectTrigger className="h-9 text-sm bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="announcement">📢 Announcement</SelectItem>
                  <SelectItem value="alert">🚨 Alert</SelectItem>
                  <SelectItem value="reminder">🔔 Reminder</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">Send To</Label>
              <Select value={form.targetType} onValueChange={v => setForm(f => ({ ...f, targetType: v as NotificationInputTargetType, targetId: "" }))}>
                <SelectTrigger className="h-9 text-sm bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">🌐 All Users</SelectItem>
                  <SelectItem value="all_agents">👥 All Agents</SelectItem>
                  <SelectItem value="agent">👤 Specific Agent</SelectItem>
                  <SelectItem value="writer">✍️ Specific Writer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Specific target selector */}
          {needsTargetId && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">
                {form.targetType === "agent" ? "Select Agent" : "Select Writer"}
              </Label>
              <Select value={form.targetId} onValueChange={v => setForm(f => ({ ...f, targetId: v }))}>
                <SelectTrigger className="h-9 text-sm bg-background">
                  <SelectValue placeholder={`Choose ${form.targetType}…`} />
                </SelectTrigger>
                <SelectContent>
                  {targetOptions.map(o => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Subject */}
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <Label className="text-xs font-semibold text-muted-foreground">Subject</Label>
              <span className="text-[10px] text-muted-foreground">{form.title.length}/80</span>
            </div>
            <Input
              value={form.title}
              maxLength={80}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              required
              className="h-9 text-sm bg-background"
              placeholder="Short, clear subject line…"
            />
          </div>

          {/* Body */}
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <Label className="text-xs font-semibold text-muted-foreground">Message</Label>
              <span className={`text-[10px] font-medium ${bodyLen > 450 ? "text-red-500" : "text-muted-foreground"}`}>{bodyLen}/500</span>
            </div>
            <Textarea
              value={form.body}
              maxLength={500}
              onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              required
              rows={5}
              className="text-sm resize-none bg-background"
              placeholder="Write your message here…"
            />
          </div>
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-muted/40/60 flex gap-3">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSend as unknown as React.MouseEventHandler}
            className="flex-1 font-semibold"
            disabled={sendMutation.isPending || (needsTargetId && !form.targetId) || !form.title || !form.body}
          >
            {sendMutation.isPending ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8z"/></svg>
                Sending…
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                Send
              </span>
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ─── main page ──────────────────────────────────────────────────────────── */

type FilterTab = "all" | NotificationInputMessageType;

export function Notifications() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canCompose = user?.role === "director" || user?.role === "administrator";
  const { agentList, allWriters } = useWriterLookup();

  const { data: notifications, isLoading } = useListNotifications({
    query: { queryKey: getListNotificationsQueryKey(), refetchInterval: 30_000 },
  });
  const { data: unread } = useGetUnreadCount({
    query: { queryKey: getGetUnreadCountQueryKey(), refetchInterval: 30_000 },
  });
  const markReadMutation = useMarkNotificationRead();
  const deleteReadMutation = useDeleteReadNotifications();

  const [tab, setTab] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);

  // Optimistic set: IDs we've already sent mark-read for (before server re-fetch)
  const [locallyReadIds, setLocallyReadIds] = useState<Set<string>>(new Set());

  const notifList = Array.isArray(notifications) ? notifications : [];
  const serverUnreadCount = unread?.count ?? 0;

  // Optimistic unread count: subtract items we've already marked locally
  const locallyReadUnreadCount = notifList.filter(n => !n.readAt && locallyReadIds.has(n.id)).length;
  const unreadCount = Math.max(0, serverUnreadCount - locallyReadUnreadCount);

  // Helper: is a specific notification considered read (server OR local)
  const isRead = (n: NotificationWithReceipt) => !!n.readAt || locallyReadIds.has(n.id);

  const unreadByType = useMemo(() => ({
    all: notifList.filter(n => !isRead(n)).length,
    announcement: notifList.filter(n => n.messageType === "announcement" && !isRead(n)).length,
    alert: notifList.filter(n => n.messageType === "alert" && !isRead(n)).length,
    reminder: notifList.filter(n => n.messageType === "reminder" && !isRead(n)).length,
    payment_received: notifList.filter(n => n.messageType === "payment_received" && !isRead(n)).length,
    wins_summary: notifList.filter(n => n.messageType === "wins_summary" && !isRead(n)).length,
    deficit_alert: notifList.filter(n => n.messageType === "deficit_alert" && !isRead(n)).length,
    debt_query: notifList.filter(n => n.messageType === "debt_query" && !isRead(n)).length,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [notifList, locallyReadIds]);

  const counts = useMemo(() => ({
    all: notifList.length,
    announcement: notifList.filter(n => n.messageType === "announcement").length,
    alert: notifList.filter(n => n.messageType === "alert").length,
    reminder: notifList.filter(n => n.messageType === "reminder").length,
    payment_received: notifList.filter(n => n.messageType === "payment_received").length,
    wins_summary: notifList.filter(n => n.messageType === "wins_summary").length,
    deficit_alert: notifList.filter(n => n.messageType === "deficit_alert").length,
    debt_query: notifList.filter(n => n.messageType === "debt_query").length,
  }), [notifList]);

  const filtered = tab === "all" ? notifList : notifList.filter(n => n.messageType === tab);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetUnreadCountQueryKey() });
  };

  const handleMarkRead = async (n: NotificationWithReceipt) => {
    if (isRead(n)) return;
    // Optimistically mark as read immediately — updates tab badges + sidebar badge
    setLocallyReadIds(prev => new Set(prev).add(n.id));
    qc.setQueryData(getGetUnreadCountQueryKey(), (old: { count: number } | undefined) => ({
      count: Math.max(0, (old?.count ?? 1) - 1),
    }));
    try {
      await markReadMutation.mutateAsync({ id: n.id });
      invalidate();
    } catch { /* silent — optimistic state stays, server will sync on next poll */ }
  };

  const markAllRead = async () => {
    const unreadItems = notifList.filter(n => !isRead(n));
    if (unreadItems.length === 0) return;
    // Optimistically mark all as read
    setLocallyReadIds(prev => {
      const next = new Set(prev);
      unreadItems.forEach(n => next.add(n.id));
      return next;
    });
    qc.setQueryData(getGetUnreadCountQueryKey(), { count: 0 });
    await Promise.all(unreadItems.map(n => markReadMutation.mutateAsync({ id: n.id }).catch(() => {})));
    invalidate();
  };

  const handleDeleteRead = async () => {
    const readItemsCount = notifList.filter(n => isRead(n)).length;
    if (readItemsCount === 0) {
      toast.error("No read notifications to delete");
      return;
    }
    if (!confirm(`Are you sure you want to permanently delete all ${readItemsCount} read notifications?`)) return;
    try {
      await deleteReadMutation.mutateAsync();
      toast.success("Read notifications deleted successfully");
      invalidate();
    } catch {
      toast.error("Failed to delete read notifications");
    }
  };

  const TABS: { id: FilterTab; label: string; icon: LucideIcon }[] = [
    { id: "all", label: "All", icon: Inbox },
    { id: "announcement", label: "Announcements", icon: Megaphone },
    { id: "alert", label: "Alerts", icon: Siren },
    { id: "reminder", label: "Reminders", icon: BellRing },
    { id: "payment_received", label: "Payments", icon: CreditCard },
    { id: "deficit_alert", label: "Deficits", icon: AlertTriangle },
    { id: "wins_summary", label: "Wins", icon: Trophy },
    { id: "debt_query", label: "Debt", icon: FileQuestion },
  ];

  /* Search, then unread before read - the order the reader works through them. */
  const needle = search.trim().toLowerCase();
  const visible = needle
    ? filtered.filter(n => `${n.title} ${n.body}`.toLowerCase().includes(needle))
    : filtered;
  const ordered = [...visible.filter(n => !isRead(n)), ...visible.filter(n => isRead(n))];
  const paged = usePaged(ordered, NOTIF_PAGE, `${tab}|${needle}`);
  const today = new Date().toDateString();
  const todayCount = notifList.filter(n => new Date(n.createdAt).toDateString() === today).length;
  const alertCount = notifList.filter(n => (n.messageType === "alert" || n.messageType === "deficit_alert") && !isRead(n)).length;
  const tabLabel = TABS.find(t => t.id === tab)?.label ?? "All";

  const report = (): TableReport => ({
    title: "Notifications",
    fileName: `notifications_${new Date().toISOString().slice(0, 10)}`,
    orientation: "landscape",
    meta: [
      { label: "Category", value: tabLabel },
      ...(needle ? [{ label: "Search", value: search.trim() }] : []),
    ],
    summary: [
      `${ordered.length} notification(s) · ${ordered.filter(n => !isRead(n)).length} unread`,
      `Recipient: ${user?.fullName ?? "—"}`,
    ],
    sections: [{
      columns: [{ header: "Date" }, { header: "Type" }, { header: "Title" }, { header: "Message" }, { header: "To" }, { header: "Status" }],
      rows: ordered.map(n => [
        fullDate(n.createdAt),
        (TYPE_CFG[n.messageType as keyof typeof TYPE_CFG] ?? TYPE_CFG.announcement).label,
        n.title,
        n.body,
        TARGET_LABELS[n.targetType] ?? n.targetType,
        isRead(n) ? "Read" : "Unread",
      ]),
      empty: "No notifications.",
    }],
  });

  const firstReadOnPage = paged.rows.findIndex(n => isRead(n));

  return (
    <div className="p-4 sm:p-6 space-y-6 min-w-0">
      {/* ── Header, as on Inventory, Payments and Reports ── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border border-border/80 bg-card/60 backdrop-blur-md p-5 sm:p-6 rounded-3xl shadow-sm">
        <div className="flex items-center gap-4 min-w-0">
          <div className="relative shrink-0">
            <div className="p-3 bg-primary/10 text-primary rounded-2xl shadow-inner border border-primary/10">
              <Bell className="w-7 h-7" />
            </div>
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full border-2 border-card bg-red-500 px-1 text-[10px] font-bold text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-black tracking-tight text-foreground">Notifications</h1>
            <p className="text-xs text-muted-foreground mt-1 font-medium">
              {unreadCount > 0 ? `${unreadCount} unread message${unreadCount !== 1 ? "s" : ""} waiting` : "You're all caught up"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start lg:self-center">
          {unreadCount > 0 && (
            <Button size="sm" variant="outline" className="h-8 gap-1.5 rounded-lg text-xs font-bold" onClick={markAllRead}>
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </Button>
          )}
          {notifList.some(n => isRead(n)) && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 rounded-lg border-red-500/30 text-xs font-bold text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400"
              onClick={handleDeleteRead}
              disabled={deleteReadMutation.isPending}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete read
            </Button>
          )}
          {canCompose && (
            <Button size="sm" className="h-8 gap-1.5 rounded-lg text-xs font-bold" onClick={() => setComposeOpen(true)}>
              <PenSquare className="h-3.5 w-3.5" /> Compose
            </Button>
          )}
        </div>
      </div>

      {/* ── At a glance ── */}
      <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Unread" value={String(unreadCount)} sub={unreadCount ? "Waiting for you" : "All caught up"} icon={Mail} tone={unreadCount ? "warn" : "in"} />
        <StatTile label="In your inbox" value={String(notifList.length)} sub={`${notifList.length - notifList.filter(n => !isRead(n)).length} read`} icon={Inbox} />
        <StatTile label="Unread alerts" value={String(alertCount)} sub="Alerts and deficit alerts" icon={Siren} tone={alertCount ? "bad" : "muted"} />
        <StatTile label="Received today" value={String(todayCount)} sub={new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })} icon={CalendarDays} />
      </div>

      {/* ── Category tabs: scroll sideways on a narrow screen ── */}
      <div className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border/60 thin-scroll" role="tablist" aria-label="Notification categories">
        {TABS.map(t => {
          const unreadInTab = unreadByType[t.id] ?? 0;
          const isActive = tab === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setTab(t.id)}
              className={[
                "flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-3 text-xs font-bold transition-colors",
                isActive ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
              {counts[t.id] > 0 && (
                <span className={[
                  "min-w-[18px] rounded-full px-1.5 py-0.5 text-center text-[10px] font-black",
                  unreadInTab > 0 ? "bg-red-500/15 text-red-600 dark:text-red-400" : "bg-muted text-muted-foreground",
                ].join(" ")}>
                  {counts[t.id]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── The list ── */}
      <Panel
        title={tab === "all" ? "Inbox" : tabLabel}
        icon={Inbox}
        subtitle={`${ordered.length} message${ordered.length === 1 ? "" : "s"}${needle ? " matching your search" : ""} · unread first · click one to mark it read`}
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search title or message"
                aria-label="Search notifications"
                className="h-8 w-56 rounded-lg pl-8 text-xs md:text-xs"
              />
            </div>
            <ReportActions
              label="these notifications"
              disabled={ordered.length === 0}
              onPdf={() => exportReportPdf(report())}
              onPrint={() => printReport(report())}
            />
          </>
        }
        footer={<Pager page={paged.page} totalPages={paged.totalPages} onPage={paged.setPage} total={paged.total} size={paged.size} noun="notifications" />}
      >
        {/* A scroll box of its own, so a long page of messages never pushes the pager out of reach. */}
        <div className="max-h-[42rem] overflow-y-auto overscroll-contain thin-scroll p-4 sm:p-5">
          {isLoading ? (
            <div className="space-y-3">{[1, 2, 3].map(i => <SkeletonCard key={i} />)}</div>
          ) : ordered.length === 0 ? (
            <EmptyState filtered={tab !== "all" || !!needle} />
          ) : (
            <div className="space-y-3">
              {paged.rows.map((n, i) => (
                <div key={n.id} className="space-y-3">
                  {i === 0 && !isRead(n) && <SectionRule label="Unread" />}
                  {i === firstReadOnPage && <SectionRule label={i === 0 && paged.page > 1 ? "Earlier (continued)" : "Earlier"} />}
                  <NotifCard n={n} isRead={isRead(n)} onRead={handleMarkRead} />
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>

      {/* Compose sheet */}
      <ComposeSheet
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        agentList={agentList}
        allWriters={allWriters}
      />
    </div>
  );
}
