import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { LogOut, Home, Ticket, Wallet, User, Trophy, Receipt } from "lucide-react";
import { ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ClosingAlerts } from "@/components/closing-alerts";
import { useClosingAlerts } from "@/lib/use-closing-alerts";

const NavLink = ({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: any;
  children: ReactNode;
}) => {
  const [location] = useLocation();
  const isActive = location === href;

  return (
    <Link href={href}>
      <a className={`relative flex flex-col items-center justify-center gap-1 flex-1 py-3 transition-colors ${
          isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Icon className="h-5 w-5" />
        <span className="text-xs font-medium">{children}</span>
        {isActive && (
          <motion.div
            layoutId="bottom-nav-indicator"
            className="absolute bottom-0 h-1 w-12 bg-primary rounded-t-full"
          />
        )}
      </a>
    </Link>
  );
};

const SIDEBAR = [
  { href: "/writer/dashboard", label: "Dashboard", icon: Home },
  { href: "/writer/place-bet", label: "Place Bet", icon: Ticket },
  { href: "/writer/tickets", label: "My Tickets", icon: Receipt },
  { href: "/writer/claims", label: "Claim Wins", icon: Trophy },
  { href: "/writer/wallet", label: "Wallet & Ledger", icon: Wallet },
] as const;

function SideLink({ href, icon: Icon, children }: { href: string; icon: typeof Home; children: ReactNode }) {
  const [location] = useLocation();
  const active = location === href;
  return (
    <Link href={href}>
      <a className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
        active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}>
        <Icon className="h-4 w-4" /> {children}
      </a>
    </Link>
  );
}

export function WriterLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

  /**
   * Shares its cache key with Place Bet, so sitting on the dashboard costs one
   * poll a minute and visiting Place Bet costs nothing extra. The poll is for
   * games created while the writer is signed in - a close time itself never
   * moves, so the countdown does not depend on it.
   */
  const { data: games } = useQuery({
    queryKey: ["/api/games"],
    queryFn: async () => {
      const res = await fetch("/api/games", {
        headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` },
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: user?.role === "writer",
    refetchInterval: 60_000,
  });

  const { alerts, dismiss, now } = useClosingAlerts(games);

  if (!user || user.role !== "writer") {
    // If not writer, fallback or redirect handled by router, but render nothing here just in case
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-muted/30 pb-16 lg:pb-0 lg:pl-64 flex flex-col">
      {/* Desktop Sidebar */}
      <div className="hidden lg:flex fixed inset-y-0 left-0 w-64 bg-background border-r flex-col z-50">
        <div className="h-16 flex items-center gap-2.5 px-5 border-b">
          <img
            src="/company-logo-v3.png"
            alt="Vision 2000"
            className="h-9 w-9 shrink-0 object-contain"
          />
          <h2 className="text-sm font-extrabold text-primary tracking-tight leading-tight">
            Vision 2000 Writers Portal
          </h2>
        </div>
        
        <nav className="flex-1 py-6 px-3 flex flex-col gap-1">
          {SIDEBAR.map(({ href, label, icon: Icon }) => (
            <SideLink key={href} href={href} icon={Icon}>{label}</SideLink>
          ))}
        </nav>

        <div className="p-4 border-t mt-auto">
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="h-5 w-5 text-primary" />
            </div>
            <div className="overflow-hidden text-sm">
              <p className="font-medium truncate">{user.fullName}</p>
              <p className="text-xs text-muted-foreground truncate">{user.phone}</p>
            </div>
          </div>
          <Button variant="outline" className="w-full justify-start text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => logout()}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        </div>
      </div>

      {/* Main Content */}
      {/* Full width on phones; the max-width only kicks in once there is room
          for it. min-w-0 lets children shrink instead of forcing the page wide. */}
      <main className="flex-1 w-full min-w-0 max-w-full lg:max-w-5xl mx-auto px-3 py-4 sm:px-4 lg:p-8 animate-in fade-in duration-200">
        <div className="lg:hidden -mx-3 -mt-4 sm:-mx-4 mb-4 flex items-center justify-between gap-2 border-b bg-background/95 px-3 py-2.5 backdrop-blur sm:px-4 sticky top-0 z-40">
           <div className="flex items-center gap-2 min-w-0">
             <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-border/70">
               <img src="/company-logo-v3.png" alt="Vision 2000" className="h-7 w-7 object-contain" />
             </span>
             <div className="min-w-0 leading-tight">
               <h2 className="truncate text-sm font-extrabold tracking-tight text-primary">Vision 2000</h2>
               <p className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Writers Portal</p>
             </div>
           </div>
           <div className="flex items-center gap-1.5">
             <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground" title={user.fullName}>
               {user.fullName.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase()}
             </span>
             <Button variant="ghost" size="icon" onClick={() => logout()} aria-label="Sign out" className="text-muted-foreground shrink-0">
               <LogOut className="h-5 w-5" />
             </Button>
           </div>
        </div>
        {children}
      </main>

      {/* Closing warnings. Fixed and outside <main>, so they overlay rather
          than reflow whatever the writer is in the middle of. */}
      <ClosingAlerts alerts={alerts} now={now} onDismiss={dismiss} />

      {/* Mobile Bottom Navigation */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 h-16 bg-background/95 backdrop-blur border-t shadow-[0_-4px_20px_rgba(0,0,0,0.06)] flex items-center justify-around z-50 px-2 pb-safe">
        <NavLink href="/writer/dashboard" icon={Home}>Home</NavLink>
        <NavLink href="/writer/place-bet" icon={Ticket}>Bet</NavLink>
        <NavLink href="/writer/tickets" icon={Receipt}>Tickets</NavLink>
        <NavLink href="/writer/claims" icon={Trophy}>Claim</NavLink>
        <NavLink href="/writer/wallet" icon={Wallet}>Wallet</NavLink>
      </div>
    </div>
  );
}
