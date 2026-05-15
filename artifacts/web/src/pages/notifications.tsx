import { useState } from "react";
import {
  useListNotifications, useGetUnreadCount, useSendNotification, useMarkNotificationRead,
  getListNotificationsQueryKey, getGetUnreadCountQueryKey,
  NotificationWithReceipt, NotificationInputTargetType, NotificationInputMessageType,
} from "@workspace/api-client-react";
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

export function Notifications() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const canCompose = user?.role === "director" || user?.role === "administrator";

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
          targetId: form.targetId || undefined,
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

  const notifList = Array.isArray(notifications) ? notifications : [];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Notifications</h1>
          {(unread?.count ?? 0) > 0 && (
            <Badge variant="destructive" className="text-xs">{unread!.count} unread</Badge>
          )}
        </div>
        {canCompose && <Button size="sm" onClick={() => setComposeOpen(true)}>Compose</Button>}
      </div>

      <div className="space-y-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : notifList.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notifications.</p>
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
                <div className="flex items-center gap-2 mb-1">
                  {!n.readAt && <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
                  <span className="text-sm font-medium truncate">{n.title}</span>
                  <Badge variant="outline" className="text-xs flex-shrink-0">{n.messageType}</Badge>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{n.body}</p>
              </div>
              <div className="text-xs text-muted-foreground flex-shrink-0 text-right">
                {new Date(n.createdAt).toLocaleDateString()}
                <br />
                {new Date(n.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Compose Notification</DialogTitle></DialogHeader>
          <form onSubmit={handleSend} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Type</Label>
              <Select value={form.messageType} onValueChange={v => setForm(f => ({ ...f, messageType: v as NotificationInputMessageType }))}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{MSG_TYPE_OPTIONS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Target</Label>
              <Select value={form.targetType} onValueChange={v => setForm(f => ({ ...f, targetType: v as NotificationInputTargetType, targetId: "" }))}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{TARGET_TYPE_OPTIONS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {(form.targetType === "agent" || form.targetType === "writer") && (
              <div className="space-y-1.5">
                <Label className="text-xs">{form.targetType === "agent" ? "Agent ID" : "Writer ID"}</Label>
                <Input value={form.targetId} onChange={e => setForm(f => ({ ...f, targetId: e.target.value }))} required className="h-9 text-sm" placeholder="UUID" />
              </div>
            )}
            <div className="space-y-1.5"><Label className="text-xs">Subject</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required className="h-9 text-sm" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Message</Label><Textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} required className="text-sm min-h-[80px]" /></div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setComposeOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={sendMutation.isPending}>Send</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
