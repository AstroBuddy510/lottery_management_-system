import { useState } from "react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const MSG_TYPE_OPTIONS: { value: NotificationInputMessageType; label: string }[] = [
  { value: "announcement", label: "Announcement" },
  { value: "alert", label: "Alert" },
  { value: "reminder", label: "Reminder" },
];

const TARGET_TYPE_OPTIONS: { value: NotificationInputTargetType; label: string }[] = [
  { value: "all", label: "All Users" },
  { value: "all_agents", label: "All Agents" },
  { value: "agent", label: "Specific Agent" },
  { value: "writer", label: "Specific Writer" },
];

const MSG_TYPE_COLORS: Record<string, string> = {
  announcement: "bg-blue-500/10 text-blue-700 border-blue-200",
  alert: "bg-red-500/10 text-red-700 border-red-200",
  reminder: "bg-amber-500/10 text-amber-700 border-amber-200",
};

export function Notifications() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const canCompose = user?.role === "director" || user?.role === "administrator";

  const { agentList, allWriters } = useWriterLookup();

  const { data: notifications, isLoading } = useListNotifications();
  const { data: unread } = useGetUnreadCount({ query: { queryKey: getGetUnreadCountQueryKey() } });
  const sendMutation = useSendNotification();
  const markReadMutation = useMarkNotificationRead();

  const [composeOpen, setComposeOpen] = useState(false);
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

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await sendMutation.mutateAsync({
        data: {
          messageType: form.messageType,
          title: form.title,
          body: form.body,
          targetType: form.targetType,
          targetId: (form.targetType === "agent" || form.targetType === "writer") ? form.targetId : undefined,
        }
      });
      toast({ title: "Notification sent" });
      setComposeOpen(false);
      setForm({ messageType: "announcement", title: "", body: "", targetType: "all", targetId: "" });
      invalidate();
    } catch {
      toast({ title: "Failed to send notification", variant: "destructive" });
    }
  };

  const handleMarkRead = async (n: NotificationWithReceipt) => {
    if (n.readAt) return;
    try {
      await markReadMutation.mutateAsync({ id: n.id });
      invalidate();
    } catch {
      // silent
    }
  };

  const markAllRead = async () => {
    const unreadItems = notifList.filter(n => !n.readAt);
    await Promise.all(unreadItems.map(n => markReadMutation.mutateAsync({ id: n.id }).catch(() => {})));
    invalidate();
  };

  const notifList = Array.isArray(notifications) ? notifications : [];
  const unreadCount = unread?.count ?? 0;

  const needsTargetId = form.targetType === "agent" || form.targetType === "writer";
  const targetOptions = form.targetType === "agent"
    ? agentList.map(a => ({ id: a.id, label: `${a.fullCode} — ${a.user?.fullName ?? ""}` }))
    : allWriters.map(w => ({ id: w.id, label: `${w.fullCode} — ${w.fullName}` }));

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Notifications</h1>
          {unreadCount > 0 && (
            <Badge variant="destructive" className="text-xs">{unreadCount} unread</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <Button size="sm" variant="outline" className="text-xs" onClick={markAllRead}>Mark all read</Button>
          )}
          {canCompose && <Button size="sm" onClick={() => setComposeOpen(true)}>Compose</Button>}
        </div>
      </div>

      <div className="space-y-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
        ) : notifList.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No notifications.</p>
        ) : notifList.map(n => (
          <div
            key={n.id}
            onClick={() => handleMarkRead(n)}
            className={cn(
              "border rounded-lg p-4 cursor-pointer transition-colors",
              !n.readAt ? "bg-primary/5 border-primary/30 hover:bg-primary/10" : "bg-card hover:bg-muted/40"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  {!n.readAt && <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
                  <span className="text-sm font-semibold truncate">{n.title}</span>
                  <span className={cn("text-xs px-1.5 py-0.5 rounded border flex-shrink-0", MSG_TYPE_COLORS[n.messageType] ?? "bg-muted text-muted-foreground border-muted")}>
                    {n.messageType}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{n.body}</p>
              </div>
              <div className="text-xs text-muted-foreground flex-shrink-0 text-right">
                {new Date(n.createdAt).toLocaleDateString()}
                <br />
                {new Date(n.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                {n.readAt && <div className="text-primary/60 mt-0.5">Read</div>}
              </div>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Compose Notification</DialogTitle></DialogHeader>
          <form onSubmit={handleSend} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Type</Label>
                <Select value={form.messageType} onValueChange={v => setForm(f => ({ ...f, messageType: v as NotificationInputMessageType }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>{MSG_TYPE_OPTIONS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Send To</Label>
                <Select value={form.targetType} onValueChange={v => setForm(f => ({ ...f, targetType: v as NotificationInputTargetType, targetId: "" }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>{TARGET_TYPE_OPTIONS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            {needsTargetId && (
              <div className="space-y-1.5">
                <Label className="text-xs">{form.targetType === "agent" ? "Select Agent" : "Select Writer"}</Label>
                <Select value={form.targetId} onValueChange={v => setForm(f => ({ ...f, targetId: v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder={`Choose ${form.targetType}…`} /></SelectTrigger>
                  <SelectContent>
                    {targetOptions.map(o => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">Subject</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required className="h-9 text-sm" placeholder="Notification subject..." />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Message</Label>
              <Textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} required className="text-sm min-h-[80px]" placeholder="Write your message..." />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setComposeOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={sendMutation.isPending || (needsTargetId && !form.targetId)}>Send</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
