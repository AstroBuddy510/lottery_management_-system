import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Lock, MessageCircle, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/**
 * Automated postpaid settlement, as an administrator sets it.
 *
 * The switch is the whole point: off, postpaid behaves exactly as it always
 * has. So the screen says plainly what turning it on will do to a writer's
 * day, rather than presenting a row of fields and leaving them to find out.
 */

interface AutoSettings {
  enabled: boolean;
  reminderLeadMinutes: string;
  graceMinutes: number;
  blockNextDay: boolean;
  minimumChargeable: string;
  whatsappEnabled: boolean;
  whatsappConfigured: boolean;
  lastSweptAt: string | null;
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${localStorage.getItem("accessToken")}`,
    "Content-Type": "application/json",
  };
}

export function AutoPostpaidSettings() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<AutoSettings>({
    queryKey: ["/api/postpaid/auto/settings"],
    queryFn: async () => {
      const res = await fetch("/api/postpaid/auto/settings", { headers: authHeaders() });
      if (!res.ok) throw new Error("Could not load settings");
      return res.json();
    },
  });

  const [form, setForm] = useState({
    enabled: false,
    reminderLeadMinutes: "30,15,5",
    graceMinutes: 0,
    blockNextDay: true,
    minimumChargeable: "0",
    whatsappEnabled: false,
  });

  useEffect(() => {
    if (!data) return;
    setForm({
      enabled: data.enabled,
      reminderLeadMinutes: data.reminderLeadMinutes,
      graceMinutes: data.graceMinutes,
      blockNextDay: data.blockNextDay,
      minimumChargeable: String(Number(data.minimumChargeable)),
      whatsappEnabled: data.whatsappEnabled,
    });
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/postpaid/auto/settings", {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({
          enabled: form.enabled,
          reminderLeadMinutes: form.reminderLeadMinutes,
          graceMinutes: Number(form.graceMinutes) || 0,
          blockNextDay: form.blockNextDay,
          minimumChargeable: Number(form.minimumChargeable) || 0,
          whatsappEnabled: form.whatsappEnabled,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Save failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/postpaid/auto/settings"] });
      toast({ title: form.enabled ? "Automated settlement is ON" : "Automated settlement is OFF" });
    },
    onError: (e: Error) => toast({ title: "Not saved", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border bg-card p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading settings…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className={form.enabled ? "border-amber-400/60" : undefined}>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Lock className="h-4 w-4" />
                Automated Postpaid Settlement
              </CardTitle>
              <CardDescription className="text-xs">
                Collects from postpaid writers during the game instead of only after it.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2.5">
              <Badge
                variant="outline"
                className={
                  form.enabled
                    ? "border-amber-400/60 bg-amber-500/10 text-[10px] font-bold text-amber-700 dark:text-amber-300"
                    : "text-[10px] font-bold"
                }
              >
                {form.enabled ? "ON" : "OFF"}
              </Badge>
              <Switch
                checked={form.enabled}
                onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
                aria-label="Enable automated postpaid settlement"
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* Say what the switch does, in the terms a writer will experience. */}
          <div className="rounded-lg border bg-muted/40 p-3.5 text-xs leading-relaxed">
            {form.enabled ? (
              <>
                <p className="font-semibold">While this is on, for every postpaid writer:</p>
                <ul className="mt-1.5 list-disc space-y-1 pl-4 text-muted-foreground">
                  <li>
                    Halfway through each game's selling window, selling stops unless that game's
                    takings have been handed in.
                  </li>
                  <li>Reminders go out before that point, and the terminal unlocks on payment.</li>
                  <li>
                    {form.blockNextDay
                      ? "An unpaid bill blocks selling the next day. They can still sign in, see what they owe and pay."
                      : "An unpaid bill does not block the next day."}
                  </li>
                </ul>
              </>
            ) : (
              <p className="text-muted-foreground">
                Postpaid works as it always has: writers sell through the whole game and settle
                after it closes. Nothing below has any effect until this is switched on.
              </p>
            )}
          </div>

          <fieldset disabled={!form.enabled} className="space-y-5 disabled:opacity-50">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="apps-leads" className="text-xs font-semibold">
                  Remind before lock (minutes)
                </Label>
                <Input
                  id="apps-leads"
                  value={form.reminderLeadMinutes}
                  onChange={(e) => setForm((f) => ({ ...f, reminderLeadMinutes: e.target.value }))}
                  placeholder="30,15,5"
                  className="h-9"
                />
                <p className="text-[11px] text-muted-foreground">
                  Comma separated. Each fires once per game.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="apps-grace" className="text-xs font-semibold">
                  Grace after midpoint (minutes)
                </Label>
                <Input
                  id="apps-grace"
                  type="number"
                  min={0}
                  max={240}
                  value={form.graceMinutes}
                  onChange={(e) => setForm((f) => ({ ...f, graceMinutes: Number(e.target.value) }))}
                  className="h-9"
                />
                <p className="text-[11px] text-muted-foreground">
                  0 locks exactly at the halfway point.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="apps-min" className="text-xs font-semibold">
                  Ignore balances under (GH₵)
                </Label>
                <Input
                  id="apps-min"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.minimumChargeable}
                  onChange={(e) => setForm((f) => ({ ...f, minimumChargeable: e.target.value }))}
                  className="h-9"
                />
                <p className="text-[11px] text-muted-foreground">
                  Stops a few pesewas locking a terminal.
                </p>
              </div>
            </div>

            <div className="flex items-start justify-between gap-4 rounded-lg border p-3.5">
              <div>
                <Label htmlFor="apps-nextday" className="text-xs font-semibold">
                  Block selling the next day if the bill is unpaid
                </Label>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  They can still sign in, view tickets and pay — only Place Bet is locked.
                </p>
              </div>
              <Switch
                id="apps-nextday"
                checked={form.blockNextDay}
                onCheckedChange={(v) => setForm((f) => ({ ...f, blockNextDay: v }))}
              />
            </div>

            <div className="flex items-start justify-between gap-4 rounded-lg border p-3.5">
              <div className="min-w-0">
                <Label htmlFor="apps-wa" className="flex items-center gap-1.5 text-xs font-semibold">
                  <MessageCircle className="h-3.5 w-3.5" />
                  Send reminders by WhatsApp
                </Label>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  In-app reminders always show. This adds WhatsApp on top.
                </p>
                {form.whatsappEnabled && !data?.whatsappConfigured && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                    No WhatsApp credentials are set on the server, so nothing will send yet. Add
                    WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID, and approve the message
                    template in your Meta Business account.
                  </p>
                )}
              </div>
              <Switch
                id="apps-wa"
                checked={form.whatsappEnabled}
                onCheckedChange={(v) => setForm((f) => ({ ...f, whatsappEnabled: v }))}
              />
            </div>
          </fieldset>

          <div className="flex items-center justify-between gap-3 border-t pt-4">
            <p className="text-[11px] text-muted-foreground">
              {data?.lastSweptAt
                ? `Reminders last checked ${new Date(data.lastSweptAt).toLocaleString()}`
                : "Reminders have not run yet."}
            </p>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
