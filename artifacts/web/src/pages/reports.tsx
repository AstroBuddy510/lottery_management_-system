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

function Fmt({ v }: { v: string; negative?: boolean }) {
  const n = Number(v);
  return <span className={`font-mono ${n < 0 ? "text-destructive" : ""}`}>GH₵ {n.toFixed(2)}</span>;
}

function TotalsCard({ title, t }: { title: string; t: WriterReport["totals"] }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="pb-3 grid grid-cols-3 gap-x-6 gap-y-1">
        {[["Gross Sales", t.grossSales], ["Commission", t.commissionAmount], ["Net Gross", t.netGross], ["Wins", t.winsAmount], ["Reserve", t.reserveAmount], ["Balance", t.writerBalance]].map(([l, v]) => (
          <div key={l}><span className="text-xs text-muted-foreground">{l}: </span><Fmt v={v as string} /></div>
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
    query: { queryKey: getListWritersQueryKey(selectedAgent, {}), enabled: !!selectedAgent }
  });

  const { data: report, isLoading } = useGetWriterReport(
    writerId,
    { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined },
    { query: { queryKey: getGetWriterReportQueryKey(writerId, { dateFrom, dateTo }), enabled: run && !!writerId } }
  );

  const agentList = Array.isArray(agents) ? agents : [];
  const writerList = Array.isArray(writers) ? writers : [];

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap items-end">
        <div className="space-y-1.5">
          <Label className="text-xs">Agent</Label>
          <Select value={selectedAgent} onValueChange={v => { setSelectedAgent(v); setWriterId(""); setRun(false); }}>
            <SelectTrigger className="h-9 text-sm w-44"><SelectValue placeholder="Select agent..." /></SelectTrigger>
            <SelectContent>{agentList.map(a => <SelectItem key={a.id} value={a.id}>{a.user?.fullName ?? a.fullCode} ({a.fullCode})</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Writer</Label>
          <Select value={writerId} onValueChange={v => { setWriterId(v); setRun(false); }} disabled={!selectedAgent}>
            <SelectTrigger className="h-9 text-sm w-44"><SelectValue placeholder="Select writer..." /></SelectTrigger>
            <SelectContent>{writerList.map(w => <SelectItem key={w.id} value={w.id}>{w.fullCode}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5"><Label className="text-xs">From</Label><Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setRun(false); }} className="h-9 text-sm w-36" /></div>
        <div className="space-y-1.5"><Label className="text-xs">To</Label><Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setRun(false); }} className="h-9 text-sm w-36" /></div>
        <Button size="sm" className="h-9" disabled={!writerId} onClick={() => setRun(true)}>Run</Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {report && (
        <div className="space-y-4">
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
                {(report as WriterReport).rows.map((row, i) => (
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
    { query: { queryKey: getGetAgentReportQueryKey(agentId, { dateFrom, dateTo }), enabled: run && !!agentId } }
  );

  const agentList = Array.isArray(agents) ? agents : [];

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap items-end">
        <div className="space-y-1.5">
          <Label className="text-xs">Agent</Label>
          <Select value={agentId} onValueChange={v => { setAgentId(v); setRun(false); }}>
            <SelectTrigger className="h-9 text-sm w-44"><SelectValue placeholder="Select agent..." /></SelectTrigger>
            <SelectContent>{agentList.map(a => <SelectItem key={a.id} value={a.id}>{a.user?.fullName ?? a.fullCode} ({a.fullCode})</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5"><Label className="text-xs">From</Label><Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setRun(false); }} className="h-9 text-sm w-36" /></div>
        <div className="space-y-1.5"><Label className="text-xs">To</Label><Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setRun(false); }} className="h-9 text-sm w-36" /></div>
        <Button size="sm" className="h-9" disabled={!agentId} onClick={() => setRun(true)}>Run</Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {report && (
        <div className="space-y-4">
          <TotalsCard title={`Agent ${(report as AgentReport).agent.fullCode}`} t={(report as AgentReport).totals} />
          {(report as AgentReport).writers.map(ws => (
            <Card key={ws.writer.id}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{ws.writer.fullCode} — {ws.writer.fullName}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3 grid grid-cols-3 gap-x-6 gap-y-1">
                {[["Gross", ws.totals.grossSales], ["Wins", ws.totals.winsAmount], ["Balance", ws.totals.writerBalance]].map(([l, v]) => (
                  <div key={l}><span className="text-xs text-muted-foreground">{l}: </span><Fmt v={v as string} /></div>
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
    { query: { queryKey: getGetOrgReportQueryKey({ dateFrom, dateTo }), enabled: run } }
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap items-end">
        <div className="space-y-1.5"><Label className="text-xs">From</Label><Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setRun(false); }} className="h-9 text-sm w-36" /></div>
        <div className="space-y-1.5"><Label className="text-xs">To</Label><Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setRun(false); }} className="h-9 text-sm w-36" /></div>
        <Button size="sm" className="h-9" onClick={() => setRun(true)}>Run</Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {report && (
        <div className="space-y-4">
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

export function Reports() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-6">Reports</h1>
      <Tabs defaultValue="writer">
        <TabsList className="mb-6">
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
