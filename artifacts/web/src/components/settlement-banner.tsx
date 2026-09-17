import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Banknote, Smartphone, Loader2, Clock, CheckCircle2 } from "lucide-react";
import { fmtGHS } from "@/lib/utils";
import { LIVE_REFETCH_MS } from "@/components/live-sales";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

/**
 * The settlement prompt a postpaid writer gets the moment betting closes.
 *
 * It states three figures, and the order matters: what they sold, what they
 * keep as commission, and what they hand over. Wins recorded on their sales
 * are shown too but sit apart from the sum - the company pays those winners
 * through the agents, so a win never reduces what is owed. A writer whose
 * draw happened to record no wins owes exactly the same as one whose draw
 * paid out thousands.
 *
 * The deadline is the calculation run, not the draw, and the prompt says so.
 */

interface Settlement {
  ledgerId: string;
  ledgerDate: string;
  grossSales: string;
  winsRecorded: string;
  commissionPct: string | null;
  commissionAmount: string;
  amountPayable: string;
  settlementStatus: string;
  paymentDeclaredAt: string | null;
  paymentDeclaredMethod: string | null;
  unsettledAtCalculation: string | null;
  gameName: string;
  eventNumber: string;
  gameStatus: string;
}

interface SettlementResponse {
  applicable: boolean;
  totalPayable: string;
  totalGrossSales: string;
  totalCommission: string;
  totalWinsRecorded: string;
  awaitingConfirmation: number;
  settlements: Settlement[];
}

function pctLabel(pct: string | null): string {
  const n = Number(pct);
  if (!Number.isFinite(n) || n <= 0) return "commission";
  // Stored as a fraction; shown the way the admin typed it.
  return `${(n * 100).toFixed(2).replace(/\.00$/, "")}% commission`;
}

