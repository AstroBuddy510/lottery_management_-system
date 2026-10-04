import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth";
import { Banknote, ChevronRight, Info, Loader2, Plus, Smartphone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fmtGHS } from "@/lib/utils";

type Mode = "prepaid" | "postpaid";

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem("accessToken")}` };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Request failed");
  return res.json();
}

/**
 * Buy e-token units, by mobile money or by paying the cashier in cash.
 *
 * The two differ only in how the money arrives. Mobile money goes through
 * Paystack and is confirmed by its webhook; cash is handed over in person and
 * the cashier confirming receipt IS the confirmation. Either way a cashier
 * issues the units from their float, so the audit trail is the same.
 */
/**
 * What a payment buys, asked of the server as the writer types.
 *
 * The uplift is the writer's own commission, built into the units rather than
 * paid back later, so the figure must be visible before they commit - finding
 * out afterwards that 100 became 142.86 is a pleasant surprise once and a
 * support call every time the rate changes.
 */
function useUnitQuote(amount: string) {
  const value = Number(amount);
  return useQuery<{ paid: string; commissionPct: number; units: string; commissionValue: string }>({
    queryKey: ["/api/writer-tokens/quote", value],
    queryFn: async () => {
      const res = await fetch(`/api/writer-tokens/quote?amount=${value}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` },
      });
      if (!res.ok) throw new Error("quote failed");
      return res.json();
    },
    enabled: Number.isFinite(value) && value > 0,
    staleTime: 60_000,
  });
}

function BuyUnitDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const quote = useUnitQuote(amount);
  const [method, setMethod] = useState<"momo" | "cash">("momo");

  const buy = useMutation({
    mutationFn: async () => {
      const path =
        method === "cash"
          ? "/api/writer-tokens/purchase/request-cash"
          : "/api/writer-tokens/purchase/initialize";
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ amount: Number(amount) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not start payment");
      return res.json() as Promise<{ authorization_url?: string; message?: string }>;
    },
    onSuccess: (d) => {
      if (method === "cash") {
        toast({
          title: "Request sent to your cashier",
          description: d.message ?? `Pay GHS ${Number(amount).toFixed(2)} to your cashier to get your units.`,
        });
        qc.invalidateQueries();
        setAmount("");
        onClose();
        return;
      }
      // Paystack's own hosted page handles the mobile money prompt; we never
      // see or hold the writer's payment details.
      if (d.authorization_url) window.location.href = d.authorization_url;
    },
    onError: (e: Error) => toast({ title: "Request failed", description: e.message, variant: "destructive" }),
  });

  const valid = Number(amount) > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm w-[calc(100%-1.5rem)] rounded-2xl">
        <DialogHeader>
          <DialogTitle>Buy Units</DialogTitle>
          <DialogDescription className="text-xs">
            Units are issued by a cashier once your payment is confirmed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold">How are you paying?</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { key: "momo", label: "Mobile Money", hint: "Pay now on your phone" },
                { key: "cash", label: "Cash", hint: "Pay your cashier" },
              ] as const).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMethod(m.key)}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    method === m.key
                      ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                      : "border-border hover:bg-muted/50"
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-xs font-bold">
                    {m.key === "cash" ? <Banknote className="h-3.5 w-3.5" /> : <Smartphone className="h-3.5 w-3.5" />}
                    {m.label}
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                    {m.hint}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold">Amount (GHS)</label>
            <Input
              type="number"
              inputMode="decimal"
              min="1"
              step="1"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="h-12 text-lg font-bold tabular-nums"
            />
          </div>

          {/* What this payment actually credits. */}
          {quote.data && Number(quote.data.commissionValue) > 0 && (
            <div className="rounded-xl border border-emerald-300/60 bg-emerald-50 p-3 dark:border-emerald-500/40 dark:bg-emerald-950/30">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-semibold text-emerald-900 dark:text-emerald-100">
                  You will receive
                </span>
                <span className="font-mono text-xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                  {fmtGHS(quote.data.units)}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-emerald-800/90 dark:text-emerald-200/80">
                {fmtGHS(quote.data.paid)} paid plus {fmtGHS(quote.data.commissionValue)} of your{" "}
                {(quote.data.commissionPct * 100).toFixed(0)}% commission, included up front.
              </p>
            </div>
          )}

          <div className="grid grid-cols-4 gap-2">
            {[20, 50, 100, 200].map((v) => (
              <Button key={v} type="button" variant="outline" className="h-10 text-xs" onClick={() => setAmount(String(v))}>
                {v}
              </Button>
            ))}
          </div>

          <p className="text-[11px] text-muted-foreground flex gap-1.5">
            <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
            {method === "cash"
              ? "Your cashier sees this request straight away. Hand them the cash and they will add your units."
              : "You will be taken to Paystack to authorise the payment."}
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" className="flex-1 h-11 rounded-xl" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1 h-11 rounded-xl font-semibold"
            disabled={!valid || buy.isPending}
            onClick={() => buy.mutate()}
          >
            {buy.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {method === "cash" ? "Send request" : "Continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


/**
 * Recent Transactions, grouped by the day they happened.
 *
 * A writer's list grows by a dozen rows a day and is read on a phone, so a flat
 * list becomes unusable within a week. Grouping by day gives the history a
 * shape that matches how a writer thinks about it - "what did I do today",
 * "what came in yesterday" - and collapsing the older days keeps the screen
 * about the present.
 *
 * Days are Accra days, matching the rest of the system, so a sale at 23:30
 * belongs to the day the writer would name rather than whatever the handset's
 * timezone makes of it.
 */
const WALLET_TZ = "Africa/Accra";

function accraDayKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: WALLET_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function dayLabel(key: string): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: WALLET_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  if (key === today) return "Today";

  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (key === yesterday.toISOString().slice(0, 10)) return "Yesterday";

  // Noon avoids the parsed date sliding to the previous day in any timezone.
  const d = new Date(`${key}T12:00:00Z`);
  const thisYear = new Date().getUTCFullYear();
  return format(d, d.getUTCFullYear() === thisYear ? "EEEE, d MMM" : "d MMM yyyy");
}

interface DayGroup {
  key: string;
  label: string;
  rows: any[];
  net: number;
}

function groupByDay(transactions: any[]): DayGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, any[]>();
  // The API already returns newest first; preserving that order means the
  // groups come out newest first too, without a second sort.
  for (const tx of transactions) {
    const key = accraDayKey(tx.createdAt);
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key);
    }
    byKey.get(key)!.push(tx);
  }
  return order.map((key) => {
    const rows = byKey.get(key)!;
    return {
      key,
      label: dayLabel(key),
      rows,
      net: rows.reduce((sum, r) => sum + Number(r.amount ?? 0), 0),
    };
  });
}

function TransactionRow({ tx }: { tx: any }) {
  const positive = Number(tx.amount) > 0;
  return (
    <li className="py-2.5 flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="capitalize text-[10px] px-1.5 py-0 h-5">
            {tx.transactionType.replace(/_/g, " ")}
          </Badge>
          {/* Only the time: the day is the heading this row sits under. */}
          <span className="text-[10px] text-muted-foreground/70 tabular-nums">
            {format(new Date(tx.createdAt), "h:mm a")}
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5 break-words">{tx.description}</div>
      </div>
      <div className="text-right shrink-0">
        <div
          className={`text-sm font-bold tabular-nums ${positive ? "text-emerald-600" : "text-destructive"}`}
        >
          {positive ? "+" : ""}
          {fmtGHS(tx.amount)}
        </div>
        <div className="text-[10px] text-muted-foreground tabular-nums">
          bal {fmtGHS(tx.balanceAfter)}
        </div>
      </div>
    </li>
  );
}

function DaySection({ group, open, onToggle }: { group: DayGroup; open: boolean; onToggle: () => void }) {
  const panelId = `wallet-day-${group.key}`;
  return (
    <div className="border-b border-border/60 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-2.5 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        />
        <span className="text-sm font-semibold">{group.label}</span>
        <span className="text-[11px] text-muted-foreground">
          {group.rows.length} {group.rows.length === 1 ? "entry" : "entries"}
        </span>
        <span
          className={`ml-auto text-xs font-bold tabular-nums ${
            group.net > 0 ? "text-emerald-600" : group.net < 0 ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {group.net > 0 ? "+" : ""}
          {fmtGHS(group.net)}
        </span>
      </button>

      {open && (
        <ul id={panelId} className="divide-y divide-border/40 pb-1 pl-6">
          {group.rows.map((tx: any) => (
            <TransactionRow key={tx.id} tx={tx} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TransactionAccordion({ transactions }: { transactions: any[] }) {
  const groups = useMemo(() => groupByDay(transactions), [transactions]);

  /**
   * Only the newest day opens. Tracking the OPEN set rather than the closed one
   * means a day that arrives later - a sale made while the page is open - does
   * not spring open on its own and push the rest down under the writer's thumb.
   */
  const [openKeys, setOpenKeys] = useState<Set<string>>(() =>
    groups.length > 0 ? new Set([groups[0]!.key]) : new Set(),
  );

  // A writer who leaves the page open overnight should still find today open.
  const firstKey = groups[0]?.key;
  const seeded = useRef<string | undefined>(firstKey);
  useEffect(() => {
    if (firstKey && seeded.current === undefined) {
      seeded.current = firstKey;
      setOpenKeys(new Set([firstKey]));
    }
  }, [firstKey]);

  const toggle = (key: string) =>
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div>
      {groups.map((g) => (
        <DaySection key={g.key} group={g} open={openKeys.has(g.key)} onToggle={() => toggle(g.key)} />
      ))}
    </div>
  );
}

export function WriterWallet() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const accountMode = (user?.operationModel as Mode) ?? "postpaid";
  const [view, setView] = useState<Mode>(accountMode);
  const [buyOpen, setBuyOpen] = useState(false);

  const { data: balanceData } = useQuery<{ balance: string; totalPurchased: string; totalSpent: string }>({
    queryKey: ["/api/writer-tokens/balance"],
    queryFn: () => getJson("/api/writer-tokens/balance"),
    enabled: view === "prepaid",
  });

  const { data: transactions, isLoading: loadingTransactions } = useQuery<any[]>({
    queryKey: ["/api/writer-tokens/transactions"],
    queryFn: () => getJson("/api/writer-tokens/transactions"),
    enabled: view === "prepaid",
  });

  const { data: ledgers, isLoading: loadingLedgers } = useQuery<any[]>({
    queryKey: ["/api/postpaid/ledger"],
    queryFn: () => getJson("/api/postpaid/ledger"),
    enabled: view === "postpaid",
  });

  /**
   * Switching to prepaid is immediate. Postpaid is a request: it means selling
   * on credit, so an agent - or an administrator, if the agent is unreachable -
   * decides it. The request is recorded and reaches them.
   */
  const switchMode = useMutation({
    mutationFn: async (mode: Mode) => {
      const res = await fetch("/api/writer-auth/operation-model", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ operationModel: mode }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not switch mode");
      return body as { requiresApproval?: boolean; message?: string };
    },
    onSuccess: (body) => {
      if (body.requiresApproval) {
        toast({
          title: "Request sent",
          description: body.message ?? "Your agent or an administrator will decide it.",
        });
        // The switch has not happened, so put the view back where it was.
        setView(accountMode);
      } else {
        toast({ title: "Account mode updated" });
      }
      qc.invalidateQueries();
    },
    onError: (e: Error) => {
      toast({ title: "Not switched", description: e.message, variant: "destructive" });
      setView(accountMode);
    },
  });

  // Where a request already stands, so the writer is not left guessing.
  const { data: modelRequests } = useQuery<
    Array<{ id: string; status: string; requestedModel: string; createdAt: string }>
  >({
    queryKey: ["/api/writer-auth/model-requests"],
    queryFn: () => getJson("/api/writer-auth/model-requests"),
  });
  const pendingRequest = (modelRequests ?? []).find((r) => r.status === "pending");

  const selectView = (mode: Mode) => {
    setView(mode);
    if (mode !== accountMode) switchMode.mutate(mode);
  };

  return (
    <div className="space-y-5">
      {pendingRequest && (
        <div className="rounded-xl border border-amber-300/60 bg-amber-500/[0.07] px-4 py-3 text-xs dark:border-amber-500/30">
          <span className="font-semibold">
            Your request to switch to {pendingRequest.requestedModel} is waiting for a decision.
          </span>
          <span className="mt-0.5 block text-muted-foreground">
            Sent {format(new Date(pendingRequest.createdAt), "d MMM 'at' HH:mm")}. Your agent or an
            administrator will decide it.
          </span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold tracking-tight">Wallet &amp; Ledger</h1>
        {view === "prepaid" && (
          <Button size="sm" className="h-9 rounded-xl font-semibold" onClick={() => setBuyOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Buy Unit
          </Button>
        )}
      </div>

      {/* Account mode */}
      <div className="inline-flex rounded-xl border bg-muted/40 p-1 w-full sm:w-auto">
        {(["postpaid", "prepaid"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => selectView(m)}
            disabled={switchMode.isPending}
            className={`flex-1 sm:flex-none px-4 h-9 rounded-lg text-xs font-bold capitalize transition-colors ${
              view === m ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {m}
            {accountMode === m && <span className="ml-1.5 text-[9px] text-emerald-600">●</span>}
          </button>
        ))}
      </div>
      {view !== accountMode && (
        <p className="text-[11px] text-muted-foreground -mt-2">
          Viewing {view}. Your account is set to <strong className="capitalize">{accountMode}</strong>.
        </p>
      )}

      {view === "prepaid" ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Card className="bg-primary/5 border-primary/20 col-span-2 sm:col-span-1">
              <CardHeader className="pb-1.5 px-4 pt-3">
                <CardTitle className="text-[11px] font-semibold text-primary uppercase tracking-wide">
                  Available Balance
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <div className="text-2xl font-bold tabular-nums">{fmtGHS(balanceData?.balance ?? 0)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1.5 px-4 pt-3">
                <CardTitle className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Total Purchased
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <div className="text-base font-bold tabular-nums">{fmtGHS(balanceData?.totalPurchased ?? 0)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1.5 px-4 pt-3">
                <CardTitle className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Total Spent
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <div className="text-base font-bold tabular-nums">{fmtGHS(balanceData?.totalSpent ?? 0)}</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Recent Transactions</CardTitle>
            </CardHeader>
            <CardContent className="px-3 sm:px-6">
              {loadingTransactions ? (
                <div className="py-8 text-center"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
              ) : !transactions?.length ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No transactions yet.</p>
              ) : (
                <TransactionAccordion transactions={transactions} />
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Daily Postpaid Ledger</CardTitle>
            <CardDescription className="text-xs">
              Stakes you took, wins you paid, and what is left to settle.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-3 sm:px-6">
            {loadingLedgers ? (
              <div className="py-8 text-center"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
            ) : !ledgers?.length ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No ledger entries yet.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {ledgers.map((l: any) => (
                  <li key={l.id} className="py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold">
                        {format(new Date(l.ledgerDate), "d MMM yyyy")}
                      </span>
                      <Badge
                        variant="outline"
                        className={`text-[10px] font-bold px-1.5 py-0 h-5 ${
                          l.settlementStatus === "settled"
                            ? "bg-emerald-500/10 text-emerald-700 border-emerald-300"
                            : "bg-amber-500/10 text-amber-700 border-amber-300"
                        }`}
                      >
                        {String(l.settlementStatus).toUpperCase()}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Stakes</div>
                        <div className="text-xs font-bold tabular-nums">{fmtGHS(l.totalStakes)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Winnings</div>
                        <div className="text-xs font-bold tabular-nums">{fmtGHS(l.totalWinnings)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Net</div>
                        <div className="text-xs font-bold tabular-nums text-primary">{fmtGHS(l.netBalance)}</div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <BuyUnitDialog open={buyOpen} onClose={() => setBuyOpen(false)} />
    </div>
  );
}
