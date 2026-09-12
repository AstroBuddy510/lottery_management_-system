import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";

export function AdminWriterApprovals() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: writers, isLoading } = useQuery({
    queryKey: ["/api/writers/pending"],
    queryFn: async () => {
      // Mocking for now since we didn't add a dedicated GET /api/writers/pending endpoint in the plan
      return [];
    }
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-tight">Writer Approvals</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pending Registrations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>ID Type</TableHead>
                  <TableHead>ID Number</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="text-center">Loading...</TableCell></TableRow>
                ) : writers?.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No pending writer registrations</TableCell></TableRow>
                ) : (
                  // Map over pending writers here
                  null
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
