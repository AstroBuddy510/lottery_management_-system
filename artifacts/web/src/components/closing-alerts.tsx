import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Clock, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  minutesLeft,
  type ClosingAlert,
  type ClosingThreshold,
} from "@/lib/use-closing-alerts";

/**
 * How each warning looks and how long it stays.
 *
 * The escalation is deliberate: a writer glancing down should read urgency
 * from the colour before they read the words. The last one does not
 * auto-dismiss - with five minutes on the clock the writer wants it in view
 * while they finish the slip - but it is still only a floating card they can
 * flick away, never a dialog they must answer.
 */
const LOOKS: Record<
  ClosingThreshold,
  { tone: string; dot: string; dwellMs: number | null; lead: string }
> = {
  30: {
    tone: "border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-500/40 dark:bg-sky-950/80 dark:text-sky-50",
    dot: "bg-sky-500",
    dwellMs: 10_000,
    lead: "Closing in 30 minutes",
  },
  15: {
    tone: "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/80 dark:text-amber-50",
    dot: "bg-amber-500",
    dwellMs: 12_000,
    lead: "Closing in 15 minutes",
  },
  10: {
    tone: "border-orange-300 bg-orange-50 text-orange-950 dark:border-orange-500/40 dark:bg-orange-950/80 dark:text-orange-50",
    dot: "bg-orange-500",
    dwellMs: 15_000,
    lead: "Closing in 10 minutes",
  },
  5: {
    tone: "border-red-400 bg-red-50 text-red-950 dark:border-red-500/50 dark:bg-red-950/85 dark:text-red-50",
    dot: "bg-red-500",
    dwellMs: null,
    lead: "Closing in 5 minutes",
  },
};

/**
 * A short buzz on the final warning only. The phone is in the writer's hand
 * and the market is loud; this is the one alert worth feeling. Silently
 * unavailable on desktop and on browsers that gate it behind a gesture, which
 * is why nothing depends on it working.
 */
function buzz(): void {
  try {
    navigator.vibrate?.([120, 80, 120]);
  } catch {
    /* no haptics - the card is still on screen */
  }
}

function AlertCard({
  alert,
  now,
  onDismiss,
}: {
  alert: ClosingAlert;
  now: number;
  onDismiss: () => void;
}) {
  const look = LOOKS[alert.minutes];
  const left = minutesLeft(alert.closeAt, now);
  const mins = Math.floor(Math.max(left, 0));
  const secs = Math.floor((Math.max(left, 0) - mins) * 60);

  useEffect(() => {
    if (alert.minutes === 5) buzz();
  }, [alert.minutes, alert.id]);

  useEffect(() => {
    if (look.dwellMs === null) return;
    const t = setTimeout(onDismiss, look.dwellMs);
    return () => clearTimeout(t);
    // onDismiss is stable enough for a one-shot timer; re-arming it on every
    // render would mean the card never actually left.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert.id, look.dwellMs]);

  const Icon = alert.minutes <= 10 ? AlertTriangle : Clock;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      className={cn(
        // pointer-events-auto only on the card itself: the rest of the strip
        // stays transparent to taps so nothing underneath becomes unreachable.
        "pointer-events-auto flex items-start gap-3 rounded-xl border px-3.5 py-3 shadow-lg backdrop-blur-sm",
        look.tone,
      )}
    >
      <span className="relative mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
        {alert.minutes === 5 && (
          <span
            className={cn(
              "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60",
              look.dot,
            )}
          />
        )}
        <Icon className="relative h-4.5 w-4.5" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold leading-tight">{look.lead}</p>
        <p className="mt-0.5 truncate text-xs opacity-90">
          {alert.gameName}
          {alert.eventNumber ? ` (${alert.eventNumber})` : ""}
        </p>
        <p className="mt-1 font-mono text-xs font-semibold tabular-nums opacity-80">
          {mins}m {String(secs).padStart(2, "0")}s left
        </p>
      </div>

      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss closing reminder"
        className="-mr-1 -mt-1 shrink-0 rounded-md p-1.5 opacity-55 transition-opacity hover:opacity-100"
      >
        <X className="h-4 w-4" />
      </button>
    </motion.div>
  );
}

/**
 * The strip the warnings live in.
 *
 * Fixed, so it never reflows the page - a layout shift under a writer's thumb
 * mid-bet is exactly the interference we are avoiding. It sits above the
 * mobile tab bar and out at the top on desktop, clear of the number pad and
 * the stake field either way. `aria-live="polite"` so a screen reader waits
 * for a pause instead of cutting across what the writer is doing.
 */
export function ClosingAlerts({
  alerts,
  now,
  onDismiss,
}: {
  alerts: ClosingAlert[];
  now: number;
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="false"
      className={cn(
        "pointer-events-none fixed z-40 flex flex-col gap-2",
        // Phones: just above the bottom tab bar, honouring the home indicator.
        "inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))]",
        // Desktop: top right of the content column, clear of the sidebar.
        "lg:inset-x-auto lg:bottom-auto lg:right-6 lg:top-5 lg:w-[21rem]",
      )}
    >
      <AnimatePresence initial={false}>
        {alerts.map((a) => (
          <AlertCard key={a.id} alert={a} now={now} onDismiss={() => onDismiss(a.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
}
