import { useState, useMemo } from "react";
import {
  useListNotifications, useGetUnreadCount, useSendNotification, useMarkNotificationRead,
  getListNotificationsQueryKey, getGetUnreadCountQueryKey,
  NotificationWithReceipt, NotificationInputTargetType, NotificationInputMessageType,
} from "@workspace/api-client-react";
import { useWriterLookup } from "@/lib/use-writer-lookup";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

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
    bg: "bg-blue-50",
    dot: "bg-blue-500",
    badgeBg: "bg-blue-100 text-blue-700",
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
    bg: "bg-red-50",
    dot: "bg-red-500",
    badgeBg: "bg-red-100 text-red-700",
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
    bg: "bg-amber-50",
    dot: "bg-amber-500",
    badgeBg: "bg-amber-100 text-amber-700",
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
    bg: "bg-emerald-50",
    dot: "bg-emerald-500",
    badgeBg: "bg-emerald-100 text-emerald-700",
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
    bg: "bg-violet-50",
    dot: "bg-violet-500",
    badgeBg: "bg-violet-100 text-violet-700",
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
    bg: "bg-rose-50",
    dot: "bg-rose-600",
    badgeBg: "bg-rose-100 text-rose-700",
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
    bg: "bg-orange-50",
    dot: "bg-orange-500",
    badgeBg: "bg-orange-100 text-orange-700",
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
};

/* ─── skeleton card ──────────────────────────────────────────────────────── */

function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex gap-4 animate-pulse">
      <div className="w-9 h-9 rounded-xl bg-slate-200 flex-shrink-0" />
      <div className="flex-1 space-y-2.5">
        <div className="flex items-center gap-2">
          <div className="h-3 w-32 bg-slate-200 rounded-full" />
          <div className="h-3 w-16 bg-slate-100 rounded-full" />
        </div>
        <div className="h-3 w-full bg-slate-100 rounded-full" />
        <div className="h-3 w-2/3 bg-slate-100 rounded-full" />
        <div className="h-2.5 w-14 bg-slate-100 rounded-full mt-1" />
      </div>
    </div>
  );
}

/* ─── empty state ────────────────────────────────────────────────────────── */

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4">
      <div className="relative mb-6">
        <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center" style={{ animation: "notif-float 3s ease-in-out infinite" }}>
          <svg className="w-9 h-9 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 01-3.46 0"/>
          </svg>
        </div>
        <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-emerald-400 border-2 border-white flex items-center justify-center">
          <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><polyline points="20 6 9 17 4 12"/></svg>
        </div>
      </div>
      <p className="text-base font-semibold text-slate-700 mb-1">
        {filtered ? "No notifications match this filter" : "Your inbox is empty"}
      </p>
      <p className="text-sm text-slate-400 text-center max-w-xs">
        {filtered ? "Try a different category above." : "Notifications sent to you will appear here. Check back soon."}
      </p>
      <style>{`
        @keyframes notif-float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
      `}</style>
    </div>
  );
}

/* ─── notification card ──────────────────────────────────────────────────── */

