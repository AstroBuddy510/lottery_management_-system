import { useState } from "react";
import { 
  useGetPayrollSummary,
  useGetSalaryWallet,
  useListWalletTransactions,
  useGetPayrollCalendar,
  useListSalaryPayments,
  useCreateSalaryPayment,
  useGeneratePayrollPeriod,
  useFundSalaryWallet,
  getGetPayrollSummaryQueryKey,
  getListSalaryPaymentsQueryKey,
  getGetPayrollCalendarQueryKey,
  getGetSalaryWalletQueryKey,
  getListWalletTransactionsQueryKey
} from "@workspace/api-client-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { generatePayrollPDF } from "@/lib/pdf-generator";
import { 
  Calendar as CalendarIcon, 
  Users, 
  Wallet, 
  CreditCard, 
  PiggyBank, 
  RefreshCw, 
  AlertCircle, 
  CheckCircle2,
  TrendingUp,
  Banknote,
  DollarSign,
  ChevronRight
} from "lucide-react";

export function StaffsEmployees() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: summary, isLoading: isLoadingSummary } = useGetPayrollSummary();
  const { data: wallet, isLoading: isLoadingWallet } = useGetSalaryWallet();
  const { data: calendar, isLoading: isLoadingCalendar } = useGetPayrollCalendar();
  const { data: payments, isLoading: isLoadingPayments } = useListSalaryPayments();
  const { data: transactions, isLoading: isLoadingTx } = useListWalletTransactions();

  const generatePeriodMutation = useGeneratePayrollPeriod();
  const fundWalletMutation = useFundSalaryWallet();
  const paySalaryMutation = useCreateSalaryPayment();

  // Dialog states
  const [isFundOpen, setIsFundOpen] = useState(false);
  const [fundAmount, setFundAmount] = useState("");
  const [fundNotes, setFundNotes] = useState("");

  const [isPayOpen, setIsPayOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<any>(null);
  const [deductions, setDeductions] = useState("0");
  const [payNotes, setPayNotes] = useState("");

  const isAdminOrDirector = user?.role === "administrator" || user?.role === "director";

  const handleGeneratePeriod = async () => {
    try {
      const res = await generatePeriodMutation.mutateAsync();
      toast({ title: "Period Generated", description: res.message });
      queryClient.invalidateQueries({ queryKey: getGetPayrollSummaryQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListSalaryPaymentsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetPayrollCalendarQueryKey() });
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to generate period", variant: "destructive" });
    }
  };

  const handleFundWallet = async () => {
    try {
      if (!fundAmount || parseFloat(fundAmount) <= 0) {
        toast({ title: "Error", description: "Invalid amount", variant: "destructive" });
        return;
      }
      await fundWalletMutation.mutateAsync({ data: { amount: fundAmount, notes: fundNotes } });
      toast({ title: "Wallet Funded", description: "Successfully added funds to the salary wallet." });
      setIsFundOpen(false);
      setFundAmount("");
      setFundNotes("");
      queryClient.invalidateQueries({ queryKey: getGetSalaryWalletQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListWalletTransactionsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetPayrollSummaryQueryKey() });
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to fund wallet", variant: "destructive" });
    }
  };

  const handlePaySalary = async () => {
    try {
      if (!selectedPayment) return;
      await paySalaryMutation.mutateAsync({ 
        data: { 
          salaryPaymentId: selectedPayment.id, 
          deductions: deductions, 
          notes: payNotes 
        } 
      });
      toast({ title: "Payment Successful", description: "Salary disbursed from wallet." });
      setIsPayOpen(false);
      setSelectedPayment(null);
      setDeductions("0");
      setPayNotes("");
      queryClient.invalidateQueries({ queryKey: getGetPayrollSummaryQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListSalaryPaymentsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetSalaryWalletQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListWalletTransactionsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetPayrollCalendarQueryKey() });
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to disburse salary", variant: "destructive" });
    }
  };

  return (
    <div className="p-6 space-y-6 relative min-h-screen">
      {/* Background radial glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-64 bg-gradient-to-b from-indigo-500/5 via-transparent to-transparent blur-3xl pointer-events-none" />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
        <div>
          <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent dark:from-indigo-400 dark:to-violet-400">Staffs & Employees</h1>
          <p className="text-xs text-muted-foreground mt-0.5 font-medium">Manage company staff payroll, agency staff remunerations, and salary wallet.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {payments && payments.length > 0 && (
            <Button
              onClick={() => {
                const firstP = payments[0];
                const periodLabel = firstP
                  ? format(new Date(firstP.periodYear, firstP.periodMonth - 1, 1), "MMMM yyyy")
                  : format(new Date(), "MMMM yyyy");
                generatePayrollPDF(periodLabel, payments);
              }}
              className="gap-2 bg-[#ff6700] hover:bg-[#ff6700]/90 text-white rounded-xl shadow-md transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 text-xs h-9 font-semibold"
            >
              Export Payroll PDF
            </Button>
          )}
          <Button onClick={handleGeneratePeriod} disabled={generatePeriodMutation.isPending} className="gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white rounded-xl shadow-md transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 text-xs h-9">
            <RefreshCw className={`h-3.5 w-3.5 ${generatePeriodMutation.isPending ? "animate-spin" : ""}`} />
            Generate This Month's Payroll
          </Button>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 relative z-10">
        {/* Total Staff */}
        <Card className="bg-card/75 backdrop-blur-md border border-border/50 shadow-sm hover:border-indigo-500/20 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 rounded-2xl overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1.5 pt-3.5 px-4.5">
            <CardTitle className="text-[10px] font-extrabold text-muted-foreground/80 uppercase tracking-wider">Total Staff</CardTitle>
            <span className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 shadow-xs"><Users className="h-4 w-4" /></span>
          </CardHeader>
          <CardContent className="px-4.5 pb-3.5">
            <div className="text-xl font-bold font-mono tracking-tight text-foreground">{(summary?.totalCompanyStaff || 0) + (summary?.totalAgencyStaff || 0)}</div>
            <p className="text-[9.5px] text-muted-foreground/70 mt-1 font-semibold">
              {summary?.totalCompanyStaff || 0} Company · {summary?.totalAgencyStaff || 0} Agency
            </p>
          </CardContent>
        </Card>

        {/* Monthly Payroll Due */}
        <Card className="bg-card/75 backdrop-blur-md border border-border/50 shadow-sm hover:border-blue-500/20 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 rounded-2xl overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1.5 pt-3.5 px-4.5">
            <CardTitle className="text-[10px] font-extrabold text-muted-foreground/80 uppercase tracking-wider">Monthly Payroll Due</CardTitle>
            <span className="p-1.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 shadow-xs"><CreditCard className="h-4 w-4" /></span>
          </CardHeader>
          <CardContent className="px-4.5 pb-3.5">
            <div className="text-xl font-bold font-mono tracking-tight text-foreground">
              <span className="text-muted-foreground/70 font-normal mr-0.5 text-sm">GH₵</span>
              {summary?.monthlyPayrollDue || "0.00"}
            </div>
            <p className="text-[9.5px] text-muted-foreground/70 mt-1 font-semibold">
              {summary?.payrollCompletionPercent || 0}% completed
            </p>
          </CardContent>
        </Card>

        {/* Accrued / Unpaid */}
        <Card className="bg-card/75 backdrop-blur-md border border-border/50 shadow-sm hover:border-rose-500/20 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 rounded-2xl overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1.5 pt-3.5 px-4.5">
            <CardTitle className="text-[10px] font-extrabold text-muted-foreground/80 uppercase tracking-wider">Accrued / Unpaid</CardTitle>
            <span className="p-1.5 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 shadow-xs"><AlertCircle className="h-4 w-4" /></span>
          </CardHeader>
          <CardContent className="px-4.5 pb-3.5">
            <div className="text-xl font-bold font-mono tracking-tight text-rose-600 dark:text-rose-400">
              <span className="text-muted-foreground/70 font-normal mr-0.5 text-sm">GH₵</span>
              {summary?.accruedUnpaid || "0.00"}
            </div>
            <p className="text-[9.5px] text-muted-foreground/70 mt-1 font-semibold">Needs payment soon</p>
          </CardContent>
        </Card>

        {/* Dedicated Salary Wallet */}
        <Card className="bg-card/75 backdrop-blur-md border border-emerald-500/20 dark:border-emerald-500/10 bg-emerald-500/5 shadow-sm hover:border-emerald-500/30 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 rounded-2xl overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1.5 pt-3.5 px-4.5">
            <CardTitle className="text-[10px] font-extrabold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider">Salary Wallet Balance</CardTitle>
            <span className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 shadow-xs"><Wallet className="h-4 w-4" /></span>
          </CardHeader>
          <CardContent className="px-4.5 pb-3.5">
            <div className="text-xl font-bold font-mono tracking-tight text-emerald-700 dark:text-emerald-400">
              <span className="text-muted-foreground/70 font-normal mr-0.5 text-sm">GH₵</span>
              {summary?.walletBalance || "0.00"}
            </div>
            {isAdminOrDirector && (
              <Dialog open={isFundOpen} onOpenChange={setIsFundOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="mt-2.5 w-full text-[10px] font-bold h-7 rounded-lg border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 shadow-xs transition-colors">
                    <PiggyBank className="mr-1 h-3.5 w-3.5" /> Fund Wallet
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md rounded-3xl border border-border/40 bg-card/95 backdrop-blur-lg shadow-2xl p-6">
                  <DialogHeader>
                    <DialogTitle className="text-base font-bold bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent dark:from-indigo-400 dark:to-violet-400">Fund Salary Wallet</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-muted-foreground">Amount (GH₵)</Label>
                      <Input type="number" step="0.01" value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} className="h-9 text-xs bg-background/60 border-border/60 rounded-xl" placeholder="0.00" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-muted-foreground">Notes</Label>
                      <Textarea value={fundNotes} onChange={(e) => setFundNotes(e.target.value)} placeholder="Enter details about this transaction..." className="text-xs bg-background/60 border-border/60 rounded-xl" />
                    </div>
                    <DialogFooter className="pt-2">
                      <Button variant="outline" size="sm" className="rounded-xl border-border/60" onClick={() => setIsFundOpen(false)}>Cancel</Button>
                      <Button onClick={handleFundWallet} disabled={fundWalletMutation.isPending} className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-bold">
                        {fundWalletMutation.isPending ? "Funding..." : "Submit Funding"}
                      </Button>
                    </DialogFooter>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Main tab sections */}
      <Tabs defaultValue="payments" className="relative z-10 space-y-6">
        <TabsList className="w-full justify-start border-b border-border/40 rounded-none h-auto p-0 bg-transparent gap-4">
          <TabsTrigger value="payments" className="rounded-none border-b-2 border-transparent data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-600 dark:data-[state=active]:border-indigo-400 dark:data-[state=active]:text-indigo-400 px-5 py-3 text-xs font-bold transition-all hover:text-foreground/80 data-[state=active]:bg-transparent shadow-none bg-transparent">
            Salary Payments
          </TabsTrigger>
          <TabsTrigger value="calendar" className="rounded-none border-b-2 border-transparent data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-600 dark:data-[state=active]:border-indigo-400 dark:data-[state=active]:text-indigo-400 px-5 py-3 text-xs font-bold transition-all hover:text-foreground/80 data-[state=active]:bg-transparent shadow-none bg-transparent">
            Payment Calendar
          </TabsTrigger>
          <TabsTrigger value="wallet" className="rounded-none border-b-2 border-transparent data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-600 dark:data-[state=active]:border-indigo-400 dark:data-[state=active]:text-indigo-400 px-5 py-3 text-xs font-bold transition-all hover:text-foreground/80 data-[state=active]:bg-transparent shadow-none bg-transparent">
            Wallet History
          </TabsTrigger>
        </TabsList>

        {/* Salary Payments tab content */}
        <TabsContent value="payments" className="space-y-4 outline-none">
          <Card className="border border-border/40 bg-card/65 backdrop-blur-md shadow-sm rounded-2xl overflow-hidden">
            <CardHeader className="pb-3 px-5 pt-5 border-b border-border/40">
              <CardTitle className="text-sm font-bold text-foreground">Disbursements & Trackings</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">Manage all accrued and paid salaries for both Company and Agency staff.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow className="border-b border-border/40">
                      <TableHead className="text-xs font-bold text-muted-foreground pl-5">Staff Name</TableHead>
                      <TableHead className="text-xs font-bold text-muted-foreground">Type/Position</TableHead>
                      <TableHead className="text-xs font-bold text-muted-foreground">Period</TableHead>
                      <TableHead className="text-right text-xs font-bold text-muted-foreground">Net Amount</TableHead>
                      <TableHead className="text-center text-xs font-bold text-muted-foreground">Status</TableHead>
                      <TableHead className="text-right text-xs font-bold text-muted-foreground pr-5">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingPayments ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-12 text-muted-foreground text-xs font-medium">
                          <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-600/60" />
                          Loading payments...
                        </TableCell>
                      </TableRow>
                    ) : payments?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-12 text-muted-foreground text-xs font-medium">
                          No payment records found.
                        </TableCell>
                      </TableRow>
                    ) : payments?.map((p) => {
                      // Row highlights based on unpaid/paid status
                      const rowClass = p.status === "paid"
                        ? "bg-emerald-500/[0.01] hover:bg-muted/10 border-b border-border/40 border-l-2 border-l-emerald-500/50 transition-colors"
                        : "bg-rose-500/[0.01] hover:bg-muted/10 border-b border-border/40 border-l-2 border-l-rose-500/50 transition-colors";

                      return (
                        <TableRow key={p.id} className={rowClass}>
                          <TableCell className="font-bold text-xs pl-5 py-3.5">
                            <span className="text-foreground">{p.staffName}</span>
                            {p.agencyName && (
                              <div className="text-[10px] text-muted-foreground/80 mt-0.5">
                                Agency: {p.agencyName}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="py-3.5">
                            <Badge variant="outline" className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-lg border shadow-xs ${
                              p.staffType === 'company'
                                ? "bg-indigo-500/10 border-indigo-500/20 text-indigo-700 dark:text-indigo-400"
                                : "bg-blue-500/10 border-blue-500/20 text-blue-700 dark:text-blue-400"
                            }`}>
                              {p.staffType === 'company' ? 'Internal' : 'Agency'}
                            </Badge>
                            <div className="text-[10px] text-muted-foreground/85 mt-1 font-medium">{p.staffPosition}</div>
                          </TableCell>
                          <TableCell className="text-xs text-foreground/80 font-medium py-3.5">
                            {format(new Date(p.periodYear, p.periodMonth - 1, 1), 'MMMM yyyy')}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs font-bold py-3.5">
                            <span className="text-muted-foreground/60 mr-0.5 font-normal">GH₵</span>
                            {p.netAmount}
                          </TableCell>
                          <TableCell className="text-center py-3.5">
                            {p.status === "paid" ? (
                              <Badge className="text-[9px] font-extrabold px-2.5 py-0.5 rounded-lg uppercase bg-emerald-500/10 border border-emerald-500/25 text-emerald-700 dark:text-emerald-400 shadow-xs">
                                Paid
                              </Badge>
                            ) : p.status === "pending" ? (
                              <Badge className="text-[9px] font-extrabold px-2.5 py-0.5 rounded-lg uppercase bg-rose-500/10 border border-rose-500/25 text-rose-700 dark:text-rose-400 shadow-xs">
                                Unpaid
                              </Badge>
                            ) : (
                              <Badge className="text-[9px] font-extrabold px-2.5 py-0.5 rounded-lg uppercase bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-400 shadow-xs">
                                Partial
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right pr-5 py-3.5">
                            {p.status !== "paid" && (
                              <Dialog open={isPayOpen && selectedPayment?.id === p.id} onOpenChange={(open) => {
                                setIsPayOpen(open);
                                if (open) {
                                  setSelectedPayment(p);
                                  setDeductions("0");
                                  setPayNotes("");
                                } else {
                                  setSelectedPayment(null);
                                }
                              }}>
                                <DialogTrigger asChild>
                                  <Button size="sm" className="h-7 text-[10px] font-bold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs">
                                    Disburse Salary
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-md rounded-3xl border border-border/40 bg-card/95 backdrop-blur-lg shadow-2xl p-6">
                                  <DialogHeader>
                                    <DialogTitle className="text-base font-bold bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent dark:from-indigo-400 dark:to-violet-400">
                                      Disburse Salary: {p.staffName}
                                    </DialogTitle>
                                  </DialogHeader>
                                  <div className="space-y-4 py-2">
                                    <div className="p-3.5 bg-muted/30 border border-border/40 rounded-2xl text-xs space-y-1.5 font-semibold text-foreground">
                                      <div className="flex justify-between text-muted-foreground font-normal"><span>Base Salary:</span> <span className="font-mono">GH₵ {p.baseSalary}</span></div>
                                      <div className="flex justify-between text-muted-foreground font-normal"><span>Allowances:</span> <span className="font-mono text-blue-600 dark:text-blue-400">GH₵ {p.allowances}</span></div>
                                      <div className="flex justify-between text-muted-foreground font-normal"><span>Bonuses:</span> <span className="font-mono text-emerald-600 dark:text-emerald-400">GH₵ {p.bonuses}</span></div>
                                      <div className="border-t border-border/40 my-2"></div>
                                      <div className="flex justify-between font-extrabold text-sm pt-1">
                                        <span>Gross Payable:</span> 
                                        <span className="font-mono text-indigo-600 dark:text-indigo-400">GH₵ {(parseFloat(p.baseSalary) + parseFloat(p.allowances) + parseFloat(p.bonuses)).toFixed(2)}</span>
                                      </div>
                                    </div>
                                    
                                    <div className="space-y-1.5">
                                      <Label className="text-xs font-semibold text-muted-foreground">Deductions (GH₵)</Label>
                                      <Input type="number" step="0.01" value={deductions} onChange={(e) => setDeductions(e.target.value)} className="h-9 text-xs bg-background/60 border-border/60 rounded-xl" />
                                      <p className="text-[10px] text-muted-foreground/70 font-medium">Specify deductions for absenteeism, penalties, or tax.</p>
                                    </div>
                                    <div className="space-y-1.5">
                                      <Label className="text-xs font-semibold text-muted-foreground">Notes</Label>
                                      <Textarea value={payNotes} onChange={(e) => setPayNotes(e.target.value)} placeholder="Write internal payment notes..." className="text-xs bg-background/60 border-border/60 rounded-xl" />
                                    </div>
                                    <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 text-[11px] rounded-xl flex gap-2 font-medium">
                                      <AlertCircle className="h-4.5 w-4.5 shrink-0 text-amber-500" />
                                      <span>This dispatches funds directly from the salary wallet. Confirm details are correct before sending.</span>
                                    </div>
                                    <DialogFooter className="pt-2 gap-2 sm:gap-0">
                                      <Button variant="outline" size="sm" className="rounded-xl border-border/60" onClick={() => setIsPayOpen(false)}>Cancel</Button>
                                      <Button onClick={handlePaySalary} disabled={paySalaryMutation.isPending} className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-bold">
                                        {paySalaryMutation.isPending ? "Disbursing..." : "Confirm & Disburse"}
                                      </Button>
                                    </DialogFooter>
                                  </div>
                                </DialogContent>
                              </Dialog>
                            )}
                            {p.status === "paid" && (
                              <div className="flex items-center justify-end text-emerald-600 dark:text-emerald-400 text-xs font-bold gap-1.5">
                                <CheckCircle2 className="h-4 w-4" /> Disbursed
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Calendar tab content */}
        <TabsContent value="calendar" className="space-y-4 outline-none">
          <Card className="border border-border/40 bg-card/65 backdrop-blur-md shadow-sm rounded-2xl overflow-hidden">
            <CardHeader className="pb-3 px-5 pt-5">
              <CardTitle className="text-sm font-bold text-foreground">Salary Payment Calendar</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">Visual reminder of when payments are due (30 days from last payment).</CardDescription>
            </CardHeader>
            <CardContent className="px-5 pb-5 pt-2">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {isLoadingCalendar ? (
                  <div className="col-span-full py-8 text-center text-muted-foreground text-xs font-semibold">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-600/60" />
                    Loading upcoming schedule...
                  </div>
                ) : calendar?.length === 0 ? (
                  <p className="text-muted-foreground text-xs py-8 font-medium">No upcoming payment schedules.</p>
                ) : calendar?.map((entry, i) => {
                  let scheduleClass = "border border-border/60 bg-card/75 backdrop-blur-md shadow-xs rounded-2xl p-5 hover:shadow-md transition-all duration-300";
                  let statusBadge = null;

                  if (entry.status === 'overdue') {
                    scheduleClass = "border border-rose-500/30 bg-rose-500/[0.04] dark:bg-rose-500/[0.02] shadow-xs rounded-2xl p-5 hover:shadow-md hover:border-rose-500/40 transition-all duration-300";
                    statusBadge = (
                      <Badge variant="destructive" className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-400">
                        Overdue
                      </Badge>
                    );
                  } else if (entry.status === 'due') {
                    scheduleClass = "border border-amber-500/30 bg-amber-500/[0.04] dark:bg-amber-500/[0.02] shadow-xs rounded-2xl p-5 hover:shadow-md hover:border-amber-500/40 transition-all duration-300";
                    statusBadge = (
                      <Badge className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                        Due Today
                      </Badge>
                    );
                  } else {
                    statusBadge = (
                      <Badge variant="secondary" className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-lg border border-border bg-muted/40 text-muted-foreground">
                        Upcoming
                      </Badge>
                    );
                  }

                  return (
                    <div key={i} className={scheduleClass}>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2 text-xs font-bold text-foreground">
                          <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                          {format(new Date(entry.date), 'MMMM do, yyyy')}
                        </div>
                        {statusBadge}
                      </div>
                      <div className="space-y-1">
                        <div className="text-xl font-bold font-mono tracking-tight text-foreground">
                          <span className="text-muted-foreground/60 mr-0.5 text-xs font-normal">GH₵</span>
                          {entry.totalAmount}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">{entry.staffCount} Staff Members</div>
                      </div>
                      <div className="mt-4 pt-4 border-t border-border/40 text-[10px] text-muted-foreground/75 font-medium leading-relaxed">
                        <span className="font-bold text-muted-foreground uppercase text-[9px] tracking-wider block mb-1">Includes</span>
                        {(entry.staffNames || []).join(', ')}{entry.staffCount > (entry.staffNames || []).length ? '...' : ''}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Wallet History tab content */}
        <TabsContent value="wallet" className="space-y-4 outline-none">
          <Card className="border border-border/40 bg-card/65 backdrop-blur-md shadow-sm rounded-2xl overflow-hidden">
            <CardHeader className="pb-3 px-5 pt-5 border-b border-border/40">
              <CardTitle className="text-sm font-bold text-foreground">Wallet Audit Trail</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">Track all funds loaded into the salary wallet and disbursed to staff.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow className="border-b border-border/40">
                      <TableHead className="text-xs font-bold text-muted-foreground pl-5">Date</TableHead>
                      <TableHead className="text-xs font-bold text-muted-foreground">Type</TableHead>
                      <TableHead className="text-xs font-bold text-muted-foreground">Performed By</TableHead>
                      <TableHead className="text-right text-xs font-bold text-muted-foreground">Amount</TableHead>
                      <TableHead className="text-right text-xs font-bold text-muted-foreground">Balance After</TableHead>
                      <TableHead className="text-xs font-bold text-muted-foreground pr-5">Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingTx ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-12 text-muted-foreground text-xs font-medium">
                          <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-600/60" />
                          Loading audits...
                        </TableCell>
                      </TableRow>
                    ) : transactions?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-12 text-muted-foreground text-xs font-medium">
                          No transactions yet.
                        </TableCell>
                      </TableRow>
                    ) : transactions?.map((tx) => {
                      const isFund = tx.type === 'fund';
                      const rowClass = isFund
                        ? "hover:bg-muted/10 border-b border-border/40 border-l-2 border-l-emerald-500/50 transition-colors"
                        : "hover:bg-muted/10 border-b border-border/40 border-l-2 border-l-slate-500/50 transition-colors";

                      return (
                        <TableRow key={tx.id} className={rowClass}>
                          <TableCell className="text-xs font-medium text-foreground/80 pl-5 py-3.5">
                            {format(new Date(tx.createdAt), 'MMM dd, yyyy HH:mm')}
                          </TableCell>
                          <TableCell className="py-3.5">
                            <Badge variant={isFund ? 'default' : 'secondary'} className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-lg border shadow-xs ${
                              isFund 
                                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400' 
                                : 'bg-slate-500/10 border-slate-500/20 text-slate-700 dark:text-slate-400'
                            }`}>
                              {isFund ? 'Wallet Funded' : 'Salary Paid'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-foreground/80 font-bold py-3.5">
                            {tx.performedByName}
                          </TableCell>
                          <TableCell className={`text-right font-mono text-xs font-bold py-3.5 ${
                            isFund ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'
                          }`}>
                            {isFund ? '+' : '-'}GHS {tx.amount}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs font-medium text-muted-foreground py-3.5">
                            GHS {tx.balanceAfter}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground/80 max-w-[200px] truncate pr-5 py-3.5 font-medium">
                            {tx.notes}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
