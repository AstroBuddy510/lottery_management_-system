import { useState, useEffect } from "react";
import { useGetMyAgent, getGetMyAgentQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { CheckCircle2, AlertCircle, CreditCard, ArrowRight, ShieldCheck } from "lucide-react";

export function OnlinePayment() {
  const qc = useQueryClient();
  const { data: agent, isLoading, isError } = useGetMyAgent({
    query: { queryKey: getGetMyAgentQueryKey() }
  });

  const [amount, setAmount] = useState("");
  const [isInitializing, setIsInitializing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // Check if we just redirected back from a successful payment
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "true") {
      setShowSuccess(true);
      // Clean up the URL query params
      window.history.replaceState({}, document.title, window.location.pathname);
      // Invalidate queries to refresh balance
      qc.invalidateQueries({ queryKey: getGetMyAgentQueryKey() });
    }
  }, [qc]);

  const handlePresetClick = (val: number) => {
    setAmount(String(val));
  };

  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    setIsInitializing(true);
    try {
      const response = await fetch("/api/payments/paystack/initialize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("accessToken")}`,
        },
        body: JSON.stringify({ amount: Number(amount) }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to initialize payment");
      }

      if (data.authorization_url) {
        toast.loading("Redirecting to Paystack checkout...");
        window.location.href = data.authorization_url;
      } else {
        throw new Error("Authorization URL not returned from server");
      }
    } catch (err: any) {
      toast.error(err.message || "An error occurred during checkout setup");
      setIsInitializing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="px-4 py-8 max-w-md mx-auto space-y-6">
        <Skeleton className="h-8 w-48 rounded-xl" />
        <Skeleton className="h-48 rounded-3xl" />
        <Skeleton className="h-64 rounded-3xl" />
      </div>
    );
  }

  if (isError || !agent) {
    return (
      <div className="px-4 py-12 text-center max-w-md mx-auto space-y-4">
        <AlertCircle className="w-12 h-12 text-destructive mx-auto animate-bounce" />
        <h2 className="text-xl font-bold">Failed to load agent profile</h2>
        <p className="text-sm text-muted-foreground">
          We couldn't retrieve your agent account details. Please contact your administrator.
        </p>
      </div>
    );
  }

  const outstandingDebt = parseFloat(agent.outstandingDebt);

  return (
    <div className="px-4 py-6 max-w-md mx-auto space-y-6">
      {/* Sticky header */}
      <div className="flex items-center justify-between pb-2 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-primary to-violet-500 bg-clip-text text-transparent">
            Make Deposit
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Top up your balance instantly using Paystack
          </p>
        </div>
        <CreditCard className="w-6 h-6 text-muted-foreground" />
      </div>

      {showSuccess && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-3xl p-6 text-center space-y-3 relative overflow-hidden animate-in fade-in zoom-in-95 duration-300">
          <div className="absolute -top-10 -right-10 w-24 h-24 bg-emerald-500/10 rounded-full blur-xl" />
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
          <h3 className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
            Payment Successful!
          </h3>
          <p className="text-xs text-emerald-600/90 dark:text-emerald-500/90 leading-relaxed px-4">
            Your online deposit has been processed successfully. Your agent balance and ledger details have been updated automatically.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="border-emerald-500/30 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400 font-semibold rounded-xl"
            onClick={() => setShowSuccess(false)}
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Account Info card */}
      <Card className="rounded-3xl border border-border shadow-md overflow-hidden bg-gradient-to-br from-card to-card/50 relative">
        <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-2xl -mr-6 -mt-6" />
        <CardHeader className="pb-2">
          <CardDescription className="text-xs">Agent Profile ({agent.fullCode})</CardDescription>
          <CardTitle className="text-lg">{agent.user?.fullName || "Agent Account"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-primary/5 dark:bg-primary/10 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground font-medium block">
                Outstanding Balance
              </span>
              <span className="text-2xl font-bold font-mono tracking-tight text-foreground">
                GH₵ {outstandingDebt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${
                outstandingDebt > 0
                  ? "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                  : "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
              }`}
            >
              {outstandingDebt > 0 ? "Pending Debt" : "Clear Balance"}
            </span>
          </div>

          <div className="flex justify-between items-center text-xs px-1">
            <span className="text-muted-foreground">Location:</span>
            <span className="font-semibold text-foreground">{agent.location || "Not Set"}</span>
          </div>
        </CardContent>
      </Card>

      {/* Payment Form card */}
      <Card className="rounded-3xl border border-border shadow-md">
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold">Initialize Secure Payment</CardTitle>
          <CardDescription className="text-xs">
            Card, Mobile Money, and Bank Transfer options are available
          </CardDescription>
        </CardHeader>
        <form onSubmit={handlePayment}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="amount" className="text-xs font-semibold">
                Deposit Amount (GHS)
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground font-mono">
                  GH₵
                </span>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  min="1"
                  required
                  placeholder="Enter amount (e.g. 100)"
                  className="pl-12 h-12 text-sm font-semibold rounded-2xl border-border focus-visible:ring-2 focus-visible:ring-primary"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={isInitializing}
                />
              </div>
            </div>

            {/* Presets */}
            <div className="space-y-2">
              <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider block">
                Quick Select
              </span>
              <div className="grid grid-cols-4 gap-2">
                {[50, 100, 200, 500].map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-10 rounded-xl text-xs font-semibold transition-all hover:bg-primary hover:text-primary-foreground active:scale-95"
                    onClick={() => handlePresetClick(preset)}
                    disabled={isInitializing}
                  >
                    +{preset}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex-col gap-3 pt-2">
            <Button
              type="submit"
              className="w-full h-12 rounded-2xl font-bold bg-primary text-primary-foreground shadow-md hover:bg-primary/95 transition-transform active:scale-[0.99] flex items-center justify-center gap-2"
              disabled={isInitializing}
            >
              {isInitializing ? (
                <>
                  <span className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                  Initializing Secure Checkout...
                </>
              ) : (
                <>
                  Pay Now with Paystack
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </Button>

            <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              Secured by Paystack. All details are encrypted.
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
