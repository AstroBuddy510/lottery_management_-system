import { useQuery } from "@tanstack/react-query";
import { Banknote, Building2, Landmark, Lock, PiggyBank, Scale, Wallet } from "lucide-react";
import { Panel, ScrollTable, ReportActions, StatTile } from "@/components/data-kit";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exportReportPdf, printReport, type TableReport } from "@/lib/table-report";
import { FIN_KEY, FIN_REFRESH_MS, finGet, ghs, ghsSigned, fmtDateTime, type Position } from "@/lib/finance-api";
import { Note } from "./shared";

type PaystackRecon = {
  paystackLive: number | null; bookBalance: number; walletClaims: number; walletAvailable: number; walletHeld: number;
  differenceLiveVsBook: number | null; walletCovered: boolean | null; feesAwaitingFigures: number;
};

const KIND_LABEL: Record<string, string> = { cash: "Cash", bank: "Bank", paystack: "Payment provider", momo: "MoMo wallet", other: "Other" };

export function positionReport(p: Position): TableReport {
  return {
    title: "Company Funds Position",
    fileName: `funds-position-${new Date().toISOString().slice(0, 10)}`,
    summary: [
      `Actual money held: ${ghs(p.actual)}`,
      `Set aside in funds: ${ghs(p.earmarked)}`,
      `Unallocated: ${ghsSigned(p.unallocated)}`,
    ],
    meta: [{ label: "As at", value: fmtDateTime(new Date().toISOString()) }],
    sections: [
      {
        heading: "Where the money is",
        columns: [{ header: "Account" }, { header: "Type" }, { header: "Opening", align: "right" }, { header: "In", align: "right" }, { header: "Out", align: "right" }, { header: "Balance", align: "right" }],
        rows: p.accounts.map((a) => [a.name + (a.accountRef ? ` (${a.accountRef})` : ""), KIND_LABEL[a.kind] ?? a.kind, ghs(a.openingBalance), ghs(a.totalIn), ghs(a.totalOut), ghsSigned(a.balance)]),
        totals: ["Total actual money", "", "", "", "", ghsSigned(p.actual)],
      },
      {
        heading: "How it is set aside",
        columns: [{ header: "Fund" }, { header: "Allocated", align: "right" }, { header: "Used / released", align: "right" }, { header: "Balance", align: "right" }],
        rows: p.funds.map((f) => [f.name, ghs(f.allocated), ghs(f.used), ghsSigned(f.balance)]),
        totals: ["Total set aside", "", "", ghs(p.earmarked)],
      },
      {
        heading: "Summary",
        columns: [{ header: "" }, { header: "Amount", align: "right" }],
        rows: [["Actual money", ghs(p.actual)], ["Less: set aside in funds", ghs(p.earmarked)]],
        totals: ["Unallocated, free to use", ghsSigned(p.unallocated)],
      },
    ],
  };
}

