import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, Bell } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useGetUnreadCount, getGetUnreadCountQueryKey } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AgentLayout } from "@/components/agent-layout";

interface NavItem {
  label: string;
  path: string;
  roles: string[];
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", path: "/dashboard", roles: ["director", "administrator", "cashier", "gross_entry", "wins_entry", "agent"] },
  { label: "Agency Overview", path: "/agencies", roles: ["director", "administrator"] },
  { label: "Users & Agents", path: "/users", roles: ["administrator", "director", "cashier"] },
  { label: "Games Management", path: "/games", roles: ["administrator", "director"] },
  { label: "Risk Management", path: "/risk-management", roles: ["administrator", "director"] },
  { label: "Ticket Lookup", path: "/ticket-lookup", roles: ["administrator", "director", "cashier"] },
  { label: "System Settings", path: "/settings", roles: ["administrator", "director"] },
  { label: "My Writers", path: "/my-writers", roles: ["agent"] },
  { label: "Gross & Wins", path: "/gross-wins", roles: ["director", "administrator"] },
  { label: "Gross Entries", path: "/entries/gross", roles: ["gross_entry", "agent"] },
  { label: "Wins Entries", path: "/entries/wins", roles: ["wins_entry", "agent"] },
  // { label: "Sales Log", path: "/sales", roles: ["agent", "administrator"] },
  { label: "Payments", path: "/payments", roles: ["cashier", "administrator", "director"] },
  { label: "POS Wins Payment", path: "/pos-wins-payment", roles: ["cashier"] },
  { label: "Master Wallet", path: "/master-wallet", roles: ["director", "administrator"] },
  { label: "Staffs & Employees", path: "/staffs-employees", roles: ["cashier", "administrator", "director"] },
  { label: "Agency Staff Expenses", path: "/agency-staff-expenses", roles: ["cashier", "administrator", "director"] },
  { label: "Company Expenses", path: "/company-expenses", roles: ["cashier", "administrator", "director"] },
  { label: "Reserve Receipts", path: "/reserve-receipts", roles: ["cashier", "administrator"] },
  { label: "Run Draws", path: "/calculations", roles: ["director", "administrator"] },
  { label: "Reports", path: "/reports", roles: ["director", "administrator", "cashier"] },
  { label: "Wins & Debt Overview", path: "/wins-debt", roles: ["director", "administrator"] },
  { label: "Reserve Fund", path: "/reserve", roles: ["director", "administrator"] },
  { label: "Inventory", path: "/inventory", roles: ["cashier", "administrator", "director"] },
  { label: "Notifications", path: "/notifications", roles: ["director", "administrator", "cashier", "gross_entry", "wins_entry", "agent"] },
];

const ROLE_LABELS: Record<string, string> = {
  director: "Director",
  administrator: "Administrator",
  cashier: "Cashier",
  gross_entry: "Gross Entry",
  wins_entry: "Wins Entry",
  agent: "Agent",
};

function NavLink({ item }: { item: NavItem }) {
  const [location] = useLocation();
  const active = location === item.path || (item.path !== "/dashboard" && location.startsWith(item.path));

  return (
    <Link href={item.path}>
      <span className={cn(
        "block px-3 py-2 rounded text-sm font-medium transition-colors cursor-pointer",
        active
          ? "bg-primary text-primary-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      )}>
        {item.label}
      </span>
    </Link>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { data: unread } = useGetUnreadCount({
    query: { queryKey: getGetUnreadCountQueryKey(), refetchInterval: 30000 }
  });
  const unreadCount = unread?.count ?? 0;

  const visibleItems = NAV_ITEMS.filter(item =>
    user?.role && item.roles.includes(user.role)
  );

  const [menuOpen, setMenuOpen] = useState(false);
  const [location] = useLocation();
  // Following a link closes the drawer.
  useEffect(() => { setMenuOpen(false); }, [location]);

  // After every hook, so the hook order is the same for every role.
  if (user?.role === "agent") return <AgentLayout>{children}</AgentLayout>;

  const sidebar = (
    <>
      <div className="px-4 py-4 border-b border-sidebar-border flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg overflow-hidden bg-white flex items-center justify-center p-1.5 shadow-sm border border-sidebar-border/50 flex-shrink-0">
            <img src="/company-logo-v3.png" alt="VS2000 Logo" className="w-full h-full object-contain" />
          </div>
          <div className="min-w-0">
            <div className="text-base font-bold text-sidebar-primary tracking-tight leading-none">VS2000</div>
            <div className="text-[10px] text-sidebar-foreground/60 mt-1 truncate">Smart Office</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
          {visibleItems.map(item => {
            if (item.path === "/notifications") {
              return (
                <div key={item.path} className="relative">
                  <NavLink item={item} />
                  {unreadCount > 0 && (
                    <Badge className="absolute top-1.5 right-2 h-5 min-w-5 flex items-center justify-center text-xs px-1" variant="destructive">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </Badge>
                  )}
                </div>
              );
            }
            return <NavLink key={item.path} item={item} />;
          })}
        </nav>

        <div className="px-3 py-3 border-t border-sidebar-border">
          <div className="mb-2 px-1">
            <div className="text-xs font-semibold text-sidebar-foreground truncate">{user?.fullName}</div>
            <div className="text-xs text-sidebar-foreground/60 truncate">{ROLE_LABELS[user?.role ?? ""] ?? user?.role}</div>
          </div>
          <Button
            size="sm"
            className="w-full text-xs h-8 bg-accent hover:bg-accent/90 text-accent-foreground font-semibold"
            onClick={logout}
          >
            Sign Out
          </Button>
        </div>
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop: the sidebar is always there. */}
      <aside className="hidden lg:flex w-56 flex-shrink-0 flex-col bg-sidebar border-r border-sidebar-border">
        {sidebar}
      </aside>

      {/* Phones and tablets: the same sidebar as a drawer, so the page gets the
          whole width instead of what is left beside a 224px menu. */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMenuOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 max-w-[85vw] flex flex-col bg-sidebar border-r border-sidebar-border shadow-2xl">
            <button type="button" aria-label="Close menu" onClick={() => setMenuOpen(false)}
              className="absolute right-2 top-3 h-8 w-8 inline-flex items-center justify-center rounded-md text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent">
              <X className="h-4 w-4" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden flex items-center gap-3 px-3 h-14 border-b bg-sidebar text-sidebar-foreground shrink-0">
          <button type="button" aria-label="Open menu" onClick={() => setMenuOpen(true)}
            className="h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-sidebar-accent">
            <Menu className="h-5 w-5" />
          </button>
          <div className="w-8 h-8 rounded-md overflow-hidden bg-white flex items-center justify-center p-1 shrink-0">
            <img src="/company-logo-v3.png" alt="" className="w-full h-full object-contain" />
          </div>
          <div className="text-sm font-bold text-sidebar-primary tracking-tight">VS2000</div>
          <Link href="/notifications" className="ml-auto relative h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-sidebar-accent" aria-label="Notifications">
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold inline-flex items-center justify-center">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Link>
        </header>

        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