export function SettlementBanner() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [paying, setPaying] = useState<Settlement | null>(null);
  const [method, setMethod] = useState<"cash" | "momo">("cash");

  const { data } = useQuery<SettlementResponse>({
    queryKey: ["/api/postpaid/my-settlement"],
    queryFn: async () => {
      const res = await fetch("/api/postpaid/my-settlement", {
        headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` },
      });
      if (!res.ok) throw new Error("Failed to load settlement");
      return res.json();
    },
    refetchInterval: LIVE_REFETCH_MS,
  });

  const pay = useMutation({
    mutationFn: async ({ ledgerId, method }: { ledgerId: string; method: "cash" | "momo" }) => {
      const res = await fetch(`/api/postpaid/pay/${ledgerId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("accessToken")}`,
        },
        body: JSON.stringify({ method }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not send your payment");
      return body as { method: string; authorization_url?: string; amount: string };
    },
    onSuccess: (body) => {
      if (body.method === "momo" && body.authorization_url) {
        // Paystack's own page handles the mobile money prompt.
        window.location.href = body.authorization_url;
        return;
      }
      setPaying(null);
      toast({
        title: "Cashier notified",
        description: `Hand over ${fmtGHS(body.amount)}. It clears once your cashier confirms receipt.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/postpaid/my-settlement"] });
    },
    onError: (e) => {
      toast({ title: "Couldn't send it", description: (e as Error).message, variant: "destructive" });
    },
  });

  if (!data?.applicable) return null;
  const payable = Number(data.totalPayable);
  if (!data.settlements?.length || payable <= 0) return null;

  const overdue = data.settlements.some((s) => s.unsettledAtCalculation);

  return (
    <>
      <div
        className={`rounded-xl border-2 p-4 shadow-sm ${
          overdue
            ? "border-destructive/60 bg-destructive/5"
            : "border-amber-400/70 bg-amber-50 dark:bg-amber-950/20"
        }`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${
              overdue ? "bg-destructive/15" : "bg-amber-400/20"
            }`}
          >
            <AlertTriangle
              className={`h-5 w-5 ${overdue ? "text-destructive" : "text-amber-600 dark:text-amber-400"}`}
            />
          </div>
          <div className="min-w-0 flex-1">
            <h3
              className={`font-bold leading-tight ${
                overdue ? "text-destructive" : "text-amber-900 dark:text-amber-200"
              }`}
            >
              {overdue ? "Settlement overdue" : "Settlement due"}
            </h3>
            <p
              className={`text-xs mt-0.5 ${
                overdue ? "text-destructive/80" : "text-amber-800/80 dark:text-amber-300/80"
              }`}
            >
              {overdue
                ? "This draw was calculated before you paid. Settle with your cashier now."
                : data.settlements.length === 1
                  ? "Betting has closed on this draw. Pay before the draw is calculated."
                  : `${data.settlements.length} closed draws are awaiting settlement. Pay before they are calculated.`}
            </p>

            <div className="text-3xl font-extrabold tabular-nums text-amber-900 dark:text-amber-100 mt-1.5">
              {fmtGHS(payable)}
            </div>

            {/* How the figure is arrived at, so nobody has to take it on trust. */}
            <dl className="mt-2.5 space-y-1 text-[11px] border-t border-amber-400/30 pt-2.5">
              <div className="flex justify-between gap-2">
                <dt className="text-amber-800/80 dark:text-amber-300/80">Your gross sales</dt>
                <dd className="tabular-nums font-medium text-amber-900 dark:text-amber-100">
                  {fmtGHS(data.totalGrossSales)}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-emerald-700 dark:text-emerald-400">
                  Less your {pctLabel(data.settlements[0]?.commissionPct ?? null)}
                </dt>
                <dd className="tabular-nums font-medium text-emerald-700 dark:text-emerald-400">
                  −{fmtGHS(data.totalCommission)}
                </dd>
              </div>
              <div className="flex justify-between gap-2 border-t border-amber-400/30 pt-1 font-bold">
                <dt className="text-amber-900 dark:text-amber-100">You pay the cashier</dt>
                <dd className="tabular-nums text-amber-900 dark:text-amber-100">{fmtGHS(payable)}</dd>
              </div>
            </dl>

            {/* Deliberately below the sum and visibly outside it. */}
            {Number(data.totalWinsRecorded) > 0 && (
              <p className="mt-2 text-[11px] rounded-md bg-amber-400/10 px-2 py-1.5 text-amber-900/90 dark:text-amber-200/90">
                Wins recorded on your sales:{" "}
                <span className="font-bold tabular-nums">{fmtGHS(data.totalWinsRecorded)}</span>
                <span className="block text-amber-800/70 dark:text-amber-300/70">
                  Paid to the winners by the company through your agent. This does not change what
                  you owe.
                </span>
              </p>
            )}

            <div className="mt-3 space-y-2">
              {data.settlements.map((s) => (
                <div
                  key={s.ledgerId}
                  className="rounded-lg border border-amber-400/40 bg-white/60 dark:bg-black/20 p-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-amber-900 dark:text-amber-200 truncate">
                        {s.gameName} · {s.eventNumber}
                      </div>
                      <div className="text-[10px] text-amber-800/70 dark:text-amber-300/70 tabular-nums">
                        sold {fmtGHS(s.grossSales)} · keep {fmtGHS(s.commissionAmount)}
                        {Number(s.winsRecorded) > 0 && ` · wins ${fmtGHS(s.winsRecorded)}`}
                      </div>
                    </div>
                    <div className="text-sm font-bold tabular-nums text-amber-900 dark:text-amber-100 shrink-0">
                      {fmtGHS(s.amountPayable)}
                    </div>
                  </div>

                  {s.paymentDeclaredAt ? (
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400">
                      <Clock className="h-3.5 w-3.5" />
                      {s.paymentDeclaredMethod === "momo"
                        ? "Mobile money sent — awaiting confirmation"
                        : "Waiting for your cashier to confirm receipt"}
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      className="mt-2 w-full h-8 text-xs"
                      onClick={() => {
                        setMethod("cash");
                        setPaying(s);
                      }}
                    >
                      Pay {fmtGHS(s.amountPayable)}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <Dialog open={!!paying} onOpenChange={(o) => !o && setPaying(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Pay {paying ? fmtGHS(paying.amountPayable) : ""}</DialogTitle>
            <DialogDescription className="text-xs">
              {paying?.gameName} · {paying?.eventNumber}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-2">
            {([
              { key: "cash", label: "Cash", hint: "Pay your cashier", icon: Banknote },
              { key: "momo", label: "Mobile Money", hint: "Pay now on your phone", icon: Smartphone },
            ] as const).map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMethod(m.key)}
                className={`rounded-lg border-2 p-3 text-left transition-colors ${
                  method === m.key
                    ? "border-primary bg-primary/5"
                    : "border-muted hover:border-muted-foreground/30"
                }`}
              >
                <m.icon className="h-4 w-4 mb-1" />
                <div className="text-sm font-semibold">{m.label}</div>
                <div className="text-[10px] text-muted-foreground">{m.hint}</div>
              </button>
            ))}
          </div>

          <p className="text-[11px] text-muted-foreground">
            {method === "cash"
              ? "Your cashier is notified straight away. Hand over the cash and they confirm receipt."
              : "You will be taken to Paystack to authorise the payment."}
          </p>

          <Button
            className="w-full"
            disabled={pay.isPending || !paying}
            onClick={() => paying && pay.mutate({ ledgerId: paying.ledgerId, method })}
          >
            {pay.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending…
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                {method === "cash" ? "Tell my cashier I'm paying" : "Continue to Paystack"}
              </>
            )}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