function NotifCard({
  n,
  onRead,
}: {
  n: NotificationWithReceipt;
  onRead: (n: NotificationWithReceipt) => void;
}) {
  const [justRead, setJustRead] = useState(false);
  const cfg = TYPE_CFG[n.messageType as keyof typeof TYPE_CFG] ?? TYPE_CFG.announcement;
  const isUnread = !n.readAt && !justRead;

  const handleClick = () => {
    if (isUnread) { setJustRead(true); onRead(n); }
  };

  return (
    <div
      onClick={handleClick}
      className={[
        "group relative bg-white rounded-2xl border border-l-4 shadow-sm transition-all duration-300 overflow-hidden cursor-pointer",
        cfg.border,
        isUnread
          ? "shadow-md hover:shadow-lg border-slate-100"
          : "opacity-80 hover:opacity-100 border-slate-100",
      ].join(" ")}
    >
      {/* Unread glow strip */}
      {isUnread && (
        <div className={`absolute inset-0 ${cfg.bg} opacity-30 pointer-events-none`} />
      )}

      <div className="relative flex items-start gap-4 p-5">
        {/* Type icon */}
        <div className={`w-9 h-9 rounded-xl ${cfg.iconBg} flex items-center justify-center flex-shrink-0 shadow-sm mt-0.5`}>
          {cfg.icon}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                {isUnread && (
                  <span className={`w-2 h-2 rounded-full ${cfg.dot} flex-shrink-0`} style={{ animation: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite" }} />
                )}
                <span className={`text-sm font-bold leading-tight ${isUnread ? "text-slate-900" : "text-slate-600"}`}>
                  {n.title}
                </span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${cfg.badgeBg}`}>
                  {cfg.label}
                </span>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 flex-shrink-0">
                  → {TARGET_LABELS[n.targetType] ?? n.targetType}
                </span>
              </div>
              <p className={`text-sm leading-relaxed ${isUnread ? "text-slate-700" : "text-slate-400"}`}>
                {n.body}
              </p>
            </div>

            {/* Time + status */}
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <span className="text-xs text-slate-400 font-medium whitespace-nowrap" title={fullDate(n.createdAt)}>
                {relativeTime(n.createdAt)}
              </span>
              {!isUnread && (
                <span className="text-[10px] text-emerald-500 font-semibold flex items-center gap-0.5">
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><polyline points="20 6 9 17 4 12"/></svg>
                  Read
                </span>
              )}
              {isUnread && (
                <span className="text-[10px] text-slate-400 group-hover:text-slate-600 transition-colors">
                  Tap to read
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
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
        <SheetHeader className="px-6 pt-6 pb-4 border-b bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </div>
            <div>
              <SheetTitle className="text-base font-bold leading-tight">Compose Notification</SheetTitle>
              <p className="text-xs text-slate-400 mt-0.5">Send to your team or specific members</p>
            </div>
          </div>
        </SheetHeader>

        <form onSubmit={handleSend} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Live preview badge row */}
          <div className={`flex items-center gap-2 p-3 rounded-xl border-l-4 ${cfg.border} ${cfg.bg}`}>
            <div className={`w-7 h-7 rounded-lg ${cfg.iconBg} flex items-center justify-center flex-shrink-0`}>{cfg.icon}</div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-700 truncate">{form.title || "Notification preview…"}</p>
              <p className="text-[11px] text-slate-400 truncate">{form.body || "Message body will appear here"}</p>
            </div>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cfg.badgeBg}`}>{cfg.label}</span>
          </div>

          {/* Type + Audience */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-600">Message Type</Label>
              <Select value={form.messageType} onValueChange={v => setForm(f => ({ ...f, messageType: v as NotificationInputMessageType }))}>
                <SelectTrigger className="h-9 text-sm bg-white">
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
              <Label className="text-xs font-semibold text-slate-600">Send To</Label>
              <Select value={form.targetType} onValueChange={v => setForm(f => ({ ...f, targetType: v as NotificationInputTargetType, targetId: "" }))}>
                <SelectTrigger className="h-9 text-sm bg-white">
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
              <Label className="text-xs font-semibold text-slate-600">
                {form.targetType === "agent" ? "Select Agent" : "Select Writer"}
              </Label>
              <Select value={form.targetId} onValueChange={v => setForm(f => ({ ...f, targetId: v }))}>
                <SelectTrigger className="h-9 text-sm bg-white">
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
              <Label className="text-xs font-semibold text-slate-600">Subject</Label>
              <span className="text-[10px] text-slate-400">{form.title.length}/80</span>
            </div>
            <Input
              value={form.title}
              maxLength={80}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              required
              className="h-9 text-sm bg-white"
              placeholder="Short, clear subject line…"
            />
          </div>

          {/* Body */}
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <Label className="text-xs font-semibold text-slate-600">Message</Label>
              <span className={`text-[10px] font-medium ${bodyLen > 450 ? "text-red-500" : "text-slate-400"}`}>{bodyLen}/500</span>
            </div>
            <Textarea
              value={form.body}
              maxLength={500}
              onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              required
              rows={5}
              className="text-sm resize-none bg-white"
              placeholder="Write your message here…"
            />
          </div>
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-slate-50/60 flex gap-3">
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

  const [tab, setTab] = useState<FilterTab>("all");
  const [composeOpen, setComposeOpen] = useState(false);

  const notifList = Array.isArray(notifications) ? notifications : [];
  const unreadCount = unread?.count ?? 0;

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

  const unreadByType = useMemo(() => ({
    all: notifList.filter(n => !n.readAt).length,
    announcement: notifList.filter(n => n.messageType === "announcement" && !n.readAt).length,
    alert: notifList.filter(n => n.messageType === "alert" && !n.readAt).length,
    reminder: notifList.filter(n => n.messageType === "reminder" && !n.readAt).length,
    payment_received: notifList.filter(n => n.messageType === "payment_received" && !n.readAt).length,
    wins_summary: notifList.filter(n => n.messageType === "wins_summary" && !n.readAt).length,
    deficit_alert: notifList.filter(n => n.messageType === "deficit_alert" && !n.readAt).length,
    debt_query: notifList.filter(n => n.messageType === "debt_query" && !n.readAt).length,
  }), [notifList]);

  const filtered = tab === "all" ? notifList : notifList.filter(n => n.messageType === tab);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetUnreadCountQueryKey() });
  };

  const handleMarkRead = async (n: NotificationWithReceipt) => {
    if (n.readAt) return;
    try {
      await markReadMutation.mutateAsync({ id: n.id });
      invalidate();
    } catch { /* silent */ }
  };

  const markAllRead = async () => {
    const items = notifList.filter(n => !n.readAt);
    await Promise.all(items.map(n => markReadMutation.mutateAsync({ id: n.id }).catch(() => {})));
    invalidate();
  };

  const TABS: { id: FilterTab; label: string; icon: string }[] = [
    { id: "all", label: "All", icon: "📬" },
    { id: "announcement", label: "Announcements", icon: "📢" },
    { id: "alert", label: "Alerts", icon: "🚨" },
    { id: "reminder", label: "Reminders", icon: "🔔" },
    { id: "payment_received", label: "Payments", icon: "💳" },
    { id: "deficit_alert", label: "Deficits", icon: "⚠️" },
    { id: "wins_summary", label: "Wins", icon: "🏆" },
    { id: "debt_query", label: "Debt", icon: "📋" },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Page header ── */}
      <div className="bg-white border-b px-6 pt-6 pb-0">
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-4">
            {/* Bell icon with pulse */}
            <div className="relative">
              <div className="w-11 h-11 rounded-2xl bg-slate-900 flex items-center justify-center shadow-sm">
                <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                  <path d="M13.73 21a2 2 0 01-3.46 0"/>
                </svg>
              </div>
              {unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1 border-2 border-white" style={{ animation: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite" }}>
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 leading-tight">Notifications</h1>
              <p className="text-xs text-slate-400 mt-0.5">
                {unreadCount > 0
                  ? `${unreadCount} unread message${unreadCount !== 1 ? "s" : ""} waiting`
                  : "You're all caught up"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-1">
            {unreadCount > 0 && (
              <Button size="sm" variant="outline" className="text-xs h-8 gap-1.5" onClick={markAllRead}>
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><polyline points="20 6 9 17 4 12"/></svg>
                Mark all read
              </Button>
            )}
            {canCompose && (
              <Button size="sm" className="h-8 gap-1.5 font-semibold" onClick={() => setComposeOpen(true)}>
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Compose
              </Button>
            )}
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-0.5 overflow-x-auto">
          {TABS.map(t => {
            const unreadInTab = unreadByType[t.id] ?? 0;
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={[
                  "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-all duration-150",
                  isActive
                    ? "border-slate-900 text-slate-900"
                    : "border-transparent text-slate-400 hover:text-slate-600",
                ].join(" ")}
              >
                <span className="text-base leading-none">{t.icon}</span>
                {t.label}
                {counts[t.id] > 0 && (
                  <span className={[
                    "text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center",
                    unreadInTab > 0
                      ? "bg-red-100 text-red-600"
                      : "bg-slate-100 text-slate-500",
                  ].join(" ")}>
                    {counts[t.id]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="max-w-2xl mx-auto px-4 py-6">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState filtered={tab !== "all"} />
        ) : (
          <div className="space-y-3">
            {/* Unread section header */}
            {filtered.some(n => !n.readAt) && (
              <div className="flex items-center gap-3 py-1">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Unread</span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
            )}

            {/* Unread first */}
            {filtered.filter(n => !n.readAt).map(n => (
              <NotifCard key={n.id} n={n} onRead={handleMarkRead} />
            ))}

            {/* Read section separator */}
            {filtered.some(n => !n.readAt) && filtered.some(n => n.readAt) && (
              <div className="flex items-center gap-3 py-1 pt-3">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Earlier</span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
            )}

            {/* Read items */}
            {filtered.filter(n => n.readAt).map(n => (
              <NotifCard key={n.id} n={n} onRead={handleMarkRead} />
            ))}
          </div>
        )}
      </div>

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
