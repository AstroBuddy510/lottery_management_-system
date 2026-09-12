import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, CheckCircle } from "lucide-react";

export function AdminGameResults() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [gameId, setGameId] = useState("");
  const [winningNumbers, setWinningNumbers] = useState("");
  const [machineNumbers, setMachineNumbers] = useState("");

  const { data: games } = useQuery({
    queryKey: ["/api/games"],
    queryFn: async () => {
      const res = await fetch("/api/games", { headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` } });
      return res.json();
    }
  });

  const resultMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch("/api/game-results", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("accessToken")}` },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Results posted successfully!" });
      setWinningNumbers("");
      setMachineNumbers("");
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" })
  });

  const payoutMutation = useMutation({
    mutationFn: async (gId: string) => {
      const res = await fetch(`/api/game-results/${gId}/process-payouts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` },
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Payouts Processed", description: `Processed ${data.processedCount} payouts & sent SMS notifications.` });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" })
  });

  // Simple UI for the prototype
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold tracking-tight">Post Game Results</h1>
      
      <Card>
        <CardHeader>
          <CardTitle>Enter Winning & Machine Numbers</CardTitle>
          <CardDescription>This will calculate all winning tickets and update writers' ledgers.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={(e) => {
            e.preventDefault();
            resultMutation.mutate({ gameId, winningNumbers, machineNumbers });
          }}>
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Closed Game</label>
              <Select value={gameId} onValueChange={setGameId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a game" />
                </SelectTrigger>
                <SelectContent>
                  {games?.map((g: any) => (
                    <SelectItem key={g.id} value={g.id}>{g.name} ({g.eventNumber}) - {g.status}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Winning Numbers</label>
              <Input 
                placeholder="e.g. 12,34,56,78,90" 
                value={winningNumbers} 
                onChange={e => setWinningNumbers(e.target.value)} 
                required 
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Machine Numbers</label>
              <Input 
                placeholder="e.g. 11,22,33,44,55" 
                value={machineNumbers} 
                onChange={e => setMachineNumbers(e.target.value)} 
                required 
              />
            </div>

            <Button type="submit" disabled={resultMutation.isPending || !gameId} className="w-full">
              {resultMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Post Results & Calculate Winners
            </Button>
          </form>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
          <CardTitle>Process Payouts & SMS</CardTitle>
          <CardDescription>Trigger wallet credits and SMS notifications for winners of a calculated game.</CardDescription>
        </CardHeader>
        <CardContent>
           <div className="flex gap-4">
              <Select value={gameId} onValueChange={setGameId}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select a game" />
                </SelectTrigger>
                <SelectContent>
                  {games?.map((g: any) => (
                    <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button 
                onClick={() => payoutMutation.mutate(gameId)} 
                disabled={payoutMutation.isPending || !gameId}
                variant="secondary"
              >
                {payoutMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Process Payouts
              </Button>
           </div>
        </CardContent>
      </Card>
    </div>
  );
}
