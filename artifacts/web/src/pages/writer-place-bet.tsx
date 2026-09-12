import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function WriterPlaceBet() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [location] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const initialGameId = searchParams.get("game") || "";

  const [gameId, setGameId] = useState(initialGameId);
  const [betTypeCode, setBetTypeCode] = useState("");
  const [numbers, setNumbers] = useState("");
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
    onSuccess: () => {
      toast({ title: "Bet placed successfully!", variant: "default" });
      setNumbers("");
      setStakeAmount("");
      queryClient.invalidateQueries({ queryKey: ["/api/writer-tokens/balance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  const liveGames = games?.filter((g: any) => g.status === "live") || [];
  const selectedBetType = betTypes?.find((b: any) => b.code === betTypeCode);

  const calculatePotentialPayout = () => {
    if (!selectedBetType || !stakeAmount) return "0.00";
    return (parseFloat(stakeAmount) * parseFloat(selectedBetType.payoutMultiplier)).toFixed(2);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!gameId || !betTypeCode || !numbers || !stakeAmount) return;
    
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
                    <SelectItem key={g.id} value={g.id}>{g.name} ({g.eventNumber})</SelectItem>
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

            {selectedBetType && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Numbers (Required: {selectedBetType.numbersRequired})</label>
                <Input 
                  placeholder="e.g. 23, 45, 67" 
                  value={numbers}
                  onChange={(e) => setNumbers(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Separate numbers with commas (1-90)</p>
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

            <Button 
              type="submit" 
              className="w-full mt-6" 
              size="lg"
              disabled={placeBetMutation.isPending || !gameId || !betTypeCode || !numbers || !stakeAmount}
            >
              {placeBetMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Place Bet
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
