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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Calendar as CalendarIcon, Users, Wallet, CreditCard, PiggyBank, RefreshCw, AlertCircle, CheckCircle2 } from "lucide-react";

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
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Staffs & Employees</h2>
          <p className="text-muted-foreground">Manage company staff payroll, agency staff remunerations, and salary wallet.</p>
        </div>
        <Button onClick={handleGeneratePeriod} disabled={generatePeriodMutation.isPending} className="bg-indigo-600 hover:bg-indigo-700 text-white">
          <RefreshCw className={`mr-2 h-4 w-4 ${generatePeriodMutation.isPending ? "animate-spin" : ""}`} />
          Generate This Month's Payroll
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Staff</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(summary?.totalCompanyStaff || 0) + (summary?.totalAgencyStaff || 0)}</div>
            <p className="text-xs text-muted-foreground">
              {summary?.totalCompanyStaff || 0} Company, {summary?.totalAgencyStaff || 0} Agency
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Monthly Payroll Due</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">GHS {summary?.monthlyPayrollDue || "0.00"}</div>
            <p className="text-xs text-muted-foreground">
              {summary?.payrollCompletionPercent || 0}% completed
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Accrued / Unpaid</CardTitle>
            <AlertCircle className="h-4 w-4 text-rose-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-rose-600">GHS {summary?.accruedUnpaid || "0.00"}</div>
            <p className="text-xs text-muted-foreground">Needs payment soon</p>
          </CardContent>
        </Card>
        <Card className="border-green-200 bg-green-50 dark:bg-green-950/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-green-800 dark:text-green-300">Dedicated Salary Wallet</CardTitle>
            <Wallet className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-700 dark:text-green-400">GHS {summary?.walletBalance || "0.00"}</div>
            {isAdminOrDirector && (
              <Dialog open={isFundOpen} onOpenChange={setIsFundOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="mt-2 w-full text-xs h-7 border-green-300 text-green-700 hover:bg-green-100">
                    <PiggyBank className="mr-1 h-3 w-3" /> Fund Wallet
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Fund Salary Wallet</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Amount (GHS)</Label>
                      <Input type="number" step="0.01" value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Notes</Label>
                      <Textarea value={fundNotes} onChange={(e) => setFundNotes(e.target.value)} placeholder="Reason for funding..." />
                    </div>
                    <Button onClick={handleFundWallet} disabled={fundWalletMutation.isPending} className="w-full">
                      Submit Funding
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="payments" className="space-y-4">
        <TabsList>
          <TabsTrigger value="payments">Salary Payments</TabsTrigger>
          <TabsTrigger value="calendar">Payment Calendar</TabsTrigger>
          <TabsTrigger value="wallet">Wallet History</TabsTrigger>
        </TabsList>

        <TabsContent value="payments" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Disbursements & Trackings</CardTitle>
              <CardDescription>Manage all accrued and paid salaries for both Company and Agency staff.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Staff Name</TableHead>
                    <TableHead>Type/Position</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Net Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingPayments ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-4">Loading...</TableCell></TableRow>
                  ) : payments?.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-4 text-muted-foreground">No payment records found.</TableCell></TableRow>
                  ) : payments?.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">
                        {p.staffName}
                        {p.agencyName && <div className="text-xs text-muted-foreground">Agency: {p.agencyName}</div>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{p.staffType === 'company' ? 'Internal' : 'Agency'}</Badge>
                        <div className="text-xs text-muted-foreground mt-1">{p.staffPosition}</div>
                      </TableCell>
                      <TableCell>{format(new Date(p.periodYear, p.periodMonth - 1, 1), 'MMMM yyyy')}</TableCell>
                      <TableCell className="text-right font-bold">GHS {p.netAmount}</TableCell>
                      <TableCell>
                        {p.status === "paid" ? (
                          <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Paid</Badge>
                        ) : p.status === "pending" ? (
                          <Badge variant="destructive">Unpaid / Accrued</Badge>
                        ) : (
                          <Badge variant="secondary">Partial</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
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
                              <Button size="sm" variant="default" className="bg-indigo-600 hover:bg-indigo-700 text-white">Disburse Salary</Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Disburse Salary for {p.staffName}</DialogTitle>
                              </DialogHeader>
                              <div className="space-y-4 py-4">
                                <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg text-sm space-y-1">
                                  <div className="flex justify-between"><span>Base Salary:</span> <span>GHS {p.baseSalary}</span></div>
                                  <div className="flex justify-between"><span>Allowances:</span> <span>GHS {p.allowances}</span></div>
                                  <div className="flex justify-between"><span>Bonuses:</span> <span>GHS {p.bonuses}</span></div>
                                  <div className="border-t my-2"></div>
                                  <div className="flex justify-between font-bold text-lg text-indigo-700 dark:text-indigo-400">
                                    <span>Gross Payable:</span> 
                                    <span>GHS {(parseFloat(p.baseSalary) + parseFloat(p.allowances) + parseFloat(p.bonuses)).toFixed(2)}</span>
                                  </div>
                                </div>
                                
                                <div className="space-y-2">
                                  <Label>Deductions (GHS)</Label>
                                  <Input type="number" step="0.01" value={deductions} onChange={(e) => setDeductions(e.target.value)} />
                                  <p className="text-xs text-muted-foreground">Enter any deductions for absenteeism or penalties.</p>
                                </div>
                                <div className="space-y-2">
                                  <Label>Notes</Label>
                                  <Textarea value={payNotes} onChange={(e) => setPayNotes(e.target.value)} placeholder="Payment remarks..." />
                                </div>
                                <div className="p-3 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 text-sm rounded-lg flex gap-2">
                                  <AlertCircle className="h-5 w-5 shrink-0" />
                                  <span>This will deduct the final net amount from the Dedicated Salary Wallet. Please ensure sufficient funds.</span>
                                </div>
                                <Button onClick={handlePaySalary} disabled={paySalaryMutation.isPending} className="w-full bg-indigo-600 hover:bg-indigo-700">
                                  Confirm & Disburse Payment
                                </Button>
                              </div>
                            </DialogContent>
                          </Dialog>
                        )}
                        {p.status === "paid" && (
                          <div className="flex items-center justify-end text-green-600 text-sm font-medium">
                            <CheckCircle2 className="mr-1 h-4 w-4" /> Disbursed
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calendar" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Salary Payment Calendar</CardTitle>
              <CardDescription>Visual reminder of when payments are due (30 days from last payment).</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {isLoadingCalendar ? (
                  <p>Loading...</p>
                ) : calendar?.length === 0 ? (
                  <p className="text-muted-foreground">No upcoming payment schedules.</p>
                ) : calendar?.map((entry, i) => (
                  <div key={i} className={`p-4 rounded-xl border ${entry.status === 'overdue' ? 'border-rose-300 bg-rose-50 dark:bg-rose-950/20' : entry.status === 'due' ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/20' : 'border-slate-200 bg-white dark:bg-slate-900'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <CalendarIcon className="h-4 w-4" />
                        {format(new Date(entry.date), 'MMMM do, yyyy')}
                      </div>
                      {entry.status === 'overdue' && <Badge variant="destructive">Overdue</Badge>}
                      {entry.status === 'due' && <Badge className="bg-amber-500 text-white hover:bg-amber-600">Due Today</Badge>}
                      {entry.status === 'upcoming' && <Badge variant="secondary">Upcoming</Badge>}
                    </div>
                    <div className="space-y-1">
                      <div className="text-2xl font-bold">GHS {entry.totalAmount}</div>
                      <div className="text-sm text-muted-foreground">{entry.staffCount} Staff Members</div>
                    </div>
                    <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 text-xs text-muted-foreground">
                      Includes: {(entry.staffNames || []).join(', ')}{entry.staffCount > (entry.staffNames || []).length ? '...' : ''}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="wallet" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Wallet Audit Trail</CardTitle>
              <CardDescription>Track all funds loaded into the salary wallet and disbursed to staff.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Performed By</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Balance After</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingTx ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-4">Loading...</TableCell></TableRow>
                  ) : transactions?.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-4 text-muted-foreground">No transactions yet.</TableCell></TableRow>
                  ) : transactions?.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell>{format(new Date(tx.createdAt), 'MMM dd, yyyy HH:mm')}</TableCell>
                      <TableCell>
                        <Badge variant={tx.type === 'fund' ? 'default' : 'secondary'} className={tx.type === 'fund' ? 'bg-green-500 hover:bg-green-600' : ''}>
                          {tx.type === 'fund' ? 'Wallet Funded' : 'Salary Disbursed'}
                        </Badge>
                      </TableCell>
                      <TableCell>{tx.performedByName}</TableCell>
                      <TableCell className={`text-right font-bold ${tx.type === 'fund' ? 'text-green-600' : 'text-slate-600 dark:text-slate-300'}`}>
                        {tx.type === 'fund' ? '+' : '-'}GHS {tx.amount}
                      </TableCell>
                      <TableCell className="text-right">GHS {tx.balanceAfter}</TableCell>
                      <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]">{tx.notes}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
