import { useEffect, useRef, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronDown, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * The writer portal's "older records" pattern, shared by My Tickets and the
 * Wallet: current items sit open at the top of the page; everything older
 * lives in one section that is closed by default, opens with a slide and a
 * smooth scroll, and pages through the history a screenful at a time.
 */

/** Smooth, unless the phone has asked for less motion. */
export function scrollToTop(el: HTMLElement | null) {
  if (!el) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

/** Page numbers that fit a phone: first, last, and one either side. */
function pageList(page: number, total: number): (number | "…")[] {
  const out: (number | "…")[] = [];
  for (let p = 1; p <= total; p++) {
    if (p === 1 || p === total || Math.abs(p - page) <= 1) out.push(p);
    else if (out[out.length - 1] !== "…") out.push("…");
  }
  return out;
}

export function Pager({ page, totalPages, busy, onPage, label, summary }: {
  page: number;
  totalPages: number;
  busy: boolean;
  onPage: (p: number) => void;
  /** For screen readers, e.g. "Past tickets pages". */
  label: string;
  /** The line under the buttons, e.g. "41–49 of 49 past tickets". */
  summary: ReactNode;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label={label} className="pt-3 border-t border-border/60 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" className="h-9 rounded-lg px-2.5" disabled={page <= 1 || busy} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-1">
          {pageList(page, totalPages).map((p, i) =>
            p === "…" ? (
              <span key={`gap-${i}`} className="px-1 text-xs text-muted-foreground">…</span>
            ) : (
              <Button
                key={p}
                size="sm"
                variant={p === page ? "default" : "ghost"}
                className="h-9 min-w-9 rounded-lg px-2 text-xs tabular-nums"
                aria-current={p === page ? "page" : undefined}
                disabled={busy && p !== page}
                onClick={() => p !== page && onPage(p)}
              >
                {p}
              </Button>
            ),
          )}
        </div>
        <Button variant="outline" size="sm" className="h-9 rounded-lg px-2.5" disabled={page >= totalPages || busy} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <p className="text-center text-[11px] text-muted-foreground tabular-nums">{summary}</p>
    </nav>
  );
}

export function PastSection({
  title, icon: Icon, count, description, open, onOpenChange,
  loading, error, empty, emptyText, refreshing, page, onPage, pager, children,
}: {
  title: string;
  icon: LucideIcon;
  /** Shown as a badge on the closed header. */
  count?: number;
  description: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  error?: Error | null;
  empty: boolean;
  emptyText: string;
  /** The previous page is on screen while the next one loads. */
  refreshing: boolean;
  page: number;
  onPage: (p: number) => void;
  /** The Pager, given the wrapped page handler. */
  pager: (goTo: (p: number) => void) => ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const turned = useRef(false);

  // After a page change, bring the top of the section back into view: the
  // writer tapped at the bottom of a list that has just been replaced.
  useEffect(() => {
    if (!turned.current || refreshing) return;
    turned.current = false;
    scrollToTop(ref.current);
  }, [page, refreshing]);

  const goTo = (p: number) => {
    turned.current = true;
    onPage(p);
  };

  const toggle = (next: boolean) => {
    onOpenChange(next);
    // Let the section start opening, then glide to it.
    if (next) window.setTimeout(() => scrollToTop(ref.current), 120);
  };

  return (
    <div ref={ref} className="scroll-mt-20">
      <Collapsible open={open} onOpenChange={toggle}>
        <Card className="overflow-hidden rounded-2xl border-0 shadow-sm ring-1 ring-border/70">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="w-full text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={open ? `Hide ${title.toLowerCase()}` : `Show ${title.toLowerCase()}`}
            >
              <CardHeader className="py-4 flex-row items-center justify-between gap-3 space-y-0">
                <div className="min-w-0 space-y-1">
                  <CardTitle className="text-base flex items-center gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </span>
                    {title}
                    {!!count && count > 0 && (
                      <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-bold tabular-nums">{count}</Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="text-xs pl-[42px]">{description}</CardDescription>
                </div>
                <ChevronDown
                  className={cn("h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-300", open && "rotate-180")}
                />
              </CardHeader>
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
            <CardContent className="px-3 sm:px-5 pt-0 border-t">
              {loading ? (
                <div className="py-10 text-center"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
              ) : error ? (
                <p className="py-8 text-center text-sm text-destructive">{error.message}</p>
              ) : empty ? (
                <p className="py-8 text-center text-sm text-muted-foreground">{emptyText}</p>
              ) : (
                <>
                  <div className={cn("transition-opacity duration-200", refreshing && "opacity-50")}>{children}</div>
                  {pager(goTo)}
                </>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}
