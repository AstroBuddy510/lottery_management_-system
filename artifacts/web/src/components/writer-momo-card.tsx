import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Smartphone, Pencil } from "lucide-react";
import { apiGet, apiSend } from "@/lib/api-fetch";

/**
 * Where a writer's POS wins are paid.
 *
 * Shown to everyone who can open the writer; changeable by the administrator
 * and the writer's own agent only. The cashier - who releases the money - and
 * the director - who supplies it - can read the wallet and not redirect it.
 *
 * A writer with no wallet here cannot be paid at all, which is said in amber
 * rather than left as an empty row.
 */

interface MomoInfo {
  momoNumber: string | null;
  momoProvider: string | null;
  momoAccountName: string | null;
  momoUpdatedAt: string | null;
  updatedByName: string | null;
  providers: Array<{ value: string; label: string }>;
  canEdit: boolean;
}

export function WriterMomoCard({ writerId }: { writerId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState("");
  const [provider, setProvider] = useState("");

  const { data } = useQuery<MomoInfo>({
    queryKey: ["/api/writers/momo", writerId],
    queryFn: () => apiGet(`/api/writers/${writerId}/momo`),
    enabled: !!writerId,
  });

  const save = useMutation({
    mutationFn: () =>
      apiSend<{ momoAccountName: string | null }>("PUT", `/api/writers/${writerId}/momo`, { number, provider }),
    onSuccess: (r) => {
      toast.success("Payout wallet saved", {
        description: r.momoAccountName
          ? `The network has it registered to ${r.momoAccountName}.`
          : "The network could not confirm whose wallet this is - check the number with the writer.",
      });
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["/api/writers/momo", writerId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!data) return null;
  const label = data.providers.find(p => p.value === data.momoProvider)?.label;
  const numberOk = /^(0\d{9}|233\d{9}|\+233\d{9})$/.test(number.replace(/[\s-]/g, ""));

  return (
    <Card className={data.momoNumber ? "" : "border-amber-300"}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Payout wallet (MoMo)</p>
          {data.canEdit && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs px-2"
              onClick={() => { setNumber(data.momoNumber ?? ""); setProvider(data.momoProvider ?? ""); setOpen(true); }}
            >
              <Pencil className="w-3 h-3 mr-1" /> {data.momoNumber ? "Change" : "Add"}
            </Button>
          )}
        </div>

        {data.momoNumber ? (
          <div className="flex items-start gap-2.5 text-sm">
            <Smartphone className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <span className="font-mono font-semibold">{data.momoNumber}</span>
              <span className="text-muted-foreground"> · {label ?? data.momoProvider}</span>
              <span className="block text-xs text-muted-foreground">
                {data.momoAccountName ?? "Name not confirmed by the network"}
              </span>
              {data.momoUpdatedAt && (
                <span className="block text-[11px] text-muted-foreground mt-0.5">
                  Set {new Date(data.momoUpdatedAt).toLocaleDateString("en-GB")}
                  {data.updatedByName ? ` by ${data.updatedByName}` : ""}
                </span>
              )}
            </div>
          </div>
        ) : (
          <p className="text-xs text-amber-700">
            No wallet registered. This writer's winning tickets cannot be paid until one is added.
          </p>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Payout wallet</DialogTitle>
            <DialogDescription>
              POS wins for this writer are sent here. Claims already with the cashier keep the
              wallet they were made with.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (numberOk && provider) save.mutate(); }}>
            <div className="space-y-1.5">
              <Label htmlFor="momo-number" className="text-xs">Mobile money number</Label>
              <Input
                id="momo-number"
                value={number}
                onChange={e => setNumber(e.target.value)}
                inputMode="tel"
                placeholder="0241234567"
                className="h-10 font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Network</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger className="h-10"><SelectValue placeholder="Choose the network" /></SelectTrigger>
                <SelectContent>
                  {data.providers.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={!numberOk || !provider || save.isPending}>
                {save.isPending ? "Checking…" : "Save wallet"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
