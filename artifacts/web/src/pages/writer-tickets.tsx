import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";

export function WriterTickets() {
  const { data: tickets, isLoading } = useQuery({
    queryKey: ["/api/tickets"],
    queryFn: async () => {
      const res = await fetch("/api/tickets", { headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` } });
      return res.json();
    }
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'won': return <Badge className="bg-green-500">Won</Badge>;
      case 'lost': return <Badge variant="destructive">Lost</Badge>;
      case 'active': return <Badge variant="secondary">Active</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">My Tickets</h1>
      
      <Card>
        <CardHeader>
          <CardTitle>Recent Tickets</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticket No.</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Numbers</TableHead>
                  <TableHead>Stake</TableHead>
                  <TableHead>Win Amt</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center">Loading...</TableCell></TableRow>
                ) : tickets?.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No tickets found</TableCell></TableRow>
                ) : (
                  tickets?.map((ticket: any) => (
                    <TableRow key={ticket.id}>
                      <TableCell className="font-medium text-xs">{ticket.ticketNumber}</TableCell>
                      <TableCell>{format(new Date(ticket.createdAt), "MMM d, h:mm a")}</TableCell>
                      <TableCell className="tracking-widest font-mono font-bold text-primary">{ticket.numbers.replace(/,/g, ' - ')}</TableCell>
                      <TableCell>GHS {ticket.stakeAmount}</TableCell>
                      <TableCell>{ticket.isWinner ? `GHS ${ticket.winAmount}` : "-"}</TableCell>
                      <TableCell>{getStatusBadge(ticket.status)}</TableCell>
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
