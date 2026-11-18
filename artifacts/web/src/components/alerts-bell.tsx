import { useState } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, Bell, BellOff, Calculator, ChevronRight, HandCoins, Radio, ShieldAlert, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAlerts, markGameSeen, type AlertItem } from "@/lib/use-alerts";
import { cn } from "@/lib/utils";

const AREA: Record<AlertItem["area"], { label: string; icon: LucideIcon }> = {
  risk: { label: "Risk Management", icon: ShieldAlert },
  "live-ticker": { label: "Live Ticker", icon: Radio },
  finance: { label: "Finance & Statements", icon: HandCoins },
  payments: { label: "Payments", icon: Wallet },
  draws: { label: "Run Draws", icon: Calculator },
  notifications: { label: "Notifications", icon: Bell },
};
const ORDER: AlertItem["area"][] = ["risk", "draws", "live-ticker", "payments", "finance", "notifications"];
const TONE = {
  urgent: "border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-400",
  warn: "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400",
  info: "border-sky-500/30 bg-sky-500/5 text-sky-700 dark:text-sky-400",
} as const;

/**
 * The bell: how many things want attention, and a modal listing every one
 * of them with a way straight to the page that deals with it.
 */
export function AlertsBell({ variant = "light", className }: { variant?: "light" | "sidebar"; className?: string }) {
  const { alerts, total } = useAlerts();
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const urgent = alerts.some((a) => a.tone === "urgent");
  const go = (a: AlertItem) => {
    setOpen(false);
    if (a.area === "live-ticker") {
      const id = a.key.split(":")[1];
      if (id) markGameSeen(id);
    }
    navigate(a.href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={total ? `Alerts: ${total} need attention` : "Alerts: nothing needs attention"}
        title="Alerts"
        className={cn(
          "relative inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors",
          variant === "light" ? "border bg-card shadow-sm hover:bg-muted" : "hover:bg-sidebar-accent",
          className,
        )}
      >
        <Bell className={cn("h-[18px] w-[18px]", total && "motion-safe:animate-[wiggle_1.2s_ease-in-out_2]")} />
        {total > 0 && (
          <span aria-hidden className="absolute -top-1 -right-1 inline-flex">
            <span className={cn("absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping", urgent ? "bg-rose-500" : "bg-amber-500")} />
            <span className={cn("relative min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black leading-[18px] text-center text-white tabular-nums", urgent ? "bg-rose-500 shadow-[0_0_8px_2px_rgba(244,63,94,0.6)]" : "bg-amber-500 shadow-[0_0_8px_2px_rgba(245,158,11,0.6)]")}>
              {total > 99 ? "99+" : total}
            </span>
          </span>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto thin-scroll">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Bell className="h-4 w-4" /> Alerts</DialogTitle>
            <DialogDescription>
              {total ? `${total} item${total === 1 ? "" : "s"} want${total === 1 ? "s" : ""} attention. Choose one to go straight to it.` : "Nothing needs attention right now."}
            </DialogDescription>
          </DialogHeader>
          {total === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
              <BellOff className="h-8 w-8 opacity-50" />
              <span className="text-sm">All clear</span>
            </div>
          ) : (
            <div className="space-y-4">
              {ORDER.filter((area) => alerts.some((a) => a.area === area)).map((area) => {
                const A = AREA[area];
                return (
                  <section key={area}>
                    <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-muted-foreground">
                      <A.icon className="h-3.5 w-3.5" /> {A.label}
                    </div>
                    <ul className="space-y-1.5">
                      {alerts.filter((a) => a.area === area).map((a) => (
                        <li key={a.key}>
                          <button type="button" onClick={() => go(a)}
                            className={cn("group flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-muted/60", TONE[a.tone])}>
                            {a.tone === "urgent" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-current" />}
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold text-foreground">{a.title}</span>
                              {a.detail && <span className="block truncate text-xs text-muted-foreground">{a.detail}</span>}
                            </span>
                            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
