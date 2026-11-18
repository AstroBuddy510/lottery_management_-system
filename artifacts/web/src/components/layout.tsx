import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Menu, X, Bell, ChevronDown, LayoutDashboard, UserRound, TrendingUp, Trophy, CreditCard, BadgeCheck,
  ReceiptText, Package, FileBarChart, Settings, Calculator, Building2, Scale, Users, ScanSearch, Receipt,
  Wallet, PiggyBank, ShieldAlert, Gamepad2, Contact, Landmark, Radio, HandCoins, type LucideIcon,
} from "lucide-react";
import { GlowBadge } from "@/components/glow-badge";
import { AlertsBell } from "@/components/alerts-bell";
import { useAlerts, useMarkGameSeenOn } from "@/lib/use-alerts";
import { useAuth } from "@/lib/auth";
import { useGetUnreadCount, getGetUnreadCountQueryKey } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AgentLayout } from "@/components/agent-layout";

interface NavItem {
  label: string;
  path: string;
  roles: string[];
  icon?: LucideIcon;
}

/** A heading in the menu that opens to show related pages. */
interface NavGroup {
  label: string;
  group: true;
  icon?: LucideIcon;
  children: NavItem[];
}

type NavEntry = NavItem | NavGroup;
const isGroup = (e: NavEntry): e is NavGroup => "group" in e;

const OFFICE = ["director", "administrator"];
const ALL = ["director", "administrator", "cashier", "gross_entry", "wins_entry", "agent"];

/**
 * Menu order, as the office asked for it. Items for a single role (the
 * cashier's POS Wins Payment and Reserve Receipts, the entry clerks' and
 * agents' entry pages) sit beside the items they belong with; roles only
 * ever see the items they may open.
 */
const NAV_ITEMS: NavEntry[] = [
  { label: "Dashboard", path: "/dashboard", roles: ALL, icon: LayoutDashboard },
  { label: "Live Ticker", path: "/live-ticker", roles: OFFICE, icon: Radio },
  { label: "My Writers", path: "/my-writers", roles: ["agent"], icon: UserRound },
  { label: "Gross Entries", path: "/entries/gross", roles: ["gross_entry", "agent"], icon: TrendingUp },
  { label: "Wins Entries", path: "/entries/wins", roles: ["wins_entry", "agent"], icon: Trophy },
  { label: "Payments", path: "/payments", roles: ["cashier", ...OFFICE], icon: CreditCard },
  { label: "POS Wins Payment", path: "/pos-wins-payment", roles: ["cashier"], icon: BadgeCheck },
  // Directors and administrators reach this as a tab of Reserve Fund.
  { label: "Reserve Receipts", path: "/reserve-receipts", roles: ["cashier"], icon: ReceiptText },
  { label: "Inventory", path: "/inventory", roles: ["cashier", ...OFFICE], icon: Package },
  { label: "Reports", path: "/reports", roles: [...OFFICE, "cashier"], icon: FileBarChart },
  { label: "Notifications", path: "/notifications", roles: ALL, icon: Bell },
  { label: "Run Draws", path: "/calculations", roles: OFFICE, icon: Calculator },
  { label: "System Settings", path: "/settings", roles: OFFICE, icon: Settings },
  { label: "Agency Overview", path: "/agencies", roles: OFFICE, icon: Building2 },
  { label: "Gross & Wins", path: "/gross-wins", roles: OFFICE, icon: Scale },
  { label: "Users & Agents", path: "/users", roles: [...OFFICE, "cashier"], icon: Users },
  { label: "Ticket Lookup", path: "/ticket-lookup", roles: [...OFFICE, "cashier"], icon: ScanSearch },
  { label: "Company Expenses", path: "/company-expenses", roles: ["cashier", ...OFFICE], icon: Receipt },
  { label: "Master Wallet", path: "/master-wallet", roles: OFFICE, icon: Wallet },
  { label: "Reserve Fund", path: "/reserve", roles: OFFICE, icon: PiggyBank },
  { label: "Risk Management", path: "/risk-management", roles: OFFICE, icon: ShieldAlert },
  { label: "Finance & Statements", path: "/finance", roles: [...OFFICE, "cashier"], icon: HandCoins },
  { label: "Games Management", path: "/games", roles: OFFICE, icon: Gamepad2 },
  {
    label: "Personnel Management",
    group: true,
    icon: Contact,
    children: [
      { label: "Internal Employees", path: "/staffs-employees", roles: ["cashier", ...OFFICE] },
      { label: "External Employees", path: "/agency-staff-expenses", roles: ["cashier", ...OFFICE] },
    ],
  },
  { label: "Wins & Debt Overview", path: "/wins-debt", roles: OFFICE, icon: Landmark },
];

