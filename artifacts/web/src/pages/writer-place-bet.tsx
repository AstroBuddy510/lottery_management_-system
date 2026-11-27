import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { TicketReceiptDialog } from "@/components/ticket-receipt";
import { SlipReceiptDialog } from "@/components/slip-receipt";
import { NumberKeypad } from "@/components/number-keypad";
import { getServerNow } from "@/lib/time-sync";
import { SettlementLockBanner, useSettlementGate, gateFor } from "@/components/settlement-lock";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, ShoppingCart, Receipt, Clock, Ticket as TicketIcon } from "lucide-react";
import { WriterCard, WriterCardHeader, WriterPageHeader, WriterStep } from "@/components/writer-ui";
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

  /**
   * Automated postpaid settlement, when the administrator has it on.
   *
   * The server refuses the sale regardless; this is so the writer knows why
   * before they have picked numbers and typed a stake, rather than after.
   */
  const { data: gateData } = useSettlementGate();
  const gate = gateFor(gateData, gameId);
  const settlementLocked = !!gate && !gate.allowed;

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
    if (!stakeAmount || !(parseFloat(stakeAmount) > 0)) return "Enter the amount per stake";
    if (bettingClosed) return "Betting has closed for this game";
    if (settlementLocked) {
      return gate?.reason === "previous-day-unpaid"
        ? "Settle yesterday's bill before selling"
        : "Settlement is due — hand in this game's takings to resume";
    }
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

  /*
   * The amount, where the hand is after the last number: beside the keypad's
   * backspace and clear, as on a paper slip. It is the stake for one line;
   * a perm or banker bet multiplies it by its lines.
   */
  const amountField = (
    <div className="relative h-12">
      {/* Centred on the box's top edge. */}
      <span className="pointer-events-none absolute -top-2 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-card px-1.5 text-[9px] font-bold uppercase leading-4 tracking-wider text-primary">
        Amount per stake
      </span>
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] font-bold text-muted-foreground">GH₵</span>
      <Input
        type="number"
        step="0.01"
        min="1"
        inputMode="decimal"
        placeholder="Enter amount"
        aria-label="Amount per stake (GH₵)"
        value={stakeAmount}
        onChange={(e) => setStakeAmount(e.target.value)}
        // The placeholder is set like the GH₵ beside it - small, bold, muted -
        // so it fits the box whole; a typed amount is large and monospaced.
        className="h-12 rounded-xl border-2 border-primary/50 pl-9 pr-2 font-mono text-base font-bold focus-visible:border-primary placeholder:font-sans placeholder:text-[11px] placeholder:font-bold placeholder:text-muted-foreground [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
    </div>
  );

  const busy = placeSlipMutation.isPending || placeBetMutation.isPending;
  // Something half-entered: numbers or a banker picked, or an amount typed.
  const halfEntered = picked.length > 0 || !!banker;
  const canPlace = !busy && !bettingClosed && !settlementLocked &&
    (cart.length > 0 ? (!halfEntered || !!quote?.valid) : !!quote?.valid);

  /** Sell what is on screen: the slip (with the bet in progress, if it is complete) or the one bet. */
  const placeNow = () => {
    if (cart.length === 0) {
      handleSubmit();
      return;
    }
    if (halfEntered && !quote?.valid) {
      toast({ title: "Finish this bet or clear it first", description: quote?.reason ?? undefined, variant: "destructive" });
      return;
    }
    if (bettingClosed) {
      toast({ title: "Betting has closed for this game", variant: "destructive" });
      return;
    }
    const bets = [...cart.map((b) => ({ betTypeCode: b.betTypeCode, numbers: b.numbers, stakeAmount: b.stakePerLine, bankerNumber: b.bankerNumber }))];
    if (halfEntered && quote?.valid) {
      bets.push({ betTypeCode, numbers, stakeAmount: parseFloat(stakeAmount), bankerNumber: banker });
    }
    placeSlipMutation.mutate({
      gameId,
      bets: bets.map((b) => ({
        betTypeCode: b.betTypeCode,
        numbers: b.numbers,
        stakeAmount: b.stakeAmount,
        ...(b.bankerNumber != null ? { bankerNumber: b.bankerNumber } : {}),
      })),
    });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <WriterPageHeader
        title="Place Bet"
        icon={TicketIcon}
        subtitle="Choose a draw and a bet type, pick the numbers, then enter the amount."
        action={user?.operationModel === "prepaid" ? (
          <span className="inline-flex flex-col items-end rounded-xl bg-primary/10 px-3 py-1.5 text-right">
            <span className="text-[9px] font-bold uppercase tracking-wider text-primary/80">Tokens</span>
            <span className="text-sm font-black tabular-nums text-primary">GHS {wallet?.balance || "0.00"}</span>
          </span>
        ) : undefined}
      />

      {/* The countdown, or the reason selling has stopped. Renders nothing
          when automated settlement is off, which is the normal case. */}
      <SettlementLockBanner gate={gate} />
      
      <WriterCard>
        <WriterCardHeader icon={TicketIcon} title="New Ticket"
          description={selectedGame ? `${selectedGame.name} · ${selectedGame.eventNumber}` : "Nothing sold until you place it"}
          right={selectedGame && !bettingClosed ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
              <Clock className="h-3 w-3" /> {timeLeft(selectedGame.closeAt)}
            </span>
          ) : undefined} />
        <div className="p-4 sm:p-5">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <WriterStep n={1} title="Draw" done={!!gameId} />
              <Select value={gameId} onValueChange={setGameId} disabled={cart.length > 0}>
                <SelectTrigger className="h-12 rounded-xl min-w-0">
                  {/* The trigger shows the draw's name, with its event and time
                      left in small print that gives way first on a narrow phone. */}
                  <SelectValue placeholder={loadingGames ? "Loading..." : "Select a live game"}>
                    {selectedGame && (
                      <span className="flex min-w-0 items-baseline gap-1.5">
                        <span className="truncate font-semibold">{selectedGame.name}</span>
                        <span className="truncate text-[11px] text-muted-foreground">
                          {selectedGame.eventNumber} · {timeLeft(selectedGame.closeAt)}
                        </span>
                      </span>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="max-w-[calc(100vw-1.5rem)]">
                  {liveGames.map((g: any) => (
                    <SelectItem key={g.id} value={g.id} className="min-w-0">
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-semibold">{g.name}</span>
                        <span className="truncate text-[11px] opacity-70">{g.eventNumber} · {timeLeft(g.closeAt)}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <WriterStep n={2} title="Bet type" done={!!betTypeCode} />
              <Select value={betTypeCode} onValueChange={setBetTypeCode}>
                <SelectTrigger className="h-12 rounded-xl min-w-0">
                  <SelectValue placeholder={loadingBetTypes ? "Loading..." : "Select bet type"}>
                    {selectedBetType && (
                      <span className="flex min-w-0 items-baseline gap-1.5">
                        <span className="truncate font-semibold">{selectedBetType.name}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">×{selectedBetType.payoutMultiplier}</span>
                      </span>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="max-w-[calc(100vw-1.5rem)]">
                  {betTypes?.filter((b: any) => b.isActive).map((b: any) => (
                    <SelectItem key={b.code} value={b.code} className="min-w-0">
                      <span className="flex min-w-0 items-baseline gap-1.5">
                        <span className="truncate">{b.name}</span>
                        <span className="shrink-0 text-[11px] opacity-70">×{b.payoutMultiplier}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {liveGames.length === 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
                <Clock className="h-4 w-4 shrink-0" />
                No game is open for betting right now.
              </div>
            )}

            {/* The banker gets the same keypad as everything else. It used to be
                a bare number box, which on Banker All - where the banker is the
                only pick - left the writer with no keypad on the screen at
                all, and made this one bet type feel broken next to the rest. */}
            {selectedBetType && needsBanker && (
              <div className="space-y-2">
                <WriterStep n={3} title="Banker" hint="the number that must drop" done={!!banker} />
                <NumberKeypad
                  selected={banker ? [banker] : []}
                  onChange={(next) => setBanker(next.length ? (next[next.length - 1] as number) : null)}
                  min={1}
                  max={1}
                  // An against-number cannot also be the banker.
                  reserved={picked}
                  reservedLabel="Against"
                  disabled={!gameId || !betTypeCode || bettingClosed}
                  // Banker All picks only the banker, so the amount sits here;
                  // otherwise it sits under the against-numbers.
                  action={wantsNumbers ? false : amountField}
                />
              </div>
            )}

            {selectedBetType && Number(selectedBetType.maxNumbers) > 0 && (
              <div className="space-y-2">
                <WriterStep
                  n={needsBanker ? 4 : 3}
                  title={needsBanker ? "Against" : "Numbers"}
                  hint={Number(selectedBetType.minNumbers) === Number(selectedBetType.maxNumbers)
                    ? `pick ${selectedBetType.minNumbers}`
                    : `pick ${selectedBetType.minNumbers} to ${selectedBetType.maxNumbers}`}
                  done={picked.length >= Number(selectedBetType.minNumbers)} />
                <NumberKeypad
                  selected={picked}
                  onChange={setPicked}
                  // The banker is held apart: it cannot be picked again here.
                  reserved={needsBanker && banker ? [banker] : []}
                  reservedLabel="Banker"
                  min={Number(selectedBetType.minNumbers)}
                  max={Number(selectedBetType.maxNumbers)}
                  disabled={!gameId || !betTypeCode || bettingClosed}
                  action={amountField}
                />
              </div>
            )}



            {selectedBetType && stakeAmount && quote && (
              <div className="space-y-2 rounded-2xl bg-gradient-to-br from-primary/[0.06] to-transparent p-4 ring-1 ring-primary/15">
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

            {cart.length > 0 && (
              <div className="rounded-2xl border-2 border-primary/30 bg-primary/5 p-3 space-y-3">
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

                <p className="text-[10px] text-muted-foreground text-center">
                  Nothing is charged until you tap Place Bet. All bets on a slip share one draw.
                </p>
              </div>
            )}

            {/* The action bar, as on the paper slip: Add Bet keeps building the
                slip, Place Bet sells it (or this one bet, when the slip is empty). */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <Button
                type="button"
                variant="outline"
                // Same weight of border as the keypad's clear button; text centred.
                className="h-12 justify-center rounded-xl text-center font-bold"
                disabled={!quote?.valid || placeSlipMutation.isPending || placeBetMutation.isPending}
                onClick={addToCart}
              >
                Add Bet
              </Button>
              <Button
                type="button"
                className="h-12 rounded-xl border-2 border-amber-400 font-black tracking-wide shadow-md ring-2 ring-amber-300/40 disabled:border-amber-200 disabled:ring-0"
                disabled={!canPlace}
                onClick={placeNow}
              >
                <Receipt className="h-4 w-4 mr-1.5" />
                {placeSlipMutation.isPending || placeBetMutation.isPending
                  ? "Placing…"
                  : cart.length > 0
                    ? `Place Bet · ${cart.length + (quote?.valid ? 1 : 0)}`
                    : "Place Bet"}
              </Button>
            </div>
            {!selectedBetType && (
              <p className="-mt-2 text-center text-[11px] text-muted-foreground">Choose a draw and a bet type to start.</p>
            )}
          </form>
        </div>
      </WriterCard>

      <TicketReceiptDialog ticketId={receiptTicketId} onClose={() => setReceiptTicketId(null)} />
      <SlipReceiptDialog slipNumber={slipNumber} onClose={() => setSlipNumber(null)} />
    </div>
  );
}
