import { Link, useLocation } from "wouter";
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
  { label: "Users", path: "/users", roles: ["director", "administrator"] },
  { label: "Agents", path: "/agents", roles: ["director", "administrator"] },
  { label: "Settings", path: "/settings", roles: ["director", "administrator"] },
  { label: "My Writers", path: "/my-writers", roles: ["agent"] },
  { label: "Gross & Wins", path: "/gross-wins", roles: ["director", "administrator"] },
  { label: "Gross Entries", path: "/entries/gross", roles: ["gross_entry", "agent"] },
  { label: "Wins Entries", path: "/entries/wins", roles: ["wins_entry", "agent"] },
  { label: "Sales Log", path: "/sales", roles: ["agent", "administrator"] },
  { label: "Payments", path: "/payments", roles: ["cashier", "administrator"] },
  { label: "Calculations", path: "/calculations", roles: ["director", "administrator"] },
  { label: "Reports", path: "/reports", roles: ["director", "administrator", "cashier"] },
  { label: "Reserve Fund", path: "/reserve", roles: ["director", "administrator"] },
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
  if (user?.role === "agent") return <AgentLayout>{children}</AgentLayout>;
  const { data: unread } = useGetUnreadCount({
    query: { queryKey: getGetUnreadCountQueryKey(), refetchInterval: 30000 }
  });
  const unreadCount = unread?.count ?? 0;

  const visibleItems = NAV_ITEMS.filter(item =>
    user?.role && item.roles.includes(user.role)
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="w-56 flex-shrink-0 flex flex-col bg-sidebar border-r border-sidebar-border">
        <div className="px-4 py-4 border-b border-sidebar-border">
          <div className="text-lg font-bold text-sidebar-primary tracking-tight">VS2000</div>
          <div className="text-xs text-sidebar-foreground/60 mt-0.5">Smart Office</div>
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
      </aside>

      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