const ROLE_LABELS: Record<string, string> = {
  director: "Director",
  administrator: "Administrator",
  cashier: "Cashier",
  gross_entry: "Gross Entry",
  wins_entry: "Wins Entry",
  agent: "Agent",
};

const isActivePath = (location: string, path: string) =>
  location === path || (path !== "/dashboard" && location.startsWith(path));

function NavLink({ item, nested }: { item: NavItem; nested?: boolean }) {
  const [location] = useLocation();
  const active = isActivePath(location, item.path);

  return (
    // A block, so the menu's row spacing applies to links and groups alike.
    <Link href={item.path} className="block">
      <span className={cn(
        "flex items-center gap-2.5 h-9 px-3 rounded-lg text-sm font-medium transition-colors cursor-pointer",
        nested && "h-8 text-[13px]",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      )}>
        {item.icon && <item.icon className={cn("h-4 w-4 shrink-0", active ? "opacity-100" : "opacity-70")} />}
        <span className="truncate">{item.label}</span>
      </span>
    </Link>
  );
}

function NavGroupLink({ group }: { group: NavGroup }) {
  const [location] = useLocation();
  const holdsActive = group.children.some(c => isActivePath(location, c.path));
  // Open whenever you are on one of its pages; otherwise remember the choice.
  const [open, setOpen] = useState(holdsActive);
  useEffect(() => { if (holdsActive) setOpen(true); }, [holdsActive]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className={cn(
          "w-full flex items-center gap-2.5 h-9 px-3 rounded-lg text-sm font-medium text-left transition-colors",
          holdsActive && !open
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )}
      >
        {group.icon && <group.icon className="h-4 w-4 shrink-0 opacity-70" />}
        <span className="truncate flex-1">{group.label}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 opacity-70 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="mt-0.5 mb-1 ml-[1.25rem] pl-2.5 border-l border-sidebar-border/70 space-y-0.5">
          {group.children.map(c => <NavLink key={c.path} item={c} nested />)}
        </div>
      )}
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { data: unread } = useGetUnreadCount({
    query: { queryKey: getGetUnreadCountQueryKey(), refetchInterval: 30000 }
  });
  const unreadCount = unread?.count ?? 0;
  // Badges for the menu: a new game for the Live Ticker, something needing
  // attention now for Risk Management.
  const { newGame, newestGame, riskAttention, drawAttention } = useAlerts();

  const canSee = (item: NavItem) => !!user?.role && item.roles.includes(user.role);
  // A group shows only the pages this role may open, and disappears if none.
  const visibleItems: NavEntry[] = NAV_ITEMS.flatMap((entry): NavEntry[] => {
    if (!isGroup(entry)) return canSee(entry) ? [entry] : [];
    const children = entry.children.filter(canSee);
    return children.length ? [{ ...entry, children }] : [];
  });

  const [menuOpen, setMenuOpen] = useState(false);
  const [location] = useLocation();
  // Following a link closes the drawer.
  useEffect(() => { setMenuOpen(false); }, [location]);
  // Opening the Live Ticker is what "seeing" the new game means.
  useMarkGameSeenOn("/live-ticker", location, newestGame?.id);

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
            if (isGroup(item)) return <NavGroupLink key={item.label} group={item} />;
            const badge =
              item.path === "/notifications" && unreadCount > 0
                ? <GlowBadge count={unreadCount} label={`${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`} />
                : item.path === "/live-ticker" && newGame
                  ? <GlowBadge tone="emerald" label={`New game: ${newestGame?.name ?? ""}`} />
                  : item.path === "/risk-management" && riskAttention
                    ? <GlowBadge label="Something needs attention now" />
                    : item.path === "/calculations" && drawAttention
                      ? <GlowBadge label="A draw correction needs action" />
                      : null;
            if (badge) {
              return (
                <div key={item.path} className="relative">
                  <NavLink item={item} />
                  <span className="absolute top-1/2 -translate-y-1/2 right-3 flex">{badge}</span>
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
      <aside className="hidden lg:flex w-[17rem] flex-shrink-0 flex-col bg-sidebar border-r border-sidebar-border">
        {sidebar}
      </aside>

      {/* Phones and tablets: the same sidebar as a drawer, so the page gets the
          whole width instead of what is left beside a 224px menu. */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMenuOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-[17rem] max-w-[85vw] flex flex-col bg-sidebar border-r border-sidebar-border shadow-2xl">
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
          {["director", "administrator", "cashier"].includes(user?.role ?? "") ? (
            <AlertsBell variant="sidebar" className="ml-auto" />
          ) : (
            <Link href="/notifications" className="ml-auto relative h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-sidebar-accent" aria-label="Notifications">
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold inline-flex items-center justify-center">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Link>
          )}
        </header>

        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
