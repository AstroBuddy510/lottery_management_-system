import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useGetUnreadCount, getGetUnreadCountQueryKey } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface NavTab {
  label: string;
  path: string;
  icon: (active: boolean) => React.ReactNode;
}

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      stroke={active ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"}>
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" />
      <path d="M9 21V12h6v9" />
    </svg>
  );
}

function SalesIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      stroke={active ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"}>
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <path d="M9 7h6M9 11h6M9 15h4" />
    </svg>
  );
}

function GrossIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      stroke={active ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"}>
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  );
}

function WinsIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      stroke={active ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"}>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );
}

function WritersIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      stroke={active ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function BellIcon({ unread }: { unread: number }) {
  return (
    <div className="relative">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {unread > 0 && (
        <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </div>
  );
}

function MenuIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

const NAV_TABS: NavTab[] = [
  { label: "Home", path: "/dashboard", icon: (a) => <HomeIcon active={a} /> },
  { label: "Sales", path: "/sales", icon: (a) => <SalesIcon active={a} /> },
  { label: "Gross", path: "/entries/gross", icon: (a) => <GrossIcon active={a} /> },
  { label: "Wins", path: "/entries/wins", icon: (a) => <WinsIcon active={a} /> },
  { label: "Writers", path: "/my-writers", icon: (a) => <WritersIcon active={a} /> },
];

export function AgentLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const { data: unread } = useGetUnreadCount({
    query: { queryKey: getGetUnreadCountQueryKey(), refetchInterval: 30_000 }
  });
  const unreadCount = unread?.count ?? 0;

  const initials = (user?.fullName ?? "A")
    .split(" ")
    .filter(Boolean)
    .map(w => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex flex-col h-dvh bg-background overflow-hidden">
      {/* Top header */}
      <header className="flex-shrink-0 bg-background border-b border-border px-4 py-3 flex items-center gap-3 z-40">
        <div className="flex-1">
          <div className="text-base font-bold text-primary tracking-tight leading-none">VS2000</div>
          <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">Smart Office</div>
        </div>

        <Link href="/notifications">
          <button className="relative p-2 rounded-full text-foreground hover:bg-muted transition-colors active:scale-95">
            <BellIcon unread={unreadCount} />
          </button>
        </Link>

        <div className="relative">
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="flex items-center gap-1.5 p-1.5 rounded-full hover:bg-muted transition-colors active:scale-95"
          >
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold">
              {initials}
            </div>
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-2 w-56 bg-popover border border-border rounded-xl shadow-xl z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-border bg-muted/30">
                  <div className="text-sm font-semibold text-foreground truncate">{user?.fullName}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Agent</div>
                </div>
                <button
                  onClick={() => { setMenuOpen(false); logout(); }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm text-destructive hover:bg-destructive/10 transition-colors font-medium"
                >
                  <LogoutIcon />
                  Sign Out
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* Scrollable content area — padded at bottom for nav bar */}
      <main className="flex-1 overflow-y-auto overscroll-y-contain pb-[env(safe-area-inset-bottom)]">
        <div className="pb-20">
          {children}
        </div>
      </main>

      {/* Bottom tab bar */}
      <nav className="flex-shrink-0 bg-background border-t border-border z-40 pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-stretch">
          {NAV_TABS.map(tab => {
            const active = location === tab.path || (tab.path !== "/dashboard" && location.startsWith(tab.path));
            return (
              <Link key={tab.path} href={tab.path} className="flex-1">
                <div className={cn(
                  "flex flex-col items-center justify-center gap-1 py-2.5 px-1 transition-colors",
                  active ? "text-primary" : "text-muted-foreground"
                )}>
                  {tab.icon(active)}
                  <span className={cn(
                    "text-[10px] font-medium leading-none",
                    active ? "text-primary font-semibold" : "text-muted-foreground"
                  )}>
                    {tab.label}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
