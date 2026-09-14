import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, ScanLine } from "lucide-react";
import { TicketReceiptView, type TicketReceipt } from "@/components/ticket-receipt";

/**
 * Ticket review for admins, cashiers and agents. Accepts a typed ticket
 * number or the payload from a scanned QR - scanners type their payload in
 * as keyboard input, so the same box handles both.
 */
export function TicketLookup() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState<string | null>(null);

  const { data, isFetching, isError, error } = useQuery<TicketReceipt>({
    queryKey: ["/api/tickets/lookup", query],
    queryFn: async () => {
      const res = await fetch(`/api/tickets/lookup?q=${encodeURIComponent(query!)}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` },
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Lookup failed");
      return res.json();
    },
    enabled: !!query,
    retry: false,
  });

  /**
   * A scanned QR arrives as the JSON payload we encoded. Pull the ticket
   * number out of it so scanning and typing behave identically.
   */
  const normalise = (raw: string): string => {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        return parsed.n ?? parsed.t ?? trimmed;
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = normalise(input);
    if (q) setQuery(q);
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ticket Lookup</h1>
        <p className="text-muted-foreground text-sm">
          Scan a ticket QR or enter its ticket number to review the full details and status.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ScanLine className="h-4 w-4" /> Find a ticket
              </CardTitle>
              <CardDescription>
                Scanners enter the code as typed input — put the cursor in the box and scan.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="flex gap-2">
                <Input
                  autoFocus
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="TKT-20260912-1234"
                  className="font-mono"
                />
                <Button type="submit" disabled={!input.trim() || isFetching}>
                  {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  <span className="ml-2 hidden sm:inline">Look up</span>
                </Button>
              </form>
              {isError && (
                <p className="text-sm text-destructive mt-3">{(error as Error).message}</p>
              )}
            </CardContent>
          </Card>

          {data && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{data.ticket.ticketNumber}</CardTitle>
                <CardDescription>
                  {data.game.name} · draw {data.game.eventNumber} · sold by {data.writer.name} ({data.writer.code})
                  {data.agent.name ? ` · ${data.agent.name}` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                  <Fact label="Numbers" value={data.ticket.numbers.split(",").map((n) => n.trim()).join("  ")} mono />
                  <Fact label="Bet type" value={data.betType.name} />
                  <Fact label="Status" value={data.ticket.status.toUpperCase()} />
                  <Fact label="Stake" value={`GH₵ ${Number(data.ticket.stakeAmount).toFixed(2)}`} />
                  <Fact
                    label={data.ticket.isWinner ? "Won" : "Would pay"}
                    value={`GH₵ ${Number(
                      data.ticket.isWinner ? data.ticket.winAmount : data.ticket.potentialPayout,
                    ).toFixed(2)}`}
                  />
                  <Fact label="Draw date" value={data.game.drawDate} />
                  <Fact label="Sold" value={data.ticket.saleDate} />
                  <Fact label="Valid until" value={data.ticket.validUntil} />
                  <Fact label="Agent" value={data.agent.name ?? data.agent.code} />
                </dl>
              </CardContent>
            </Card>
          )}
        </div>

        {data && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Receipt</CardTitle>
              <CardDescription>Print, send by SMS, or copy the slip.</CardDescription>
            </CardHeader>
            <CardContent>
              <TicketReceiptView data={data} />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

/** One labelled figure in the ticket summary. */
function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80">
        {label}
      </dt>
      <dd className={`mt-1 truncate text-sm font-semibold ${mono ? "font-mono tabular-nums" : ""}`} title={value}>
        {value}
      </dd>
    </div>
  );
}
