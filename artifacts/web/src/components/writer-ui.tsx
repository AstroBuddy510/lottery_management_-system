import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The writer portal's shared building blocks, so every page - Home, Bet,
 * Tickets, Claim, Wallet - has the same header, the same cards and the same
 * section bands, and a change to the look is made once.
 */

/** Page title, one line of help, and an optional action on the right. */
export function WriterPageHeader({
  title, subtitle, icon: Icon, tone = "primary", action,
}: {
  title: string;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  tone?: "primary" | "amber" | "emerald";
  action?: ReactNode;
}) {
  const chip = {
    primary: "bg-primary/10 text-primary",
    amber: "bg-amber-500/15 text-amber-600",
    emerald: "bg-emerald-500/15 text-emerald-600",
  }[tone];
  return (
    <header className="flex items-center justify-between gap-3 px-1">
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", chip)}>
            <Icon className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-xl font-black tracking-tight">{title}</h1>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

/** A card: rounded, a soft ring instead of a hard border. */
export function WriterCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn("overflow-hidden rounded-2xl bg-card text-card-foreground shadow-sm ring-1 ring-border/70", className)}>
      {children}
    </section>
  );
}

/** The tinted band at the top of a card. */
export function WriterCardHeader({
  icon: Icon, title, count, description, right, tone = "primary",
}: {
  icon?: LucideIcon;
  title: ReactNode;
  count?: number;
  description?: ReactNode;
  right?: ReactNode;
  tone?: "primary" | "amber" | "emerald" | "muted";
}) {
  const band = {
    primary: "from-primary/[0.06]",
    amber: "from-amber-500/[0.08]",
    emerald: "from-emerald-500/[0.08]",
    muted: "from-muted/60",
  }[tone];
  const chip = {
    primary: "bg-primary/10 text-primary",
    amber: "bg-amber-500/15 text-amber-600",
    emerald: "bg-emerald-500/15 text-emerald-600",
    muted: "bg-muted text-muted-foreground",
  }[tone];
  return (
    <div className={cn("flex items-center justify-between gap-3 border-b bg-gradient-to-r to-transparent px-4 py-3", band)}>
      <div className="flex min-w-0 items-center gap-2.5">
        {Icon && (
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", chip)}>
            <Icon className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-bold sm:text-base">
            <span className="truncate">{title}</span>
            {count !== undefined && count > 0 && (
              <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-primary-foreground">{count}</span>
            )}
          </h2>
          {description && <p className="truncate text-[11px] text-muted-foreground">{description}</p>}
        </div>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

/** A numbered step label for a form laid out top to bottom. */
export function WriterStep({ n, title, hint, done }: { n: number; title: string; hint?: ReactNode; done?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-black",
        done ? "bg-emerald-500 text-white" : "bg-primary/10 text-primary",
      )}>
        {n}
      </span>
      <span className="text-sm font-semibold">{title}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}
