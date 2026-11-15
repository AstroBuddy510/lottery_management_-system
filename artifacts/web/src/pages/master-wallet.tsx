import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Landmark, Lock, Plus, Minus, FileDown, AlertTriangle, ShieldCheck, Eye } from "lucide-react";
import { apiGet, apiSend } from "@/lib/api-fetch";
import { fmtGHS } from "@/lib/utils";
import { generateMasterWalletLedgerPDF } from "@/lib/pdf-generator";

/**
 * The Master Wallet: the money set aside to pay POS wins.
 *
 * Two people open this page and they are not shown the same thing. The
 * Director can add money. The Administrator - who runs the draws that decide
 * what is owed - can see every figure and change none of them; the page says
 * so at the top rather than leaving them to find a missing button.
 */

interface WalletSummary {
  available: string;
  held: string;
  total: string;
  totalFunded: string;
  totalDisbursed: string;
  totalWithdrawn: string;
  awaitingFunds: { count: number; total: string };
  paystackBalance: string | null;
  paystackConfigured: boolean;
  ledgerBalanced: boolean;
  canFund: boolean;
}

interface LedgerEntry {
  id: string;
  entryType: "fund" | "withdraw" | "hold" | "release" | "disburse";
  amount: string;
  availableAfter: string;
  heldAfter: string;
  reference: string | null;
  note: string | null;
  actorName: string | null;
  actorRole: string | null;
  createdAt: string;
  ticketNumber: string | null;
  writerCode: string | null;
}

const ENTRY: Record<LedgerEntry["entryType"], { label: string; tone: string; sign: string }> = {
  fund: { label: "Funded", tone: "bg-emerald-500/10 text-emerald-700 border-emerald-200", sign: "+" },
  withdraw: { label: "Withdrawn", tone: "bg-rose-500/10 text-rose-700 border-rose-200", sign: "−" },
  hold: { label: "Held for claim", tone: "bg-blue-500/10 text-blue-700 border-blue-200", sign: "" },
  release: { label: "Released", tone: "bg-slate-500/10 text-slate-600 border-slate-300", sign: "" },
  disburse: { label: "Disbursed", tone: "bg-amber-500/10 text-amber-700 border-amber-200", sign: "−" },
};

