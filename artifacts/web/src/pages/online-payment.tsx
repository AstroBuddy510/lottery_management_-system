import { useState, useEffect } from "react";
import {
  useGetMyAgent,
  getGetMyAgentQueryKey,
  useRequestPayment,
  useListPayments,
  getListPaymentsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle2, AlertCircle, CreditCard, ArrowRight, ShieldCheck, Coins, Clock } from "lucide-react";

export function OnlinePayment() {
  const qc = useQueryClient();
  const { data: agent, isLoading, isError } = useGetMyAgent({
    query: { queryKey: getGetMyAgentQueryKey() }
  });

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"paystack" | "cash">("paystack");
  const [isInitializing, setIsInitializing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  const { data: pendingRequests } = useListPayments({
    status: "pending",
  });

  const requestMutation = useRequestPayment();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetMyAgentQueryKey() });
    qc.invalidateQueries({ queryKey: getListPaymentsQueryKey({ status: "pending" }) });
    qc.invalidateQueries({ queryKey: getListPaymentsQueryKey({}) });
  };

  // Check if we just redirected back from a successful payment
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "true") {
      setShowSuccess(true);
      setSuccessMsg("Your online deposit has been processed successfully. Your agent balance and ledger details have been updated automatically.");
      // Clean up the URL query params
      window.history.replaceState({}, document.title, window.location.pathname);
      // Invalidate queries to refresh balance
      invalidate();
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
    if (method === "cash") {
      try {
        await requestMutation.mutateAsync({
          data: {
            amount: Number(amount).toFixed(2),
            paymentMethod: "cash",
            notes: "Pending cash submission to cashier"
          }
        });
        setSuccessMsg(`Cash request for GH₵ ${Number(amount).toFixed(2)} submitted. Please pay cash to the cashier to complete the transaction.`);
        setShowSuccess(true);
        setAmount("");
        invalidate();
        toast.success("Cash request submitted successfully!");
      } catch (err: any) {
        toast.error(err.message || "Failed to submit cash request");
      } finally {
        setIsInitializing(false);
      }
      return;
    }

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

  return (
    <div className="px-4 py-6 max-w-md mx-auto space-y-6 animate-in fade-in duration-300">
      {/* Sticky header */}
      <div className="flex items-center justify-between pb-2 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-primary to-violet-500 bg-clip-text text-transparent">
            Make Payment
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pay online via Paystack or submit a Cash request
          </p>
        </div>
        <Coins className="w-6 h-6 text-muted-foreground" />
      </div>

      {showSuccess && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-3xl p-6 text-center space-y-3 relative overflow-hidden animate-in fade-in zoom-in-95 duration-300">
          <div className="absolute -top-10 -right-10 w-24 h-24 bg-emerald-500/10 rounded-full blur-xl" />
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
          <h3 className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
            {method === "cash" ? "Request Submitted!" : "Payment Successful!"}
          </h3>
          <p className="text-xs text-emerald-600/90 dark:text-emerald-500/90 leading-relaxed px-4">
            {successMsg}
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
            {(() => {
              const val = parseFloat(agent.outstandingDebt || "0");
              const isCompanyOwes = val > 0;
              const isAgentOwes = val < 0;
              const absVal = Math.abs(val);
              return (
                <>
                  <div>
                    <span className="text-xs text-muted-foreground font-medium block">
                      {isCompanyOwes ? "Company owes you" : isAgentOwes ? "Pending Debt" : "Clear Balance"}
                    </span>
                    <span className="text-2xl font-bold font-mono tracking-tight text-foreground">
                      GH₵ {absVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${
                      isAgentOwes
                        ? "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                        : "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                    }`}
                  >
                    {isCompanyOwes ? "Company owes you" : isAgentOwes ? "Pending Debt" : "Clear Balance"}
                  </span>
                </>
              );
            })()}
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
          <CardTitle className="text-base font-semibold">Initialize Payment</CardTitle>
          <CardDescription className="text-xs">
            Choose a payment method and enter the amount
          </CardDescription>
        </CardHeader>
        <form onSubmit={handlePayment}>
          <CardContent className="space-y-6">
            {/* Payment Method Selection */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Payment Method</Label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setMethod("paystack")}
                  className={`flex flex-col items-center justify-center p-4 rounded-2xl border transition-all text-center relative overflow-hidden h-24 ${
                    method === "paystack"
                      ? "border-primary bg-primary/5 text-primary shadow-sm"
                      : "border-border hover:border-muted-foreground/30 bg-transparent text-muted-foreground"
                  }`}
                >
                  <CreditCard className="w-5 h-5 mb-2" />
                  <span className="text-xs font-bold">Paystack</span>
                  <span className="text-[10px] opacity-80 mt-0.5">Online (Momo/Card)</span>
                  {method === "paystack" && (
                    <div className="absolute top-1.5 right-1.5 w-4 h-4 bg-primary rounded-full flex items-center justify-center text-primary-foreground">
                      <span className="w-1.5 h-1.5 bg-current rounded-full" />
                    </div>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setMethod("cash")}
                  className={`flex flex-col items-center justify-center p-4 rounded-2xl border transition-all text-center relative overflow-hidden h-24 ${
                    method === "cash"
                      ? "border-primary bg-primary/5 text-primary shadow-sm"
                      : "border-border hover:border-muted-foreground/30 bg-transparent text-muted-foreground"
                  }`}
                >
                  <Coins className="w-5 h-5 mb-2" />
                  <span className="text-xs font-bold">Cash to Cashier</span>
                  <span className="text-[10px] opacity-80 mt-0.5">Pay in at office</span>
                  {method === "cash" && (
                    <div className="absolute top-1.5 right-1.5 w-4 h-4 bg-primary rounded-full flex items-center justify-center text-primary-foreground">
                      <span className="w-1.5 h-1.5 bg-current rounded-full" />
                    </div>
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="amount" className="text-xs font-semibold">
                Amount (GHS)
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
              {(() => {
                const val = parseFloat(agent.outstandingDebt || "0");
                const isAgentOwes = val < 0;
                const absVal = Math.abs(val);
                if (isAgentOwes) {
                  return (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="w-full h-10 rounded-xl text-xs font-bold transition-all mt-2 border border-primary/20 bg-primary/5 text-primary hover:bg-primary hover:text-primary-foreground"
                      onClick={() => handlePresetClick(absVal)}
                      disabled={isInitializing}
                    >
                      Pay Outstanding Debt (GH₵ {absVal.toFixed(2)})
                    </Button>
                  );
                }
                return null;
              })()}
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
                  {method === "paystack" ? "Initializing Secure Checkout..." : "Submitting Cash Request..."}
                </>
              ) : method === "paystack" ? (
                <>
                  Pay Now with Paystack
                  <ArrowRight className="w-4 h-4" />
                </>
              ) : (
                <>
                  Submit Cash Request
                  <Coins className="w-4 h-4" />
                </>
              )}
            </Button>

            <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground text-center">
              {method === "paystack" ? (
                <>
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                  Secured by Paystack. All details are encrypted.
                </>
              ) : (
                <>
                  <Clock className="w-3.5 h-3.5 text-amber-500" />
                  Once submitted, pay cash to the cashier to complete the transaction.
                </>
              )}
            </div>
          </CardFooter>
        </form>
      </Card>

      {/* Pending Requests List */}
      {pendingRequests && pendingRequests.length > 0 && (
        <Card className="rounded-3xl border border-border shadow-md overflow-hidden bg-gradient-to-br from-card to-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-500 animate-pulse" />
              Pending Cash Requests ({pendingRequests.length})
            </CardTitle>
            <CardDescription className="text-xs">
              Present the cash to the cashier to approve these payments.
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border/50 px-6">
            {pendingRequests.map((req) => (
              <div key={req.id} className="py-3 flex items-center justify-between first:pt-0 last:pb-0">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">
                      GH₵ {parseFloat(req.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] px-2 py-0.5 border-amber-500/20 font-semibold">
                      Awaiting Cashier
                    </Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Requested on {new Date(req.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-muted-foreground font-mono block">ID: {req.id.slice(0, 8)}</span>
                  {req.notes && <span className="text-[9px] text-muted-foreground/75 italic block max-w-[120px] truncate">{req.notes}</span>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
