import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { Loader2, Check, Coins, Banknote, Smartphone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fmtGHS } from "@/lib/utils";
import { Wallet } from "lucide-react";
import { Panel, ScrollTable, Pager, usePaged, ReportActions, StatTile, PAGE_SIZE } from "@/components/data-kit";
import { exportReportPdf, printReport, money, type TableReport } from "@/lib/table-report";

/**
 * Paid unit purchases awaiting a cashier. Paystack confirming the charge
 * marks a request paid; issuing the units is a deliberate human step so
 * there is always a record of who credited betting funds.
 */

interface PurchaseRequest {
  id: string;
  amount: string;
  status: string;
  paymentMethod: string;
  paystackReference: string | null;
  paidAt: string | null;
  creditedAt: string | null;
  createdAt: string;
  writerName: string;
  writerCode: string;
  writerPhone: string | null;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem("accessToken")}` };
}

export function UnitRequests() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: requests, isLoading } = useQuery<PurchaseRequest[]>({
    queryKey: ["/api/writer-tokens/purchase-requests", "paid"],
    queryFn: async () => {
      const res = await fetch("/api/writer-tokens/purchase-requests?status=paid", { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to load requests");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const credit = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/writer-tokens/purchase-requests/${id}/credit`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not credit");
      return res.json();
    },
    onSuccess: (r: { balance?: string }) => {
      toast({ title: "Units credited", description: r?.balance ? `New balance ${fmtGHS(r.balance)}` : undefined });
      qc.invalidateQueries({ queryKey: ["/api/writer-tokens/purchase-requests"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // The float is what funds these credits, so show it beside the queue.
  const { data: float } = useQuery<{ wallet: { balance: string; totalDisbursed: string } }>({
    queryKey: ["/api/tokens/my-float"],
    queryFn: async () => {
      const res = await fetch("/api/tokens/my-float", { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to load float");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const list = requests ?? [];
  const total = list.reduce((s, r) => s + Number(r.amount), 0);

  /**
   * Units are the cash grossed up by the writer's commission, and the float is
   * debited by the UNITS. A cashier looking at a GH₵100 request needs to know
   * it will take 142.86 off her float, or she will top up for the wrong figure.
   */
  const { data: rate } = useQuery<{ commissionPct: number; units: string }>({
    queryKey: ["/api/writer-tokens/quote", 100],
    queryFn: async () => {
      const res = await fetch("/api/writer-tokens/quote?amount=100", { headers: authHeaders() });
      if (!res.ok) throw new Error("rate unavailable");
      return res.json();
    },
    staleTime: 300_000,
  });
  const pct = rate?.commissionPct ?? 0;
  const unitsFor = (cash: string | number) =>
    pct > 0 && pct < 1 ? Number(cash) / (1 - pct) : Number(cash);
  const totalUnits = list.reduce((s, r) => s + unitsFor(r.amount), 0);
  const floatBalance = Number(float?.wallet?.balance ?? 0);
  const short = floatBalance < total;

  const paged = usePaged(list, PAGE_SIZE);

  const confirmAndCredit = (r: PurchaseRequest) => {
    if (
      r.paymentMethod === "cash" &&
      !confirm(
        pct > 0
          ? `Have you received ${fmtGHS(r.amount)} in cash from ${r.writerName}?\n\nThis credits ${fmtGHS(unitsFor(r.amount))} of units — the payment plus ${(pct * 100).toFixed(0)}% commission — and that full amount leaves your float. It cannot be undone.`
          : `Have you received ${fmtGHS(r.amount)} in cash from ${r.writerName}?\n\nCrediting issues the units from your float and cannot be undone.`,
      )
    ) {
      return;
    }
    credit.mutate(r.id);
  };

  const when = (r: PurchaseRequest) => format(new Date(r.paidAt ?? r.createdAt), "d MMM · h:mm a");

  const report = (): TableReport => ({
    title: "Unit Requests",
    fileName: `unit_requests_${format(new Date(), "yyyy-MM-dd")}`,
    summary: [
      `${list.length} request(s) awaiting credit · ${money(total)} paid by writers`,
      pct > 0 ? `${money(totalUnits)} of units to issue · float ${money(floatBalance)}` : `Float ${money(floatBalance)}`,
    ],
    sections: [{
      columns: [
        { header: "Writer" }, { header: "Paid / requested" }, { header: "Method" }, { header: "Reference" },
        { header: "Amount", align: "right" }, { header: "Units issued", align: "right" },
      ],
      rows: list.map((r) => [
        `${r.writerName}\n${r.writerCode}${r.writerPhone ? ` · ${r.writerPhone}` : ""}`,
        `${when(r)}${r.paidAt ? "" : " (requested)"}`,
        r.paymentMethod === "cash" ? "Cash" : "Mobile Money",
        r.paystackReference ?? "—",
        money(r.amount),
        money(unitsFor(r.amount)),
      ]),
      totals: ["TOTAL", "", "", "", money(total), money(totalUnits)],
      empty: "No requests awaiting credit.",
    }],
  });

  const creditButton = (r: PurchaseRequest, wide = false) => (
    <Button size="sm" className={`h-8 rounded-lg text-xs font-bold ${wide ? "w-full" : ""}`} disabled={credit.isPending} onClick={() => confirmAndCredit(r)}>
      {credit.isPending && credit.variables === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
      <span className="ml-1.5">{r.paymentMethod === "cash" ? "Cash received · Credit" : "Credit units"}</span>
    </Button>
  );

  const methodChip = (r: PurchaseRequest) =>
    r.paymentMethod === "cash" ? (
      <Badge className="border border-amber-300/60 bg-amber-500/15 text-[10px] font-bold text-amber-700 dark:text-amber-300">
        <Banknote className="mr-1 h-3 w-3" /> CASH
      </Badge>
    ) : (
      <Badge className="border border-emerald-300/60 bg-emerald-500/15 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
        <Smartphone className="mr-1 h-3 w-3" /> MoMo
      </Badge>
    );

  return (
    <div className="space-y-6">
      {/* Figures first: what is queued, and whether the float can cover it. */}
      <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 xl:grid-cols-4">
        <StatTile label="My float" value={fmtGHS(floatBalance)} sub={short && list.length > 0 ? "Not enough for the queue" : "Units available to issue"} icon={Wallet} tone={short && list.length > 0 ? "bad" : "default"} />
        <StatTile label="Requests waiting" value={String(list.length)} sub={`${list.filter((r) => r.paymentMethod === "cash").length} cash · ${list.filter((r) => r.paymentMethod !== "cash").length} mobile money`} icon={Coins} />
        <StatTile label="Paid by writers" value={fmtGHS(total)} sub="Cash and MoMo awaiting credit" icon={Banknote} tone="in" />
        <StatTile label="Float needed" value={fmtGHS(totalUnits)} sub={pct > 0 ? `Includes ${(pct * 100).toFixed(0)}% commission` : "Units to issue"} icon={Wallet} tone="out" />
      </div>

      <Panel
        title="Unit Requests"
        icon={Coins}
        subtitle="Writers buying e-token units. Mobile money arrives already paid; a cash request waits for the writer to hand you the money. Crediting issues the units from your float."
        actions={<ReportActions label="unit requests" disabled={list.length === 0} onPdf={() => exportReportPdf(report())} onPrint={() => printReport(report())} />}
        footer={<Pager page={paged.page} totalPages={paged.totalPages} onPage={paged.setPage} total={paged.total} size={paged.size} noun="requests" />}
      >
        {short && list.length > 0 && (
          <p className="border-b border-amber-300/60 bg-amber-50 px-5 py-2.5 text-xs text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
            Your float does not cover everything queued. Ask an administrator to recharge you — units are disbursed from your float, not created here.
          </p>
        )}

        {isLoading ? (
          <div className="py-12 text-center"><Loader2 className="inline h-4 w-4 animate-spin" /></div>
        ) : list.length === 0 ? (
          <div className="py-14 text-center text-muted-foreground">
            <Check className="mx-auto h-8 w-8 opacity-30" />
            <p className="mt-2 text-sm font-semibold">No requests awaiting credit</p>
          </div>
        ) : (
          <>
            {/* Wide screens: a table that scrolls both ways */}
            <div className="hidden md:block">
              <ScrollTable minWidth="52rem">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-5">Writer</TableHead>
                      <TableHead>Paid</TableHead>
                      <TableHead>Method · Reference</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="pr-5 text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paged.rows.map((r) => (
                      <TableRow key={r.id} className="hover:bg-muted/30">
                        <TableCell className="py-3 pl-5">
                          <span className="block text-sm font-semibold">{r.writerName}</span>
                          <span className="block font-mono text-[11px] text-muted-foreground">{r.writerCode}{r.writerPhone ? ` · ${r.writerPhone}` : ""}</span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap py-3 text-xs">
                          {when(r)}
                          {!r.paidAt && <span className="block text-[10px] text-muted-foreground">requested</span>}
                        </TableCell>
                        <TableCell className="py-3">
                          {methodChip(r)}
                          <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                            {r.paymentMethod === "cash" ? `Collect ${fmtGHS(r.amount)} first` : r.paystackReference ?? "—"}
                          </span>
                        </TableCell>
                        <TableCell className="py-3 text-right tabular-nums">
                          <div className="font-bold">{fmtGHS(r.amount)}</div>
                          {pct > 0 && <div className="text-[10px] font-semibold text-blue-600 dark:text-blue-400">issues {fmtGHS(unitsFor(r.amount))}</div>}
                        </TableCell>
                        <TableCell className="py-3 pr-5 text-right">{creditButton(r)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollTable>
            </div>

            {/* Phones: one card per request */}
            <div className="grid gap-3 p-4 md:hidden">
              {paged.rows.map((r) => (
                <article key={r.id} className="rounded-2xl border border-border/80 bg-background/60 p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold">{r.writerName}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{r.writerCode}</div>
                    </div>
                    {methodChip(r)}
                  </div>
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div>
                      <div className="text-xl font-black tabular-nums">{fmtGHS(r.amount)}</div>
                      {pct > 0 && <div className="text-[10px] font-semibold text-blue-600 dark:text-blue-400">issues {fmtGHS(unitsFor(r.amount))}</div>}
                    </div>
                    <div className="text-right text-[11px] text-muted-foreground">{when(r)}</div>
                  </div>
                  <div className="mt-3">{creditButton(r, true)}</div>
                </article>
              ))}
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
