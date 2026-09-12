import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Check, X, Loader2 } from "lucide-react";

interface PendingWriter {
  id: string;
  fullName: string;
  phone: string | null;
  fullCode: string;
  idType: string | null;
  idNumber: string | null;
  operationModel: string;
  registrationSource: string;
  approvalStatus: string;
  createdAt: string;
  agentId: string;
  agencyName: string | null;
  agentFullCode: string | null;
}

const ID_TYPE_LABELS: Record<string, string> = {
  ghana_card: "Ghana Card",
  voters_id: "Voter's ID",
  drivers_license: "Driver's Licence",
};

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem("accessToken")}` };
}

export function AdminWriterApprovals() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: writers, isLoading, isError, error } = useQuery<PendingWriter[]>({
    queryKey: ["/api/writers/pending"],
    queryFn: async () => {
      const res = await fetch("/api/writers/pending", { headers: authHeaders() });
      if (!res.ok) {
        throw new Error((await res.json().catch(() => ({}))).error || "Failed to load pending writers");
      }
      return res.json();
    },
  });

  const decide = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "approve" | "reject" }) => {
      const res = await fetch(`/api/writers/${id}/${action}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        throw new Error((await res.json().catch(() => ({}))).error || "Failed");
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      toast({ title: variables.action === "approve" ? "Writer approved" : "Writer rejected" });
      queryClient.invalidateQueries({ queryKey: ["/api/writers/pending"] });
    },
    onError: (err: Error) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const pendingId = decide.isPending ? decide.variables?.id : undefined;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-tight">Writer Approvals</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pending Registrations</CardTitle>
          <CardDescription>
            Writers awaiting review. Approving one lets them sign in to the writer portal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>ID Type</TableHead>
                  <TableHead>ID Number</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center">
                      <Loader2 className="h-4 w-4 animate-spin inline" />
                    </TableCell>
                  </TableRow>
                ) : isError ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-destructive">
                      {(error as Error).message}
                    </TableCell>
                  </TableRow>
                ) : !writers || writers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground">
                      No pending writer registrations
                    </TableCell>
                  </TableRow>
                ) : (
                  writers.map((w) => (
                    <TableRow key={w.id}>
                      <TableCell className="whitespace-nowrap">
                        {w.createdAt ? format(new Date(w.createdAt), "dd MMM yyyy") : "—"}
                      </TableCell>
                      <TableCell className="font-medium">
                        {w.fullName}
                        <span className="block text-xs text-muted-foreground">{w.fullCode}</span>
                      </TableCell>
                      <TableCell>{w.phone ?? "—"}</TableCell>
                      <TableCell>{w.agencyName ?? w.agentFullCode ?? "—"}</TableCell>
                      <TableCell>{w.idType ? ID_TYPE_LABELS[w.idType] ?? w.idType : "—"}</TableCell>
                      <TableCell>{w.idNumber ?? "—"}</TableCell>
                      <TableCell className="capitalize">{w.operationModel}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="capitalize">
                          {w.registrationSource}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="outline"
                          className="mr-2"
                          disabled={decide.isPending}
                          onClick={() => decide.mutate({ id: w.id, action: "approve" })}
                        >
                          {pendingId === w.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                          <span className="ml-1">Approve</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={decide.isPending}
                          onClick={() => decide.mutate({ id: w.id, action: "reject" })}
                        >
                          <X className="h-3.5 w-3.5" />
                          <span className="ml-1">Reject</span>
                        </Button>
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
