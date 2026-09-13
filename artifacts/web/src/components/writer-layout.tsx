import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { LogOut, Home, Ticket, Wallet, User } from "lucide-react";
import { ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";

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
      <a className={`flex flex-col items-center justify-center gap-1 flex-1 py-3 transition-colors ${
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

export function WriterLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  
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
        
        <div className="flex-1 py-6 px-4 flex flex-col gap-2">
          <Link href="/writer/dashboard">
            <a className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted text-sm font-medium">
              <Home className="h-4 w-4" /> Dashboard
            </a>
          </Link>
          <Link href="/writer/place-bet">
            <a className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted text-sm font-medium">
              <Ticket className="h-4 w-4" /> Place Bet
            </a>
          </Link>
          <Link href="/writer/tickets">
            <a className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted text-sm font-medium">
              <Ticket className="h-4 w-4" /> My Tickets
            </a>
          </Link>
          <Link href="/writer/wallet">
            <a className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted text-sm font-medium">
              <Wallet className="h-4 w-4" /> Wallet & Ledger
            </a>
          </Link>
        </div>

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
        <div className="lg:hidden flex items-center justify-between gap-2 mb-5 pb-3 border-b">
           <div className="flex items-center gap-2 min-w-0">
             <img
               src="/company-logo-v3.png"
               alt="Vision 2000"
               className="h-8 w-8 shrink-0 object-contain"
             />
             <h2 className="text-sm font-extrabold text-primary tracking-tight leading-tight truncate">
               Vision 2000 Writers Portal
             </h2>
           </div>
           <Button variant="ghost" size="icon" onClick={() => logout()} className="text-muted-foreground shrink-0">
             <LogOut className="h-5 w-5" />
           </Button>
        </div>
        {children}
      </main>

      {/* Mobile Bottom Navigation */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 h-16 bg-background border-t flex items-center justify-around z-50 px-2 pb-safe">
        <NavLink href="/writer/dashboard" icon={Home}>Home</NavLink>
        <NavLink href="/writer/place-bet" icon={Ticket}>Bet</NavLink>
        <NavLink href="/writer/tickets" icon={Ticket}>Tickets</NavLink>
        <NavLink href="/writer/wallet" icon={Wallet}>Wallet</NavLink>
      </div>
    </div>
  );
}
