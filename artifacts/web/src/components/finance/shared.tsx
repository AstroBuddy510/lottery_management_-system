import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { FIN_KEY, errorText } from "@/lib/finance-api";
import { cn } from "@/lib/utils";

/** A labelled form row. */
export function Field({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs font-bold">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * A dialog that submits once, shows the server's reason when it refuses, and
 * refreshes every finance query when it succeeds.
 */
export function FormDialog({
  open, onOpenChange, title, description, submitLabel, onSubmit, disabled, children, successMessage, wide,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: React.ReactNode;
  submitLabel: string;
  onSubmit: () => Promise<unknown>;
  disabled?: boolean;
  children: React.ReactNode;
  successMessage: string;
  wide?: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: onSubmit,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: FIN_KEY });
      toast({ title: successMessage });
      setError(null);
      onOpenChange(false);
    },
    onError: (err) => setError(errorText(err, "That did not go through. Check the details and try again.")),
  });
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!m.isPending) { setError(null); onOpenChange(v); } }}>
      <DialogContent className={cn("max-h-[90vh] overflow-y-auto thin-scroll", wide ? "sm:max-w-2xl" : "sm:max-w-lg")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => { e.preventDefault(); if (!disabled) m.mutate(); }}
        >
          {children}
          {error && <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-700 dark:text-rose-400">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={m.isPending}>Cancel</Button>
            <Button type="submit" disabled={disabled || m.isPending} className="gap-1.5">
              {m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A small note in the tone of a check result. */
export function Note({ tone = "info", children, className }: { tone?: "info" | "warn" | "bad" | "ok"; children: React.ReactNode; className?: string }) {
  const tones = {
    info: "border-sky-500/30 bg-sky-500/5 text-sky-800 dark:text-sky-300",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
    bad: "border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-300",
    ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  } as const;
  return <div className={cn("rounded-xl border px-4 py-3 text-xs leading-relaxed", tones[tone], className)}>{children}</div>;
}

export const isMoney = (v: string) => /^\d{1,11}(\.\d{1,2})?$/.test(v.trim()) && Number(v) > 0;

export function EmptyRow({ cols, children }: { cols: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-10 text-center text-xs text-muted-foreground">{children}</td>
    </tr>
  );
}
