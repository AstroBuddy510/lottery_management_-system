import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { ShieldAlert, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function AdminRiskManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: dashboard } = useQuery({
    queryKey: ["/api/risk/dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/risk/dashboard", { headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` } });
      return res.json();
    }
  });

  const { data: flags, isLoading } = useQuery({
    queryKey: ["/api/risk/flags"],
    queryFn: async () => {
      const res = await fetch("/api/risk/flags", { headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` } });
      return res.json();
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string, status: string }) => {
      const res = await fetch(`/api/risk/flags/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("accessToken")}` },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Flag updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/risk/flags"] });
      queryClient.invalidateQueries({ queryKey: ["/api/risk/dashboard"] });
    },
  });

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'critical': return <Badge variant="destructive">Critical</Badge>;
      case 'high': return <Badge className="bg-orange-500">High</Badge>;
      case 'medium': return <Badge className="bg-yellow-500 text-black">Medium</Badge>;
      default: return <Badge variant="secondary">Low</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-tight">Risk Management</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-red-50 border-red-200">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-red-800">Open Risk Flags</CardTitle>
            <ShieldAlert className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-700">{dashboard?.openFlags || 0}</div>
            <p className="text-xs text-red-600/80 mt-1">Require immediate attention</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Alerts</CardTitle>
          <CardDescription>Monitored activities such as frequent combinations or high velocity betting.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Writer</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="text-center">Loading...</TableCell></TableRow>
                ) : flags?.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No alerts found</TableCell></TableRow>
                ) : (
                  flags?.map((row: any) => (
                    <TableRow key={row.flag.id}>
                      <TableCell className="text-xs">{format(new Date(row.flag.createdAt), "MMM d, h:mm a")}</TableCell>
                      <TableCell>
                        <div className="font-medium">{row.writer?.fullName || 'System'}</div>
                        <div className="text-xs text-muted-foreground">{row.writer?.fullCode}</div>
                      </TableCell>
                      <TableCell className="capitalize">{row.flag.flagType.replace(/_/g, ' ')}</TableCell>
                      <TableCell>{getSeverityBadge(row.flag.severity)}</TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate" title={row.flag.description}>{row.flag.description}</TableCell>
                      <TableCell>
                        <Select 
                          value={row.flag.status} 
                          onValueChange={(val) => updateMutation.mutate({ id: row.flag.id, status: val })}
                        >
                          <SelectTrigger className="w-[120px] h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="open">Open</SelectItem>
                            <SelectItem value="reviewed">Reviewed</SelectItem>
                            <SelectItem value="dismissed">Dismissed</SelectItem>
                            <SelectItem value="escalated">Escalated</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                           <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" onClick={() => updateMutation.mutate({ id: row.flag.id, status: 'reviewed' })} title="Mark Reviewed"><Check className="h-4 w-4" /></Button>
                           <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" onClick={() => updateMutation.mutate({ id: row.flag.id, status: 'dismissed' })} title="Dismiss"><X className="h-4 w-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
