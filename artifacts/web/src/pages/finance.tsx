import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { BadgePercent, BookOpen, Building2, CalendarCheck, FileStack, History, Landmark, Lock, Package, Percent, Scale, ShieldCheck, Store, Trophy } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import { PositionTab } from "@/components/finance/position-tab";
import { CashBookTab } from "@/components/finance/cash-book-tab";
import { AccountsTab } from "@/components/finance/accounts-tab";
import { FundsTab } from "@/components/finance/funds-tab";
import { FeesTab } from "@/components/finance/fees-tab";
import { AuditTab } from "@/components/finance/audit-tab";
import { WinningsTab } from "@/components/finance/winnings-tab";
import { AgenciesTab } from "@/components/finance/agencies-tab";
import { CommissionsTab } from "@/components/finance/commissions-tab";
import { InventoryTab } from "@/components/finance/inventory-tab";
import { PayrollTab } from "@/components/finance/payroll-tab";
import { StatementsTab } from "@/components/finance/statements-tab";
import { ReconciliationTab } from "@/components/finance/reconciliation-tab";

/**
 * Finance & Statements.
 *
 * One place for the company's money: where it is, every receipt and payment,
 * what is set aside, what Paystack charged, and who did what. Directors and
 * administrators see all of it; a cashier sees the cash book and records
 * cash counts.
 */

type TabDef = { value: string; label: string; icon: LucideIcon; roles: string[]; render: (role?: string) => React.ReactNode };

const MGMT = ["director", "administrator"];

const TABS: TabDef[] = [
  { value: "position", label: "Position", icon: Scale, roles: MGMT, render: () => <PositionTab /> },
  { value: "statements", label: "Statements", icon: FileStack, roles: MGMT, render: () => <StatementsTab /> },
  { value: "reconciliation", label: "Reconciliation", icon: ShieldCheck, roles: MGMT, render: () => <ReconciliationTab /> },
  { value: "cash-book", label: "Cash Book", icon: BookOpen, roles: [...MGMT, "cashier"], render: (r) => <CashBookTab role={r} /> },
  { value: "accounts", label: "Accounts", icon: Building2, roles: [...MGMT, "cashier"], render: (r) => <AccountsTab role={r} /> },
  { value: "funds", label: "Funds", icon: Lock, roles: MGMT, render: (r) => <FundsTab role={r} /> },
  { value: "winnings", label: "Winnings & Reserve", icon: Trophy, roles: [...MGMT, "cashier"], render: (r) => <WinningsTab role={r} /> },
  { value: "agencies", label: "Agencies", icon: Store, roles: MGMT, render: () => <AgenciesTab /> },
  { value: "commissions", label: "Commissions", icon: BadgePercent, roles: [...MGMT, "cashier"], render: (r) => <CommissionsTab role={r} /> },
  { value: "payroll", label: "Payroll", icon: CalendarCheck, roles: [...MGMT, "cashier"], render: (r) => <PayrollTab role={r} /> },
  { value: "inventory", label: "Inventory", icon: Package, roles: [...MGMT, "cashier"], render: (r) => <InventoryTab role={r} /> },
  { value: "fees", label: "Paystack Fees", icon: Percent, roles: MGMT, render: () => <FeesTab /> },
  { value: "audit", label: "Audit Trail", icon: History, roles: MGMT, render: () => <AuditTab /> },
];

const TAB_CLASS =
  "rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary px-3 py-3 text-xs font-bold gap-1.5 transition-all hover:text-foreground/80 data-[state=active]:bg-transparent shadow-none bg-transparent";

export default function FinancePage() {
  const { user } = useAuth();
  const role = user?.role;
  const tabs = TABS.filter((t) => role && t.roles.includes(role));
  // A link can open a particular tab: /finance?tab=agencies (the alerts bell does).
  const asked = new URLSearchParams(useSearch()).get("tab");
  const [tab, setTab] = useState(tabs.some((t) => t.value === asked) ? asked! : tabs[0]?.value ?? "cash-book");
  useEffect(() => {
    if (asked && tabs.some((t) => t.value === asked)) setTab(asked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);

  return (
    <div className="p-4 sm:p-6 space-y-6 min-w-0">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border border-border/80 bg-card/60 backdrop-blur-md p-5 sm:p-6 rounded-3xl shadow-sm">
        <div className="flex items-center gap-4 min-w-0">
          <div className="p-3 bg-primary/10 text-primary rounded-2xl shadow-inner border border-primary/10 shrink-0">
            <Landmark className="w-7 h-7" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-black tracking-tight text-foreground">Finance &amp; Statements</h1>
            <p className="text-xs text-muted-foreground mt-1 font-medium">
              The company's money, generated from every record that moved it - with the checks that prove the figures agree.
            </p>
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-5">
        <TabsList className="w-full justify-start border-b border-border/60 rounded-none h-auto p-0 bg-transparent gap-1 overflow-x-auto overflow-y-hidden flex-nowrap thin-scroll [&>button]:shrink-0">
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className={TAB_CLASS}>
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((t) => (
          <TabsContent key={t.value} value={t.value} className="mt-0">{tab === t.value && t.render(role)}</TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
