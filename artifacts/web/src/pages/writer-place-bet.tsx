import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { TicketReceiptDialog } from "@/components/ticket-receipt";
import { SlipReceiptDialog } from "@/components/slip-receipt";
import { NumberKeypad } from "@/components/number-keypad";
import { getServerNow } from "@/lib/time-sync";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Info, Plus, Trash2, ShoppingCart, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/** One bet waiting to go onto a slip. Priced by the server, not here. */
interface CartBet {
  key: string;
  betTypeCode: string;
  betTypeName: string;
  numbers: string;
  bankerNumber: number | null;
  stakePerLine: number;
  lines: number;
  totalStake: number;
  maxPayout: number;
}

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
  // Banker bets carry one number outside the selection.
  const [banker, setBanker] = useState<number | null>(null);

  /**
   * Bets stacked up for one slip.
   *
   * Held in the page, not on the server: nothing is sold and no money moves
   * until the writer prints the slip, so a half-built basket that gets
   * abandoned costs nothing and leaves nothing behind to clean up.
   */
  const [cart, setCart] = useState<CartBet[]>([]);
  const [slipNumber, setSlipNumber] = useState<string | null>(null);

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

  const placeSlipMutation = useMutation({
    mutationFn: async (payload: { gameId: string; bets: Array<Record<string, unknown>> }) => {
      const res = await fetch("/api/tickets/slip", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("accessToken")}`,
        },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to sell this slip");
      return body as { slipNumber: string; ticketCount: number; totalStake: string };
    },
    onSuccess: (created) => {
      toast({ title: `${created.ticketCount} bets sold`, description: `Slip ${created.slipNumber}` });
      setSlipNumber(created.slipNumber);
      setCart([]);
      setPicked([]);
      setBanker(null);
      setStakeAmount("");
      queryClient.invalidateQueries({ queryKey: ["/api/writer-tokens/balance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/live-sales"] });
    },
    onError: (err: any) => {
      toast({ title: "Slip not sold", description: err.message, variant: "destructive" });
    },
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
  const needsBanker = selectedBetType?.mechanic?.startsWith("banker");
  // Banker All takes a banker and nothing else: maxNumbers is 0 by design.
  const wantsNumbers = !!selectedBetType && Number(selectedBetType.maxNumbers) > 0;

  // Choosing a different bet type invalidates the picks made for the old one.
  useEffect(() => {
    setPicked([]);
    setBanker(null);
  }, [betTypeCode]);

  const { data: quote } = useQuery<{
    valid: boolean;
    reason: string | null;
    lines: number;
    totalStake: number;
    maxPayout: number;
  }>({
    queryKey: ["/api/tickets/quote", betTypeCode, numbers, banker, stakeAmount],
    queryFn: async () => {
      const res = await fetch("/api/tickets/quote", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("accessToken")}`,
        },
        body: JSON.stringify({
          betTypeCode,
          numbers,
          stakeAmount: parseFloat(stakeAmount) || 0,
          bankerNumber: banker ?? undefined,
        }),
      });
      if (!res.ok) throw new Error("Could not price this bet");
      return res.json();
    },
    enabled: !!betTypeCode && !!stakeAmount && (picked.length > 0 || !!banker),
  });

  /**
   * What is stopping this bet being placed, or null when it is ready.
   *
   * Banker All picks no numbers at all - its banker plays against the other
   * 89 - so a blanket "numbers required" check silently refused it and the
   * button did nothing at all. Requirements come from the bet type now, and
   * whatever is missing is said out loud rather than swallowed.
   */
  const blockedBecause = (): string | null => {
    if (!gameId) return "Choose a game first";
    if (!betTypeCode) return "Choose a bet type";
    if (needsBanker && !banker) return "Enter the banker number";
    if (wantsNumbers && picked.length === 0) return "Pick your numbers";
    if (!stakeAmount || !(parseFloat(stakeAmount) > 0)) return "Enter the stake per line";
    if (bettingClosed) return "Betting has closed for this game";
    return null;
  };

  /**
   * Put the bet on screen into the basket.
   *
   * The server's own quote supplies the lines and the money, so a cart row
   * says the same thing the receipt will. Nothing is sold at this point.
   */
  const addToCart = () => {
    const blocked = blockedBecause();
    if (blocked) {
      toast({ title: blocked, variant: "destructive" });
      return;
    }
    if (!quote?.valid) {
      toast({
        title: quote?.reason ?? "This bet is not complete yet",
        variant: "destructive",
      });
      return;
    }

    setCart((prev) => [
      ...prev,
      {
        key: `${Date.now()}-${prev.length}`,
        betTypeCode,
        betTypeName: selectedBetType?.name ?? betTypeCode,
        numbers,
        bankerNumber: banker,
        stakePerLine: parseFloat(stakeAmount),
        lines: quote.lines,
        totalStake: quote.totalStake,
        maxPayout: quote.maxPayout,
      },
    ]);

    // Clear the picks but keep game, type and stake: the next bet in a basket
    // is usually the same shape with different numbers.
    setPicked([]);
    setBanker(null);
    toast({ title: "Bet added", description: `${cart.length + 1} on this slip` });
  };

  const removeFromCart = (key: string) => setCart((prev) => prev.filter((b) => b.key !== key));

  const cartTotal = cart.reduce((sum, b) => sum + b.totalStake, 0);
  const cartMaxWin = cart.reduce((sum, b) => sum + b.maxPayout, 0);

  const sellSlip = () => {
    if (cart.length === 0) return;
    if (bettingClosed) {
      toast({ title: "Betting has closed for this game", variant: "destructive" });
      return;
    }
    placeSlipMutation.mutate({
      gameId,
      bets: cart.map((b) => ({
        betTypeCode: b.betTypeCode,
        numbers: b.numbers,
        stakeAmount: b.stakePerLine,
        ...(b.bankerNumber != null ? { bankerNumber: b.bankerNumber } : {}),
      })),
    });
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const blocked = blockedBecause();
    if (blocked) {
      toast({ title: blocked, variant: "destructive" });
      return;
    }
    
    placeBetMutation.mutate({
      gameId,
      betTypeCode,
      numbers,
      // Per line. The server multiplies by the line count.
      stakeAmount: parseFloat(stakeAmount),
      bankerNumber: banker ?? undefined,
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
              <Select value={gameId} onValueChange={setGameId} disabled={cart.length > 0}>
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

            {/* Above the pickers deliberately: the keypad's own submit button is
                disabled until there is a stake, and when this sat underneath
                it the writer picked their numbers and found a dead button. */}
            {selectedBetType && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Stake per line (GHS)</label>
                <Input
                  type="number"
                  step="0.01"
                  min="1"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={stakeAmount}
                  onChange={(e) => setStakeAmount(e.target.value)}
                  className="h-12 text-lg font-mono"
                />
              </div>
            )}

            {/* The banker gets the same keypad as everything else. It used to be
                a bare number box, which on Banker All - where the banker is the
                only pick - left the writer with no keypad on the screen at
                all, and made this one bet type feel broken next to the rest. */}
            {selectedBetType && needsBanker && (
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Banker{" "}
                  <span className="text-muted-foreground font-normal">
                    (the number that must drop)
                  </span>
                </label>
                <NumberKeypad
                  selected={banker ? [banker] : []}
                  onChange={(next) => setBanker(next.length ? (next[next.length - 1] as number) : null)}
                  min={1}
                  max={1}
                  submitting={placeBetMutation.isPending}
                  disabled={!gameId || !betTypeCode || bettingClosed}
                  onSubmit={wantsNumbers ? undefined : () => handleSubmit()}
                  submitLabel="Place Bet"
                />
              </div>
            )}

            {selectedBetType && Number(selectedBetType.maxNumbers) > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {needsBanker ? "Against" : "Numbers"}
                  {" "}
                  <span className="text-muted-foreground font-normal">
                    (
                    {Number(selectedBetType.minNumbers) === Number(selectedBetType.maxNumbers)
                      ? `pick ${selectedBetType.minNumbers}`
                      : `pick ${selectedBetType.minNumbers} to ${selectedBetType.maxNumbers}`}
                    )
                  </span>
                </label>
                <NumberKeypad
                  selected={picked}
                  onChange={setPicked}
                  min={Number(selectedBetType.minNumbers)}
                  max={Number(selectedBetType.maxNumbers)}
                  submitting={placeBetMutation.isPending}
                  disabled={!gameId || !betTypeCode || bettingClosed}
                  onSubmit={!stakeAmount ? undefined : () => handleSubmit()}
                  submitLabel="Place Bet"
                />
              </div>
            )}



            {selectedBetType && stakeAmount && quote && (
              <div className="mt-4 space-y-2 rounded-xl border p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Lines</span>
                  <span className="font-semibold tabular-nums">{quote.lines}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Customer pays</span>
                  <span className="text-lg font-bold tabular-nums">
                    GHS {quote.totalStake.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t pt-2 text-sm">
                  <span className="text-muted-foreground">Most it can pay</span>
                  <span className="font-bold tabular-nums text-emerald-600">
                    GHS {quote.maxPayout.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                {!quote.valid && quote.reason && (
                  <p className="pt-1 text-xs text-amber-700 dark:text-amber-400">{quote.reason}</p>
                )}
              </div>
            )}

            {/* Add Bet stacks this bet up instead of selling it. The keypad's own
                Place Bet is left alone: most sales are a single bet and that
                path should stay one tap. */}
            {selectedBetType && (
              <Button
                type="button"
                variant="outline"
                className="w-full h-11"
                disabled={!quote?.valid || placeSlipMutation.isPending || placeBetMutation.isPending}
                onClick={addToCart}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Bet
              </Button>
            )}

            {cart.length > 0 && (
              <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-bold">
                    <ShoppingCart className="h-4 w-4" />
                    This slip
                    <span className="rounded-full bg-primary text-primary-foreground px-2 py-0.5 text-[10px] font-extrabold">
                      {cart.length}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[10px]"
                    disabled={placeSlipMutation.isPending}
                    onClick={() => setCart([])}
                  >
                    Clear all
                  </Button>
                </div>

                <div className="space-y-1.5">
                  {cart.map((b, i) => (
                    <div
                      key={b.key}
                      className="flex items-start gap-2 rounded-lg bg-background/70 px-2.5 py-2"
                    >
                      <span className="text-[10px] font-bold text-muted-foreground tabular-nums mt-0.5">
                        {i + 1}.
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold truncate">{b.betTypeName}</div>
                        <div className="text-[11px] font-mono text-muted-foreground break-all">
                          {b.numbers || "—"}
                          {b.bankerNumber != null && (
                            <span className="font-bold"> · B:{b.bankerNumber}</span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground tabular-nums">
                          {b.lines} line{b.lines === 1 ? "" : "s"} × GHS {b.stakePerLine.toFixed(2)}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs font-bold tabular-nums">
                          GHS {b.totalStake.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-destructive hover:text-destructive"
                          disabled={placeSlipMutation.isPending}
                          onClick={() => removeFromCart(b.key)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-primary/20 pt-2 space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Customer pays</span>
                    <span className="text-lg font-extrabold tabular-nums">
                      GHS {cartTotal.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Most it can pay</span>
                    <span className="font-bold tabular-nums text-emerald-600">
                      GHS {cartMaxWin.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>

                <Button
                  type="button"
                  className="w-full h-12"
                  disabled={placeSlipMutation.isPending || bettingClosed}
                  onClick={sellSlip}
                >
                  <Receipt className="h-4 w-4 mr-2" />
                  {placeSlipMutation.isPending
                    ? "Selling…"
                    : `Sell & print slip · GHS ${cartTotal.toFixed(2)}`}
                </Button>
                <p className="text-[10px] text-muted-foreground text-center">
                  Nothing is charged until you tap this. All bets on a slip share one draw.
                </p>
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
      <SlipReceiptDialog slipNumber={slipNumber} onClose={() => setSlipNumber(null)} />
    </div>
  );
}
