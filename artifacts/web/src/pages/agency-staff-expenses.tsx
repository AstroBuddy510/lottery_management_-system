import { useListAgencyStaffExpenses } from "@workspace/api-client-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function AgencyStaffExpenses() {
  const { data: expenses, isLoading, isError } = useListAgencyStaffExpenses();

  const totalSalaries = expenses?.reduce((sum, item) => sum + parseFloat(item.totalSalary), 0) ?? 0;
  const totalAllowances = expenses?.reduce((sum, item) => sum + parseFloat(item.totalAllowances), 0) ?? 0;
  const totalBonuses = expenses?.reduce((sum, item) => sum + parseFloat(item.totalBonuses), 0) ?? 0;
  const totalAllExpenses = totalSalaries + totalAllowances + totalBonuses;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Agency Staff Expenses</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          General financial overview of operational spending on staff at all agency offices.
        </p>
      </div>

      {/* Summary Stats Grid */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase">Total Salaries</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">GHS {totalSalaries.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase">Total Allowances</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-blue-600">GHS {totalAllowances.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase">Total Bonuses</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-emerald-600">GHS {totalBonuses.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold text-primary uppercase">Total Expenses</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-primary">GHS {totalAllExpenses.toFixed(2)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Expense Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Breakdown by Agent</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Agency</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead className="text-right">Salaries</TableHead>
                <TableHead className="text-right">Allowances</TableHead>
                <TableHead className="text-right">Bonuses</TableHead>
                <TableHead className="text-right font-semibold">Total Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                    Loading expenses...
                  </TableCell>
                </TableRow>
              ) : isError ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-destructive text-sm font-semibold">
                    Failed to load operational expenses.
                  </TableCell>
                </TableRow>
              ) : expenses?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                    No agency expenses found.
                  </TableCell>
                </TableRow>
              ) : (
                expenses?.map((item) => (
                  <TableRow key={item.agentId}>
                    <TableCell className="font-mono text-sm font-semibold">{item.fullCode}</TableCell>
                    <TableCell className="font-medium text-sm">{item.agencyName ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{item.agentName}</TableCell>
                    <TableCell className="text-right font-mono text-sm">GHS {parseFloat(item.totalSalary).toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-blue-600">GHS {parseFloat(item.totalAllowances).toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-emerald-600">GHS {parseFloat(item.totalBonuses).toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono text-sm font-bold text-primary">
                      GHS {parseFloat(item.totalExpenses).toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
