import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useGetUnreadCount, getGetUnreadCountQueryKey } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

const AVATAR_COLORS = [
  "#2563eb","#059669","#7c3aed","#ea580c",
  "#db2777","#0d9488","#0891b2","#e11d48",
];

function avatarColor(name: string) {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
}

function NavHome({ active }: { active: boolean }) {
  return active ? (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
    </svg>
  ) : (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/>
      <path d="M9 21V12h6v9"/>
    </svg>
  );
}

function NavSales({ active }: { active: boolean }) {
  return active ? (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM9 13h6v1.5H9V13zm0-3h6v1.5H9V10zm0 6h4v1.5H9V16z"/>
    </svg>
  ) : (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2"/>
      <path d="M9 7h6M9 11h6M9 15h4"/>
    </svg>
  );
}

function NavGross({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? "2.5" : "1.8"} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
      <polyline points="17 6 23 6 23 12"/>
    </svg>
  );
}

function NavWins({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? "2.5" : "1.8"} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
      <path d="M4 22h16"/>
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
    </svg>
  );
}

function NavWriters({ active }: { active: boolean }) {
  return active ? (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
    </svg>
  ) : (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  );
}

const NAV_TABS = [
  { label: "Home",    path: "/dashboard",     icon: (a: boolean) => <NavHome active={a} /> },
  { label: "Sales",   path: "/sales",          icon: (a: boolean) => <NavSales active={a} /> },
  { label: "Gross",   path: "/entries/gross",  icon: (a: boolean) => <NavGross active={a} /> },
  { label: "Wins",    path: "/entries/wins",   icon: (a: boolean) => <NavWins active={a} /> },
  { label: "Writers", path: "/my-writers",     icon: (a: boolean) => <NavWriters active={a} /> },
];

export function AgentLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const { data: unread } = useGetUnreadCount({
    query: { queryKey: getGetUnreadCountQueryKey(), refetchInterval: 30_000 }
  });
  const unreadCount = unread?.count ?? 0;

  const name = user?.fullName ?? "Agent";
  const initials = name.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const bgColor = avatarColor(name);

  return (
    <div className="flex flex-col bg-[#f0f4f8]" style={{ height: "100dvh", overflow: "hidden" }}>

      {/* ── Top header ── */}
      <header
        className="flex-shrink-0 flex items-center gap-3 px-4 z-40"
        style={{
          paddingTop: "calc(env(safe-area-inset-top) + 12px)",
          paddingBottom: "12px",
          background: "linear-gradient(135deg, #1e3a5f 0%, #1d4ed8 100%)",
        }}
      >
        {/* Brand */}
        <div className="flex-1">
          <div className="text-lg font-black text-white tracking-tight leading-none">VS2000</div>
          <div className="text-[10px] text-blue-200/80 leading-tight mt-0.5 tracking-wider uppercase">Smart Office</div>
        </div>

        {/* Bell */}
        <Link href="/notifications">
          <button className="relative p-2 rounded-full active:bg-white/10 transition-colors">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 min-w-[17px] h-[17px] bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center px-0.5 leading-none ring-2 ring-[#1e3a5f]">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </button>
        </Link>

        {/* Avatar / menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold active:opacity-80 transition-opacity ring-2 ring-white/30"
            style={{ background: bgColor }}
          >
            {initials}
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-2xl shadow-2xl z-50 overflow-hidden border border-gray-100">
                <div className="px-4 py-3.5 border-b border-gray-100 bg-gray-50/60">
                  <div className="text-sm font-semibold text-gray-900 truncate">{user?.fullName}</div>
                  <div className="text-xs text-gray-500 mt-0.5">Agent</div>
                </div>
                <Link href="/entry-change-requests" onClick={() => setMenuOpen(false)}>
                  <div className="flex items-center gap-3 px-4 py-3.5 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-50 transition-colors font-medium">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <line x1="16" y1="13" x2="8" y2="13"/>
                      <line x1="16" y1="17" x2="8" y2="17"/>
                      <polyline points="10 9 9 9 8 9"/>
                    </svg>
                    Change Requests
                  </div>
                </Link>
                <Link href="/online-payment" onClick={() => setMenuOpen(false)}>
                  <div className="flex items-center gap-3 px-4 py-3.5 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-50 transition-colors font-medium">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="4" width="20" height="16" rx="2"/>
                      <line x1="2" y1="10" x2="22" y2="10"/>
                    </svg>
                    Make Deposit
                  </div>
                </Link>
                <button
                  onClick={() => { setMenuOpen(false); logout(); }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-sm text-red-600 hover:bg-red-50 active:bg-red-50 transition-colors font-semibold"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                    <polyline points="16 17 21 12 16 7"/>
                    <line x1="21" y1="12" x2="9" y2="12"/>
                  </svg>
                  Sign Out
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* ── Scrollable content ── */}
      <main className="flex-1 overflow-y-auto overscroll-y-contain">
        <div className="pb-28">{children}</div>
      </main>

      {/* ── Bottom tab bar ── */}
      <nav
        className="flex-shrink-0 bg-white z-40"
        style={{
          paddingBottom: "env(safe-area-inset-bottom)",
          borderTop: "1px solid #e2e8f0",
          boxShadow: "0 -4px 20px rgba(0,0,0,0.07)",
        }}
      >
        <div className="flex items-stretch">
          {NAV_TABS.map(tab => {
            const active = location === tab.path || (tab.path !== "/dashboard" && location.startsWith(tab.path));
            return (
              <Link key={tab.path} href={tab.path} className="flex-1">
                <div className={cn(
                  "flex flex-col items-center justify-center gap-1 pt-2.5 pb-2 px-1 relative transition-colors",
                  active ? "text-[#1d4ed8]" : "text-gray-400"
                )}>
                  {active && (
                    <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[3px] rounded-b-full bg-[#1d4ed8]" />
                  )}
                  {tab.icon(active)}
                  <span className={cn(
                    "text-[10px] leading-none",
                    active ? "font-bold text-[#1d4ed8]" : "font-medium text-gray-400"
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
