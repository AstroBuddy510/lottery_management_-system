import { useState, useMemo } from "react";
import { useListAgencyStaffExpenses } from "@workspace/api-client-react";
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
import { Input } from "@/components/ui/input";
import {
  Banknote,
  Coins,
  Award,
  Activity,
  Search,
  Building2,
  Filter
} from "lucide-react";

function fmtGHS(v: number, bold = true) {
  return (
    <span className="font-mono whitespace-nowrap">
      <span className="text-muted-foreground/70 font-normal mr-0.5">GH₵</span>
      <span className={bold ? "font-bold" : "font-normal"}>{v.toFixed(2)}</span>
    </span>
  );
}

export function AgencyStaffExpenses() {
  const { data: expenses, isLoading, isError } = useListAgencyStaffExpenses();
  const [search, setSearch] = useState("");

  const totalSalaries = useMemo(() => expenses?.reduce((sum, item) => sum + parseFloat(item.totalSalary), 0) ?? 0, [expenses]);
  const totalAllowances = useMemo(() => expenses?.reduce((sum, item) => sum + parseFloat(item.totalAllowances), 0) ?? 0, [expenses]);
  const totalBonuses = useMemo(() => expenses?.reduce((sum, item) => sum + parseFloat(item.totalBonuses), 0) ?? 0, [expenses]);
  const totalAllExpenses = totalSalaries + totalAllowances + totalBonuses;

  const maxExpense = useMemo(() => {
    const list = expenses || [];
    if (list.length === 0) return 1;
    return Math.max(...list.map(item => parseFloat(item.totalExpenses)), 1);
  }, [expenses]);

  const filteredExpenses = useMemo(() => {
    const list = expenses || [];
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(item =>
      item.fullCode.toLowerCase().includes(q) ||
      (item.agencyName && item.agencyName.toLowerCase().includes(q)) ||
      item.agentName.toLowerCase().includes(q)
    );
  }, [expenses, search]);

  const kpiCards = [
    {
      title: "Total Salaries",
      val: totalSalaries,
      icon: <Banknote className="w-5 h-5 text-amber-600 dark:text-amber-400" />,
      bg: "bg-amber-50/20 dark:bg-amber-950/10 border-amber-100/50 dark:border-amber-900/30",
      color: "text-amber-700 dark:text-amber-400",
      description: "Base monthly payroll"
    },
    {
      title: "Total Allowances",
      val: totalAllowances,
      icon: <Coins className="w-5 h-5 text-blue-600 dark:text-blue-400" />,
      bg: "bg-blue-50/20 dark:bg-blue-950/10 border-blue-100/50 dark:border-blue-900/30",
      color: "text-blue-700 dark:text-blue-400",
      description: "Travel & stipends"
    },
    {
      title: "Total Bonuses",
      val: totalBonuses,
      icon: <Award className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />,
      bg: "bg-emerald-50/20 dark:bg-emerald-950/10 border-emerald-100/50 dark:border-emerald-900/30",
      color: "text-emerald-700 dark:text-emerald-400",
      description: "Performance incentives"
    },
    {
      title: "Total Expenses",
      val: totalAllExpenses,
      icon: <Activity className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />,
      bg: "bg-indigo-50/20 dark:bg-indigo-950/10 border-indigo-100/50 dark:border-indigo-900/30",
      color: "text-indigo-700 dark:text-indigo-400",
      description: "Combined operational outlays"
    }
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Agency Staff Expenses</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            General financial overview of operational spending on staff at all agency offices.
          </p>
        </div>
        <Badge variant="outline" className="border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 font-mono px-3 py-1 font-bold text-xs uppercase tracking-wide">
          Payroll Ledger
        </Badge>
      </div>

      {/* Summary Stats Grid */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {kpiCards.map(c => (
          <Card key={c.title} className={`border ${c.bg} shadow-sm overflow-hidden relative hover:-translate-y-1 hover:shadow-md transition-all duration-300 rounded-xl`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1.5 pt-3.5 px-4">
              <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{c.title}</CardTitle>
              <span className="p-1 rounded-lg bg-background/60 border border-border/20 shadow-xs">{c.icon}</span>
            </CardHeader>
            <CardContent className="px-4 pb-3.5">
              <div className={`text-xl font-bold ${c.color}`}>{fmtGHS(c.val)}</div>
              <p className="text-[9.5px] text-muted-foreground mt-0.5 font-medium">{c.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Expense Table card */}
      <Card className="border border-border/40 bg-card/65 backdrop-blur-sm shadow-sm rounded-xl">
        <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-semibold">Breakdown by Agent</CardTitle>
            <CardDescription className="text-xs">Individual breakdown of salaries, allowances, and bonuses across active agents.</CardDescription>
          </div>
          <div className="relative max-w-xs w-full sm:w-64">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground/60" />
            <Input
              placeholder="Search by code, agency, agent..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-9 text-xs bg-background/50 border-border/50 rounded-xl"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="text-xs font-semibold">Code</TableHead>
                  <TableHead className="text-xs font-semibold">Agency</TableHead>
                  <TableHead className="text-xs font-semibold">Agent</TableHead>
                  <TableHead className="text-right text-xs font-semibold">Salaries</TableHead>
                  <TableHead className="text-right text-xs font-semibold">Allowances</TableHead>
                  <TableHead className="text-right text-xs font-semibold">Bonuses</TableHead>
                  <TableHead className="text-right text-xs font-semibold">Relative Weight</TableHead>
                  <TableHead className="text-right text-xs font-bold text-foreground">Total Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-muted-foreground text-sm">
                      <Activity className="w-5 h-5 animate-spin mx-auto mb-2 text-muted-foreground/50" />
                      Loading operational ledger...
                    </TableCell>
                  </TableRow>
                ) : isError ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-destructive text-sm font-semibold">
                      Failed to load operational expenses.
                    </TableCell>
                  </TableRow>
                ) : filteredExpenses.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-muted-foreground text-sm">
                      No agency expenses matched your search.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredExpenses.map((item) => {
                    const relativePercent = maxExpense > 0 ? (parseFloat(item.totalExpenses) / maxExpense) * 100 : 0;
                    return (
                      <TableRow key={item.agentId} className="hover:bg-muted/10 border-b border-border/40 transition-colors">
                        <TableCell className="font-mono text-xs font-semibold">
                          <span className="bg-muted/50 px-1.5 py-0.5 rounded border border-border/20">
                            {item.fullCode}
                          </span>
                        </TableCell>
                        <TableCell className="font-medium text-xs text-foreground flex items-center gap-1.5 py-3">
                          <Building2 className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
                          <span>{item.agencyName ?? "—"}</span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{item.agentName}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmtGHS(parseFloat(item.totalSalary), false)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-blue-600 dark:text-blue-400">{fmtGHS(parseFloat(item.totalAllowances), false)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-emerald-600 dark:text-emerald-400">{fmtGHS(parseFloat(item.totalBonuses), false)}</TableCell>
                        <TableCell className="text-right py-3.5">
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-[10px] text-muted-foreground/75 font-mono">{relativePercent.toFixed(0)}%</span>
                            <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden shrink-0">
                              <div
                                className="h-full bg-gradient-to-r from-indigo-500 to-violet-600 rounded-full"
                                style={{ width: `${relativePercent}%` }}
                              />
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-indigo-50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-400 border border-indigo-100/50">
                            {fmtGHS(parseFloat(item.totalExpenses), true)}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
