import { useState } from "react";
import {
  useGetWriterReport, useGetAgentReport, useGetOrgReport,
  useListAgents, useListWriters,
  getGetWriterReportQueryKey, getGetAgentReportQueryKey, getGetOrgReportQueryKey,
  getListWritersQueryKey,
  WriterReport, AgentReport, OrgReport,
} from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function Fmt({ v }: { v: string }) {
  const n = Number(v);
  return <span className={`font-mono ${n < 0 ? "text-destructive" : ""}`}>GH₵ {n.toFixed(2)}</span>;
}

function TotalsCard({ title, t }: { title: string; t: WriterReport["totals"] }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="pb-3 grid grid-cols-3 gap-x-6 gap-y-1">
        {([["Gross Sales", t.grossSales], ["Commission", t.commissionAmount], ["Net Gross", t.netGross], ["Wins", t.winsAmount], ["Reserve", t.reserveAmount], ["Balance", t.writerBalance]] as [string, string][]).map(([l, v]) => (
          <div key={l}><span className="text-xs text-muted-foreground">{l}: </span><Fmt v={v} /></div>
        ))}
      </CardContent>
    </Card>
  );
}

function WriterReportView() {
  const [selectedAgent, setSelectedAgent] = useState("");
  const [writerId, setWriterId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [run, setRun] = useState(false);

  const { data: agents } = useListAgents({});
  const { data: writers } = useListWriters(selectedAgent, {}, {
    query: { queryKey: getListWritersQueryKey(selectedAgent, {}), enabled: !!selectedAgent },
  });

  const { data: report, isLoading } = useGetWriterReport(
    writerId,
    { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined },
    { query: { queryKey: getGetWriterReportQueryKey(writerId, { dateFrom, dateTo }), enabled: run && !!writerId } },
  );

  const agentList = Array.isArray(agents) ? agents : [];
  const writerList = Array.isArray(writers) ? writers : [];

  const handleAgentChange = (v: string) => { setSelectedAgent(v); setWriterId(""); setRun(false); };
  const handleChange = () => setRun(false);

  return (
    <div className="space-y-4 pt-4">
      <div className="bg-muted/30 border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Report Parameters</span>
            <p className="text-xs text-muted-foreground mt-0.5">Select a writer and optional date range, then run.</p>
          </div>
          <Button size="sm" disabled={!writerId} onClick={() => setRun(true)}>Run Report</Button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Agent</Label>
            <Select value={selectedAgent || "_none"} onValueChange={v => handleAgentChange(v === "_none" ? "" : v)}>
              <SelectTrigger className="h-9 text-sm bg-background"><SelectValue placeholder="Select agent…" /></SelectTrigger>
              <SelectContent>
                {agentList.map(a => <SelectItem key={a.id} value={a.id}>{a.user?.fullName ?? a.fullCode} ({a.fullCode})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Writer</Label>
            <Select value={writerId || "_none"} onValueChange={v => { setWriterId(v === "_none" ? "" : v); handleChange(); }} disabled={!selectedAgent}>
              <SelectTrigger className="h-9 text-sm bg-background"><SelectValue placeholder="Select writer…" /></SelectTrigger>
              <SelectContent>
                {writerList.map(w => <SelectItem key={w.id} value={w.id}>{w.fullCode} — {w.fullName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">From</Label>
            <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); handleChange(); }} className="h-9 text-sm bg-background" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">To</Label>
            <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); handleChange(); }} className="h-9 text-sm bg-background" />
          </div>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground py-4 text-center">Loading report…</p>}

      {report && (
        <div className="space-y-4">
          <ReportLetterhead
            title="Writer Performance Report"
            subtitle={`${(report as WriterReport).writer.fullCode} — ${(report as WriterReport).writer.fullName}${dateFrom || dateTo ? `  ·  ${dateFrom || "…"} to ${dateTo || "…"}` : ""}`}
          />
          <TotalsCard title={`${(report as WriterReport).writer.fullCode} — ${(report as WriterReport).writer.fullName}`} t={(report as WriterReport).totals} />
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead className="text-right">Wins</TableHead>
                  <TableHead className="text-right">Reserve</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {((report as WriterReport).rows ?? []).map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-sm">{row.calcDate?.split("T")[0]}</TableCell>
                    <TableCell className="text-right"><Fmt v={row.grossSales} /></TableCell>
                    <TableCell className="text-right text-muted-foreground"><Fmt v={row.commissionAmount} /></TableCell>
                    <TableCell className="text-right"><Fmt v={row.netGross} /></TableCell>
                    <TableCell className="text-right text-destructive"><Fmt v={row.winsAmount} /></TableCell>
                    <TableCell className="text-right text-muted-foreground"><Fmt v={row.reserveAmount} /></TableCell>
                    <TableCell className="text-right font-semibold"><Fmt v={row.writerBalance} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

function AgentReportView() {
  const [agentId, setAgentId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [run, setRun] = useState(false);

  const { data: agents } = useListAgents({});
  const { data: report, isLoading } = useGetAgentReport(
    agentId,
    { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined },
    { query: { queryKey: getGetAgentReportQueryKey(agentId, { dateFrom, dateTo }), enabled: run && !!agentId } },
  );

  const agentList = Array.isArray(agents) ? agents : [];
  const handleChange = () => setRun(false);

  return (
    <div className="space-y-4 pt-4">
      <div className="bg-muted/30 border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Report Parameters</span>
            <p className="text-xs text-muted-foreground mt-0.5">Select an agent and optional date range, then run.</p>
          </div>
          <Button size="sm" disabled={!agentId} onClick={() => setRun(true)}>Run Report</Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Agent</Label>
            <Select value={agentId || "_none"} onValueChange={v => { setAgentId(v === "_none" ? "" : v); handleChange(); }}>
              <SelectTrigger className="h-9 text-sm bg-background"><SelectValue placeholder="Select agent…" /></SelectTrigger>
              <SelectContent>
                {agentList.map(a => <SelectItem key={a.id} value={a.id}>{a.user?.fullName ?? a.fullCode} ({a.fullCode})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">From</Label>
            <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); handleChange(); }} className="h-9 text-sm bg-background" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">To</Label>
            <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); handleChange(); }} className="h-9 text-sm bg-background" />
          </div>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground py-4 text-center">Loading report…</p>}

      {report && (
        <div className="space-y-4">
          <ReportLetterhead
            title="Agent Performance Report"
            subtitle={`Agent ${(report as AgentReport).agent.fullCode}${dateFrom || dateTo ? `  ·  ${dateFrom || "…"} to ${dateTo || "…"}` : ""}`}
          />
          <TotalsCard title={`Agent ${(report as AgentReport).agent.fullCode}`} t={(report as AgentReport).totals} />
          {(report as AgentReport).writers.map(ws => (
            <Card key={ws.writer.id}>
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs text-muted-foreground">{ws.writer.fullCode} — {ws.writer.fullName}</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3 grid grid-cols-3 gap-x-6 gap-y-1">
                {([["Gross", ws.totals.grossSales], ["Wins", ws.totals.winsAmount], ["Balance", ws.totals.writerBalance]] as [string, string][]).map(([l, v]) => (
                  <div key={l}><span className="text-xs text-muted-foreground">{l}: </span><Fmt v={v} /></div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function OrgReportView() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [run, setRun] = useState(false);

  const { data: report, isLoading } = useGetOrgReport(
    { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined },
    { query: { queryKey: getGetOrgReportQueryKey({ dateFrom, dateTo }), enabled: run } },
  );

  const handleChange = () => setRun(false);

  return (
    <div className="space-y-4 pt-4">
      <div className="bg-muted/30 border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Report Parameters</span>
            <p className="text-xs text-muted-foreground mt-0.5">Choose an optional date range and run the org-wide report.</p>
          </div>
          <Button size="sm" onClick={() => setRun(true)}>Run Report</Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">From</Label>
            <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); handleChange(); }} className="h-9 text-sm bg-background" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">To</Label>
            <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); handleChange(); }} className="h-9 text-sm bg-background" />
          </div>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground py-4 text-center">Loading report…</p>}

      {report && (
        <div className="space-y-4">
          <ReportLetterhead
            title="Organisation Report"
            subtitle={dateFrom || dateTo ? `${dateFrom || "…"} to ${dateTo || "…"}` : "All periods"}
          />
          <TotalsCard title="Organization Totals" t={(report as OrgReport).totals} />
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead className="text-right">Wins</TableHead>
                  <TableHead className="text-right">Reserve</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(report as OrgReport).agents.map(a => (
                  <TableRow key={a.agent.id}>
                    <TableCell className="text-sm font-mono font-medium">{a.agent.fullCode}</TableCell>
                    <TableCell className="text-right"><Fmt v={a.totals.grossSales} /></TableCell>
                    <TableCell className="text-right text-muted-foreground"><Fmt v={a.totals.commissionAmount} /></TableCell>
                    <TableCell className="text-right"><Fmt v={a.totals.netGross} /></TableCell>
                    <TableCell className="text-right text-destructive"><Fmt v={a.totals.winsAmount} /></TableCell>
                    <TableCell className="text-right text-muted-foreground"><Fmt v={a.totals.reserveAmount} /></TableCell>
                    <TableCell className="text-right font-semibold"><Fmt v={a.totals.writerBalance} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

function ReportLetterhead({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-4 border-b border-border pb-4 mb-4">
      <img
        src="/company-logo.png"
        alt="VS2000 Logo"
        className="w-14 h-14 rounded-full object-cover flex-shrink-0 shadow-sm ring-2 ring-border"
      />
      <div className="flex-1 min-w-0">
        <div className="text-base font-bold text-foreground leading-tight">VS2000 Smart Office</div>
        <div className="text-sm font-semibold text-primary mt-0.5">{title}</div>
        {subtitle && <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>}
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Generated</div>
        <div className="text-xs font-medium text-foreground">
          {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
        </div>
      </div>
    </div>
  );
}

export function Reports() {
  return (
    <div className="p-6">
      <div className="mb-5 flex items-center gap-4">
        <img
          src="/company-logo.png"
          alt="VS2000 Logo"
          className="w-12 h-12 rounded-full object-cover flex-shrink-0 shadow ring-2 ring-border"
        />
        <div>
          <h1 className="text-xl font-semibold">Reports</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Generate writer, agent, and organisation performance reports</p>
        </div>
      </div>
      <Tabs defaultValue="writer">
        <TabsList>
          <TabsTrigger value="writer">Writer</TabsTrigger>
          <TabsTrigger value="agent">Agent</TabsTrigger>
          <TabsTrigger value="org">Organization</TabsTrigger>
        </TabsList>
        <TabsContent value="writer"><WriterReportView /></TabsContent>
        <TabsContent value="agent"><AgentReportView /></TabsContent>
        <TabsContent value="org"><OrgReportView /></TabsContent>
      </Tabs>
    </div>
  );
}
