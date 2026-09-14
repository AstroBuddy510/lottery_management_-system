import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Flag, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/**
 * Red-flag a writer.
 *
 * A red flag is not a sanction - it is a watch mark. Writers who move large
 * volume put large sums at risk on single combinations, so Risk Management
 * keeps their book on screen at all times rather than only in aggregate,
 * which is what lets the desk lay those numbers off at the NLA in time.
 */

export interface RedFlagTarget {
  id: string;
  fullName: string;
  fullCode: string;
  isRedFlagged: boolean;
  reason?: string | null;
}

interface RedFlagRow {
  id: string;
  isRedFlagged: boolean;
  redFlagReason: string | null;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem("accessToken")}` };
}

/** Current watch marks, keyed by writer id. */
export function useRedFlags(agentId?: string) {
  const query = useQuery<RedFlagRow[]>({
    queryKey: ["/api/writers/red-flags", agentId ?? "all"],
    queryFn: async () => {
      const url = `/api/writers/red-flags${agentId ? `?agentId=${encodeURIComponent(agentId)}` : ""}`;
      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to load red flags");
      return res.json();
    },
  });

  const byId: Record<string, RedFlagRow> = {};
  for (const row of query.data ?? []) byId[row.id] = row;
  return byId;
}

export function useSetRedFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      writerId,
      isRedFlagged,
      reason,
    }: {
      writerId: string;
      isRedFlagged: boolean;
      reason?: string;
    }) => {
      const res = await fetch(`/api/writers/${writerId}/red-flag`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ isRedFlagged, reason: reason?.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not update the flag");
      return body;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/writers/red-flags"] });
      qc.invalidateQueries({ queryKey: ["/api/risk/exposure"] });
      qc.invalidateQueries({ queryKey: ["/api/risk/dashboard"] });
    },
  });
}

/** The flag itself, as a button in a writers list. */
export function RedFlagButton({
  flagged,
  onClick,
}: {
  flagged: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={flagged ? "Red-flagged — on the risk watch list" : "Tag as a red-flag writer"}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide transition-colors",
        flagged
          ? "border-red-300/60 bg-red-500/10 text-red-700 hover:bg-red-500/20 dark:text-red-300"
          : "border-border/60 text-muted-foreground/60 hover:border-red-300/60 hover:text-red-600",
      )}
    >
      <Flag className={cn("h-2.5 w-2.5", flagged && "fill-current")} />
      {flagged ? "Red flag" : "Flag"}
    </button>
  );
}

export function RedFlagDialog({
  writer,
  onClose,
}: {
  writer: RedFlagTarget | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const setFlag = useSetRedFlag();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (writer) setReason(writer.reason ?? "");
  }, [writer]);

  const apply = async (isRedFlagged: boolean) => {
    if (!writer) return;
    try {
      await setFlag.mutateAsync({ writerId: writer.id, isRedFlagged, reason });
      toast({
        title: isRedFlagged ? "Writer red-flagged" : "Flag removed",
        description: isRedFlagged
          ? `${writer.fullName} now shows on Risk Management for every game.`
          : `${writer.fullName} is off the watch list.`,
      });
      onClose();
    } catch (e) {
      toast({ title: "Not saved", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={!!writer} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100%-1.5rem)] max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="h-4 w-4 text-red-500" />
            {writer?.isRedFlagged ? "Red flag" : "Tag as red flag"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {writer?.fullName} · <span className="font-mono">{writer?.fullCode}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <p className="rounded-lg bg-muted/50 p-3 text-[11px] leading-relaxed text-muted-foreground">
            A red-flag writer's tickets stay on the Risk Management screen for every game, so
            large bets can be laid off at the NLA before the draw. Use it for writers whose
            sales are big enough to move our exposure on their own.
          </p>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold">Reason</label>
            <Textarea
              rows={3}
              placeholder="e.g. Consistently the highest seller at Ashaiman — single lines above GH₵ 2,000"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="text-xs"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          {writer?.isRedFlagged ? (
            <>
              <Button
                variant="outline"
                className="h-11 flex-1 rounded-xl"
                disabled={setFlag.isPending}
                onClick={() => apply(false)}
              >
                Remove flag
              </Button>
              <Button
                className="h-11 flex-1 rounded-xl font-semibold"
                disabled={setFlag.isPending}
                onClick={() => apply(true)}
              >
                {setFlag.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save reason
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" className="h-11 flex-1 rounded-xl" onClick={onClose}>
                Cancel
              </Button>
              <Button
                className="h-11 flex-1 rounded-xl bg-red-600 font-semibold hover:bg-red-700"
                disabled={setFlag.isPending}
                onClick={() => apply(true)}
              >
                {setFlag.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Red flag writer
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
