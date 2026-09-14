import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, KeyRound, AlertTriangle, Flag } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSetRedFlag } from "@/components/red-flag-dialog";
import { cn } from "@/lib/utils";

/**
 * Give an existing writer a working sign-in credential.
 *
 * Writers created before PIN issuance existed have no PIN and often no phone,
 * so they cannot sign in at all. This sets both without re-creating the record,
 * which would lose their code and history.
 *
 * The PIN is shown once and never again - only its hash is stored.
 */

export interface IssuePinTarget {
  id: string;
  fullName: string;
  fullCode: string;
  phone?: string | null;
  hasPin?: boolean;
  isRedFlagged?: boolean;
  redFlagReason?: string | null;
}

interface IssuedPin {
  fullName: string;
  fullCode: string;
  phone: string | null;
  pin: string;
  reissued: boolean;
}

export function IssuePinDialog({
  writer,
  onClose,
}: {
  writer: IssuePinTarget | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [phone, setPhone] = useState("");
  const [issued, setIssued] = useState<IssuedPin | null>(null);
  // Writers who move large volume are tagged here, at the moment the admin is
  // already looking at them, rather than in a separate pass later.
  const [redFlag, setRedFlag] = useState(false);
  const [redFlagReason, setRedFlagReason] = useState("");
  const setFlag = useSetRedFlag();

  useEffect(() => {
    if (writer) {
      setPhone(writer.phone ?? "");
      setIssued(null);
      setRedFlag(writer.isRedFlagged ?? false);
      setRedFlagReason(writer.redFlagReason ?? "");
    }
  }, [writer]);

  const issue = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/writers/${writer!.id}/issue-pin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("accessToken")}`,
        },
        body: JSON.stringify(phone.trim() ? { phone: phone.trim() } : {}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not issue a PIN");
      return body as IssuedPin;
    },
    onSuccess: async (data) => {
      setIssued(data);
      // The PIN is already issued; a failed flag must not read as a failed
      // issue, so it is reported on its own and the PIN still shows.
      const wasFlagged = writer?.isRedFlagged ?? false;
      if (redFlag !== wasFlagged || (redFlag && redFlagReason !== (writer?.redFlagReason ?? ""))) {
        try {
          await setFlag.mutateAsync({
            writerId: writer!.id,
            isRedFlagged: redFlag,
            reason: redFlagReason,
          });
        } catch (e) {
          toast({
            title: "PIN issued, flag not saved",
            description: (e as Error).message,
            variant: "destructive",
          });
        }
      }
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast({ title: "Not issued", description: e.message, variant: "destructive" }),
  });

  const close = () => {
    setIssued(null);
    onClose();
  };

  return (
    <Dialog open={!!writer} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-sm w-[calc(100%-1.5rem)] rounded-2xl">
        {issued ? (
          <>
            <DialogHeader>
              <DialogTitle>{issued.reissued ? "PIN reset" : "PIN issued"}</DialogTitle>
              <DialogDescription className="text-xs">
                Give these to {issued.fullName}. The PIN is shown only once and
                cannot be retrieved later &mdash; if it is lost, issue a new one.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-xl border bg-muted/50 p-4 text-center space-y-3">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                  Writer ID
                </div>
                <div className="font-mono font-semibold text-sm">{issued.fullCode}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                  Phone (sign in with this)
                </div>
                <div className="font-mono font-semibold text-sm">{issued.phone}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                  PIN
                </div>
                <div className="text-3xl font-mono font-bold tracking-[0.3em]">{issued.pin}</div>
              </div>
            </div>

            <DialogFooter>
              <Button className="w-full h-11 rounded-xl font-semibold" onClick={close}>
                I have recorded it
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="h-4 w-4" />
                {writer?.hasPin ? "Reset PIN" : "Issue PIN"}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {writer?.fullName} · <span className="font-mono">{writer?.fullCode}</span>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold">Phone Number</label>
                <Input
                  type="tel"
                  inputMode="tel"
                  placeholder="024XXXXXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="h-11"
                />
                <p className="text-[11px] text-muted-foreground">
                  Writers sign in with their phone number and PIN.
                </p>
              </div>

              <div
                className={cn(
                  "rounded-xl border p-3 transition-colors",
                  redFlag
                    ? "border-red-300/60 bg-red-500/[0.06] dark:border-red-500/30"
                    : "border-border/60",
                )}
              >
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={redFlag}
                    onChange={(e) => setRedFlag(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-red-600"
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-xs font-semibold">
                      <Flag className={cn("h-3 w-3 text-red-500", redFlag && "fill-current")} />
                      Red-flag writer
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                      Known for heavy sales. Their bets stay on Risk Management every game so
                      big lines can be laid off at the NLA before the draw.
                    </span>
                  </span>
                </label>

                {redFlag && (
                  <Textarea
                    rows={2}
                    placeholder="Reason — e.g. highest seller at Ashaiman, single lines above GH₵ 2,000"
                    value={redFlagReason}
                    onChange={(e) => setRedFlagReason(e.target.value)}
                    className="mt-2.5 text-xs"
                  />
                )}
              </div>

              {writer?.hasPin && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400 flex gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                  This writer already has a PIN. Issuing a new one replaces it —
                  their current PIN will stop working.
                </p>
              )}
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" className="flex-1 h-11 rounded-xl" onClick={close}>
                Cancel
              </Button>
              <Button
                className="flex-1 h-11 rounded-xl font-semibold"
                disabled={!phone.trim() || issue.isPending}
                onClick={() => issue.mutate()}
              >
                {issue.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {writer?.hasPin ? "Reset PIN" : "Issue PIN"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