export function PositionTab() {
  const pos = useQuery({ queryKey: [...FIN_KEY, "position"], queryFn: finGet<Position>("/position"), refetchInterval: FIN_REFRESH_MS });
  const recon = useQuery({ queryKey: [...FIN_KEY, "paystack"], queryFn: finGet<PaystackRecon>("/reconcile/paystack"), refetchInterval: 60_000 });
  const p = pos.data;
  const r = recon.data;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatTile label="Actual money" value={p ? ghs(p.actual) : "…"} sub="Cash, bank and Paystack together" icon={Wallet} />
        <StatTile label="Set aside" value={p ? ghs(p.earmarked) : "…"} sub="Salary, reserve and other funds" icon={Lock} tone="warn" />
        <StatTile label="Unallocated" value={p ? ghsSigned(p.unallocated) : "…"} sub="Free for operations" icon={Scale} tone={p && p.unallocated < 0 ? "bad" : "in"} />
        <StatTile
          label="Paystack check"
          value={!r ? "…" : r.paystackLive === null ? "Not reachable" : Math.abs(r.differenceLiveVsBook ?? 0) < 0.005 ? "Agrees" : ghsSigned(r.differenceLiveVsBook)}
          sub={!r ? "" : r.paystackLive === null ? "Live balance could not be read" : "Live balance less the book"}
          icon={Landmark}
          tone={!r || r.paystackLive === null ? "muted" : Math.abs(r.differenceLiveVsBook ?? 0) < 0.005 ? "in" : "bad"}
        />
      </div>

      {p?.overCommitted && (
        <Note tone="bad">
          The funds set aside add up to more than the money the company actually holds. An allocation is a share of real money,
          so this means either money has left without being recorded, or a fund is promising money that is not there.
        </Note>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        <Panel
          className="xl:col-span-3"
          title="Where the money is"
          subtitle="Each account's balance is its opening figure plus everything the cash book has recorded in and out of it."
          icon={Building2}
          actions={p && <ReportActions label="the funds position" onPdf={() => exportReportPdf(positionReport(p))} onPrint={() => printReport(positionReport(p))} />}
        >
          <ScrollTable maxHeight="26rem" minWidth="30rem">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">In</TableHead>
                  <TableHead className="text-right">Out</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(p?.accounts ?? []).map((a) => (
                  <TableRow key={a.id} className={a.isActive ? "" : "opacity-60"}>
                    <TableCell>
                      <div className="font-semibold">{a.name}</div>
                      <div className="text-[11px] text-muted-foreground">{[KIND_LABEL[a.kind] ?? a.kind, a.institution, a.accountRef].filter(Boolean).join(" · ")}</div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-emerald-600 dark:text-emerald-400">{ghs(a.totalIn)}</TableCell>
                    <TableCell className="text-right font-mono text-orange-600 dark:text-orange-400">{ghs(a.totalOut)}</TableCell>
                    <TableCell className={`text-right font-mono font-bold ${a.balance < 0 ? "text-rose-600" : ""}`}>{ghsSigned(a.balance)}</TableCell>
                  </TableRow>
                ))}
                {p && (
                  <TableRow className="bg-muted/40 font-black">
                    <TableCell colSpan={3}>Total actual money</TableCell>
                    <TableCell className="text-right font-mono">{ghsSigned(p.actual)}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollTable>
        </Panel>

        <Panel className="xl:col-span-2" title="How it is set aside" subtitle="Funds divide the money above. They are never added to it." icon={PiggyBank}>
          <div className="p-5 space-y-4">
            {(p?.funds ?? []).map((f) => {
              const share = p && p.actual > 0 ? Math.max(0, Math.min(100, (f.balance / p.actual) * 100)) : 0;
              return (
                <div key={f.code} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-semibold truncate">{f.name}{f.derived && <span className="ml-1.5 text-[10px] font-bold uppercase text-muted-foreground">derived</span>}</span>
                    <span className={`font-mono text-sm font-bold ${f.balance < 0 ? "text-rose-600" : ""}`}>{ghsSigned(f.balance)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-amber-500" style={{ width: `${share}%` }} /></div>
                  <div className="text-[11px] text-muted-foreground">Allocated {ghs(f.allocated)} · used or released {ghs(f.used)}</div>
                </div>
              );
            })}
            {p && (
              <div className="border-t pt-3 flex items-baseline justify-between">
                <span className="text-sm font-black">Unallocated</span>
                <span className={`font-mono font-black ${p.unallocated < 0 ? "text-rose-600" : "text-emerald-600 dark:text-emerald-400"}`}>{ghsSigned(p.unallocated)}</span>
              </div>
            )}
          </div>
        </Panel>
      </div>

      <Panel title="Paystack, three ways" subtitle="What Paystack says it holds, what our books say, and what the Master Wallet has promised from it. All three must agree." icon={Banknote}>
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x">
          <div className="p-5"><div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Paystack (live)</div><div className="mt-1 text-xl font-black font-mono">{r?.paystackLive === null || !r ? "—" : ghs(r.paystackLive)}</div></div>
          <div className="p-5"><div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Our books</div><div className="mt-1 text-xl font-black font-mono">{r ? ghsSigned(r.bookBalance) : "…"}</div></div>
          <div className="p-5"><div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Master Wallet claims</div><div className="mt-1 text-xl font-black font-mono">{r ? ghs(r.walletClaims) : "…"}</div><div className="text-[11px] text-muted-foreground">available {r ? ghs(r.walletAvailable) : "…"} · held {r ? ghs(r.walletHeld) : "…"}</div></div>
        </div>
        {r && (
          <div className="border-t px-5 py-3 space-y-2">
            {r.paystackLive === null ? (
              <Note tone="warn">Paystack could not be asked for its balance just now, so this check cannot be made. The Master Wallet refuses top-ups until it can.</Note>
            ) : (
              <>
                {r.walletCovered === false && <Note tone="bad">The Master Wallet has promised more than Paystack holds. Wins could be approved that cannot be paid.</Note>}
                {Math.abs(r.differenceLiveVsBook ?? 0) >= 0.005 && (
                  <Note tone="warn">
                    Paystack holds {ghsSigned(r.differenceLiveVsBook)} {num0(r.differenceLiveVsBook) > 0 ? "more" : "less"} than the books show.
                    {r.feesAwaitingFigures > 0 && <> {r.feesAwaitingFigures} Paystack fee{r.feesAwaitingFigures === 1 ? " is" : "s are"} still waiting for a figure (Fees tab), which accounts for part of any gap.</>}
                    {" "}Money moved into or out of Paystack outside this system also shows up here.
                  </Note>
                )}
                {Math.abs(r.differenceLiveVsBook ?? 0) < 0.005 && r.walletCovered && <Note tone="ok">Paystack, the books and the Master Wallet agree.</Note>}
              </>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}

const num0 = (v: number | null) => v ?? 0;