function Figure({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`text-xl font-black mt-1 tabular-nums ${tone ?? ""}`}>{value}</p>
        {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function MasterWallet() {
  const qc = useQueryClient();
  const [type, setType] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [fundOpen, setFundOpen] = useState(false);
  const [form, setForm] = useState({ amount: "", reference: "", note: "" });
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [out, setOut] = useState({ amount: "", reason: "" });

  const summary = useQuery<WalletSummary>({
    queryKey: ["/api/master-wallet"],
    queryFn: () => apiGet("/api/master-wallet"),
    refetchInterval: 30_000,
  });

  const ledger = useQuery<{ entries: LedgerEntry[] }>({
    queryKey: ["/api/master-wallet/ledger", type, dateFrom, dateTo],
    queryFn: () => {
      const p = new URLSearchParams();
      if (type !== "all") p.set("type", type);
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo) p.set("dateTo", dateTo);
      return apiGet(`/api/master-wallet/ledger?${p}`);
    },
  });

  const fund = useMutation({
    mutationFn: () =>
      apiSend<{ available: string; claimsReleased: number }>("POST", "/api/master-wallet/fund", {
        amount: form.amount.trim(),
        reference: form.reference.trim(),
        note: form.note.trim() || undefined,
      }),
    onSuccess: (r) => {
      toast.success(`Master Wallet funded. Available: ${fmtGHS(r.available)}`, {
        description: r.claimsReleased
          ? `${r.claimsReleased} waiting claim${r.claimsReleased === 1 ? " was" : "s were"} released to the cashier.`
          : undefined,
      });
      setFundOpen(false);
      setForm({ amount: "", reference: "", note: "" });
      qc.invalidateQueries({ queryKey: ["/api/master-wallet"] });
      qc.invalidateQueries({ queryKey: ["/api/master-wallet/ledger"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const withdraw = useMutation({
    mutationFn: () =>
      apiSend<{ available: string }>("POST", "/api/master-wallet/withdraw", {
        amount: out.amount.trim(),
        reason: out.reason.trim(),
      }),
    onSuccess: (r) => {
      toast.success(`Withdrawn. Available: ${fmtGHS(r.available)}`);
      setWithdrawOpen(false);
      setOut({ amount: "", reason: "" });
      qc.invalidateQueries({ queryKey: ["/api/master-wallet"] });
      qc.invalidateQueries({ queryKey: ["/api/master-wallet/ledger"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const s = summary.data;
  const entries = ledger.data?.entries ?? [];
  const outOk = /^\d{1,11}(\.\d{1,2})?$/.test(out.amount.trim()) && Number(out.amount) > 0;
  const amountOk = /^\d{1,11}(\.\d{1,2})?$/.test(form.amount.trim()) && Number(form.amount) > 0;

  // The cash at Paystack should cover everything this wallet has promised.
  const drift =
    s?.paystackBalance != null ? Number(s.paystackBalance) - Number(s.total) : null;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
            <Landmark className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Master Wallet</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              The money set aside to pay POS wins. Funded by the Director only.
            </p>
          </div>
        </div>
        {s?.canFund ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setWithdrawOpen(true)}>
              <Minus className="w-4 h-4 mr-1.5" /> Withdraw
            </Button>
            <Button onClick={() => setFundOpen(true)}>
              <Plus className="w-4 h-4 mr-1.5" /> Fund wallet
            </Button>
          </div>
        ) : (
          <Badge variant="outline" className="px-3 py-1.5 text-xs font-semibold gap-1.5">
            <Eye className="w-3.5 h-3.5" /> Read-only
          </Badge>
        )}
      </div>

      {s && !s.canFund && (
        <div className="rounded-xl border bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground flex items-center gap-2">
          <Lock className="w-4 h-4 shrink-0" />
          You can see every figure here and change none of them. The wallet is funded by the
          Director, so that the role which runs the draws is not also the one supplying the money
          that pays them.
        </div>
      )}

      {s && s.awaitingFunds.count > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-2.5 text-sm text-amber-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            <strong>{s.awaitingFunds.count}</strong> verified claim{s.awaitingFunds.count === 1 ? "" : "s"} worth{" "}
            <strong>{fmtGHS(s.awaitingFunds.total)}</strong> {s.awaitingFunds.count === 1 ? "is" : "are"} waiting
            because the wallet cannot cover {s.awaitingFunds.count === 1 ? "it" : "them"}. Writers are not paid
            until it is funded.
          </span>
        </div>
      )}

      {s && !s.ledgerBalanced && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          The ledger and the wallet balance do not agree. Do not fund or reconcile until this is investigated.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Figure label="Available" value={s ? fmtGHS(s.available) : "—"} hint="Can still be promised to claims" tone="text-emerald-600" />
        <Figure label="Held for claims" value={s ? fmtGHS(s.held) : "—"} hint="With the cashier or with Paystack" tone="text-blue-600" />
        <Figure
          label="Funded to date"
          value={s ? fmtGHS(s.totalFunded) : "—"}
          hint={s && Number(s.totalWithdrawn) > 0 ? `${fmtGHS(s.totalWithdrawn)} withdrawn since` : undefined}
        />
        <Figure label="Disbursed to date" value={s ? fmtGHS(s.totalDisbursed) : "—"} hint="Confirmed by Paystack" />
      </div>

      {/* The wallet is a record of what has been committed. The cash is at
          Paystack. Shown side by side so a gap is seen the day it opens. */}
      <Card>
        <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <ShieldCheck className={`w-5 h-5 ${drift != null && drift < 0 ? "text-red-600" : "text-emerald-600"}`} />
            <div>
              <p className="text-sm font-semibold">Paystack balance</p>
              <p className="text-xs text-muted-foreground">
                {!s?.paystackConfigured
                  ? "Paystack is not configured on this server, so no payout can be sent."
                  : s.paystackBalance == null
                    ? "Could not read the balance from Paystack just now."
                    : drift != null && drift < 0
                      ? `Paystack holds ${fmtGHS(Math.abs(drift))} LESS than this wallet has promised. Transfers will start failing - top up the Paystack balance.`
                      : "Covers everything this wallet has available and held."}
              </p>
            </div>
          </div>
          <p className="text-lg font-black tabular-nums">
            {s?.paystackBalance != null ? fmtGHS(s.paystackBalance) : "—"}
          </p>
        </CardContent>
      </Card>

      {/* Ledger */}
      <div className="space-y-3">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-bold">Ledger</h2>
            <p className="text-xs text-muted-foreground">
              Every movement, newest first. Entries cannot be edited or removed.
            </p>
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            <div className="space-y-1">
              <Label className="text-[11px]">Movement</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="h-9 w-[150px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All movements</SelectItem>
                  <SelectItem value="fund">Funded</SelectItem>
                  <SelectItem value="withdraw">Withdrawn</SelectItem>
                  <SelectItem value="hold">Held for claim</SelectItem>
                  <SelectItem value="release">Released</SelectItem>
                  <SelectItem value="disburse">Disbursed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">From</Label>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 w-[150px] text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">To</Label>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-9 w-[150px] text-xs" />
            </div>
            <Button
              className="h-9 bg-[#ff6700] hover:bg-[#ff6700]/90 text-white font-semibold"
              disabled={!s || entries.length === 0}
              onClick={() => s && generateMasterWalletLedgerPDF(dateFrom, dateTo, s, entries)}
            >
              <FileDown className="w-4 h-4 mr-1.5" /> Export PDF
            </Button>
          </div>
        </div>

        <div className="border rounded-xl overflow-hidden bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="text-xs">When</TableHead>
                <TableHead className="text-xs">Movement</TableHead>
                <TableHead className="text-xs text-right">Amount</TableHead>
                <TableHead className="text-xs text-right">Available after</TableHead>
                <TableHead className="text-xs text-right">Held after</TableHead>
                <TableHead className="text-xs">By</TableHead>
                <TableHead className="text-xs">Ticket / reference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledger.isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-10">Loading…</TableCell></TableRow>
              ) : entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-10">
                    No movements {type !== "all" || dateFrom || dateTo ? "match these filters" : "yet. The wallet has never been funded"}.
                  </TableCell>
                </TableRow>
              ) : entries.map(e => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs whitespace-nowrap">
                    {new Date(e.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`${ENTRY[e.entryType].tone} text-[10px] font-bold`}>
                      {ENTRY[e.entryType].label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs font-semibold tabular-nums">
                    {ENTRY[e.entryType].sign}{fmtGHS(e.amount)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">{fmtGHS(e.availableAfter)}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">{fmtGHS(e.heldAfter)}</TableCell>
                  <TableCell className="text-xs">
                    {e.actorName ?? (e.actorRole === "writer" ? "Writer claim" : "System")}
                    {e.actorName && e.actorRole && (
                      <span className="block text-[10px] text-muted-foreground capitalize">{e.actorRole}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    <span className="font-mono">{e.ticketNumber ?? e.reference ?? "—"}</span>
                    {e.ticketNumber && e.writerCode && (
                      <span className="block text-[10px] text-muted-foreground font-mono">{e.writerCode}</span>
                    )}
                    {e.note && <span className="block text-[10px] text-muted-foreground">{e.note}</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Fund dialog */}
      <Dialog open={fundOpen} onOpenChange={setFundOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Fund the Master Wallet</DialogTitle>
            <DialogDescription>
              Record money you have added to the Paystack balance for paying wins. This entry is
              permanent - it cannot be edited or removed afterwards.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={e => { e.preventDefault(); if (amountOk && form.reference.trim().length >= 3) fund.mutate(); }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="fund-amount" className="text-xs">Amount (GHS)</Label>
              <Input
                id="fund-amount"
                inputMode="decimal"
                value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                placeholder="0.00"
                className="h-10 font-mono"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fund-reference" className="text-xs">Bank or transfer reference</Label>
              <Input
                id="fund-reference"
                value={form.reference}
                onChange={e => setForm(f => ({ ...f, reference: e.target.value }))}
                placeholder="The reference of the deposit into Paystack"
                className="h-10"
                maxLength={120}
              />
              <p className="text-[11px] text-muted-foreground">
                Required, so each top-up here can be matched to a deposit on the bank statement.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fund-note" className="text-xs">Note (optional)</Label>
              <Input
                id="fund-note"
                value={form.note}
                onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                className="h-10"
                maxLength={300}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFundOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={!amountOk || form.reference.trim().length < 3 || fund.isPending}>
                {fund.isPending ? "Recording…" : amountOk ? `Fund ${fmtGHS(form.amount)}` : "Fund wallet"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Withdraw dialog */}
      <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Withdraw from the Master Wallet</DialogTitle>
            <DialogDescription>
              Takes money that has not been promised to any claim back out - or corrects a top-up
              entered wrongly. Money held for claims cannot be withdrawn. The entry is permanent.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (outOk && out.reason.trim().length >= 5) withdraw.mutate(); }}>
            <div className="space-y-1.5">
              <Label htmlFor="withdraw-amount" className="text-xs">Amount (GHS)</Label>
              <Input
                id="withdraw-amount"
                inputMode="decimal"
                value={out.amount}
                onChange={e => setOut(f => ({ ...f, amount: e.target.value }))}
                placeholder="0.00"
                className="h-10 font-mono"
              />
              <p className="text-[11px] text-muted-foreground">Up to {s ? fmtGHS(s.available) : "—"} is available.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="withdraw-reason" className="text-xs">Reason</Label>
              <Input
                id="withdraw-reason"
                value={out.reason}
                onChange={e => setOut(f => ({ ...f, reason: e.target.value }))}
                placeholder="e.g. Correcting top-up BANK-REF-1, keyed as 15,000 instead of 1,500"
                className="h-10"
                maxLength={300}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setWithdrawOpen(false)}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={!outOk || out.reason.trim().length < 5 || withdraw.isPending}>
                {withdraw.isPending ? "Recording…" : outOk ? `Withdraw ${fmtGHS(out.amount)}` : "Withdraw"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default MasterWallet;
