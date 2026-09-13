import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { TicketReceiptDialog } from "@/components/ticket-receipt";
import { NumberKeypad } from "@/components/number-keypad";
import { getServerNow } from "@/lib/time-sync";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function WriterPlaceBet() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [receiptTicketId, setReceiptTicketId] = useState<string | null>(null);
  const [location] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const initialGameId = searchParams.get("game") || "";

  const [gameId, setGameId] = useState(initialGameId);
  const [betTypeCode, setBetTypeCode] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const numbers = picked.join(",");
  const [stakeAmount, setStakeAmount] = useState("");

  const { data: games, isLoading: loadingGames } = useQuery({
    queryKey: ["/api/games"],
    queryFn: async () => {
      const res = await fetch("/api/games", { headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` } });
      return res.json();
    }
  });

  const { data: betTypes, isLoading: loadingBetTypes } = useQuery({
    queryKey: ["/api/bet-types"],
    queryFn: async () => {
      const res = await fetch("/api/bet-types", { headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` } });
      return res.json();
    }
  });

  const { data: wallet } = useQuery({
    queryKey: ["/api/writer-tokens/balance"],
    queryFn: async () => {
      const res = await fetch("/api/writer-tokens/balance", { headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` } });
      return res.json();
    },
    enabled: user?.operationModel === "prepaid"
  });

  const placeBetMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("accessToken")}` },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to place bet");
      }
      return res.json();
    },
    onSuccess: (created: any) => {
      toast({ title: "Bet placed successfully!", variant: "default" });
      // Straight to the printable slip - the writer needs it in hand now.
      if (created?.id) setReceiptTicketId(created.id);
      setPicked([]);
      setStakeAmount("");
      queryClient.invalidateQueries({ queryKey: ["/api/writer-tokens/balance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      // Reflect the new ticket in live figures immediately rather than
      // waiting for the next poll.
      queryClient.invalidateQueries({ queryKey: ["/api/live-sales"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  // A game stays 'live' past its close time by design - only calculations
  // close it - so status alone does not mean betting is open. Server time
  // decides, since a writer's device clock can be wrong or changed.
  const [now, setNow] = useState(() => getServerNow().getTime());
  useEffect(() => {
    const t = setInterval(() => setNow(getServerNow().getTime()), 1000);
    return () => clearInterval(t);
  }, []);

  const isOpenForBets = (g: any) =>
    g.status === "live" && new Date(g.closeAt).getTime() > now;

  const liveGames = (games ?? []).filter(isOpenForBets);
  const selectedGame = (games ?? []).find((g: any) => g.id === gameId);
  const bettingClosed = !!selectedGame && !isOpenForBets(selectedGame);

  // Clear a selection the moment its draw closes, so the form cannot be
  // submitted against a game that shut while the writer was picking numbers.
  useEffect(() => {
    if (bettingClosed) setGameId("");
  }, [bettingClosed]);

  const timeLeft = (closeAt: string) => {
    const ms = new Date(closeAt).getTime() - now;
    if (ms <= 0) return "closed";
    const m = Math.floor(ms / 60000);
    const sec = Math.floor((ms % 60000) / 1000);
    if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m left`;
    return m > 0 ? `${m}m ${sec}s left` : `${sec}s left`;
  };
  const selectedBetType = betTypes?.find((b: any) => b.code === betTypeCode);

  const calculatePotentialPayout = () => {
    if (!selectedBetType || !stakeAmount) return "0.00";
    return (parseFloat(stakeAmount) * parseFloat(selectedBetType.payoutMultiplier)).toFixed(2);
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!gameId || !betTypeCode || !numbers || !stakeAmount) return;
    if (bettingClosed) {
      toast({ title: "Betting has closed for this game", variant: "destructive" });
      return;
    }
    
    placeBetMutation.mutate({
      gameId,
      betTypeCode,
      numbers,
      stakeAmount: parseFloat(stakeAmount)
    });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Place Bet</h1>
      
      {user?.operationModel === "prepaid" && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="py-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Info className="h-5 w-5 text-primary" />
              <span className="font-medium text-sm">Available Tokens</span>
            </div>
            <span className="text-xl font-bold">GHS {wallet?.balance || "0.00"}</span>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>New Ticket</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Game</label>
              <Select value={gameId} onValueChange={setGameId}>
                <SelectTrigger>
                  <SelectValue placeholder={loadingGames ? "Loading..." : "Select a live game"} />
                </SelectTrigger>
                <SelectContent>
                  {liveGames.map((g: any) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name} ({g.eventNumber}) · {timeLeft(g.closeAt)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Bet Type</label>
              <Select value={betTypeCode} onValueChange={setBetTypeCode}>
                <SelectTrigger>
                  <SelectValue placeholder={loadingBetTypes ? "Loading..." : "Select bet type"} />
                </SelectTrigger>
                <SelectContent>
                  {betTypes?.filter((b: any) => b.isActive).map((b: any) => (
                    <SelectItem key={b.code} value={b.code}>{b.name} (x{b.payoutMultiplier})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {liveGames.length === 0 && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
                No game is open for betting right now.
              </div>
            )}

            {selectedBetType && (
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Numbers (Required: {selectedBetType.numbersRequired})
                </label>
                <NumberKeypad
                  selected={picked}
                  onChange={setPicked}
                  required={Number(selectedBetType.numbersRequired)}
                  submitting={placeBetMutation.isPending}
                  disabled={!gameId || !betTypeCode || bettingClosed}
                  onSubmit={!stakeAmount ? undefined : () => handleSubmit()}
                  submitLabel="Place Bet"
                />
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">Stake Amount (GHS)</label>
              <Input 
                type="number" 
                step="0.01" 
                min="1"
                placeholder="0.00"
                value={stakeAmount}
                onChange={(e) => setStakeAmount(e.target.value)}
              />
            </div>

            {selectedBetType && stakeAmount && (
              <div className="bg-muted p-4 rounded-lg flex justify-between items-center mt-4 border border-green-200 bg-green-50">
                <span className="font-medium text-green-800">Potential Payout</span>
                <span className="text-lg font-bold text-green-600">GHS {calculatePotentialPayout()}</span>
              </div>
            )}

            {!selectedBetType && (
              <Button
                type="submit"
                className="w-full mt-6"
                size="lg"
                disabled
              >
                Select a game and bet type
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

      <TicketReceiptDialog ticketId={receiptTicketId} onClose={() => setReceiptTicketId(null)} />
    </div>
  );
}
