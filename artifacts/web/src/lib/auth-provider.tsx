import React, { useEffect, useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
  setAuthTokenGetter, setUnauthorizedHandler,
  useGetMe, useLogin, useLogout, getGetMeQueryKey,
} from "@workspace/api-client-react";
import { AuthContext } from "./auth-context";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { syncServerTime, getServerNow } from "./time-sync";

const INACTIVITY_MS   = 15 * 60 * 1000; // 15 minutes of no activity
const WARN_SECONDS    = 59;              // countdown before auto-logout
const ACTIVITY_EVENTS = ["mousemove", "keydown", "click", "scroll", "touchstart", "pointerdown"] as const;

function parseTokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

// Register the auth token getter immediately so that any early query hooks
// (which are executed synchronously during render) can access the token.
setAuthTokenGetter(() => localStorage.getItem("accessToken"));

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<import("@workspace/api-client-react").User | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [showWarning, setShowWarning] = useState(false);
  const [countdown, setCountdown] = useState(WARN_SECONDS);
  const [, setLocation] = useLocation();

  useEffect(() => {
    syncServerTime();
    const interval = setInterval(syncServerTime, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const loginMutation  = useLogin();
  const logoutMutation = useLogout();

  const hasToken = !!localStorage.getItem("accessToken");
  const { data: me, isLoading: isLoadingMe, isError, error } = useGetMe({
    query: { queryKey: getGetMeQueryKey(), enabled: hasToken, retry: false },
  });

  const setLocationRef   = useRef(setLocation);
  setLocationRef.current = setLocation;

  const refreshTimerRef   = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const countdownTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const warningActiveRef   = useRef(false); // mirrors showWarning without stale-closure issues
  const isLoggedInRef      = useRef(false); // true once a user is authenticated
  const lastActivityRef    = useRef<number>(Date.now());

  /* ── timer helpers ─────────────────────────────────────────────────────── */

  const clearRefreshTimer   = () => { if (refreshTimerRef.current)    { clearTimeout(refreshTimerRef.current);    refreshTimerRef.current = null; } };
  const clearCountdownTimer  = () => { if (countdownTimerRef.current)  { clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; } };

  /* ── proactive token refresh ───────────────────────────────────────────── */

  const scheduleRefresh = useCallback((accessToken: string) => {
    clearRefreshTimer();
    const expiry = parseTokenExpiry(accessToken);
    if (!expiry) return;
    // Refresh 2 minutes before expiry; never less than 30 s from now
    const delay = Math.max(30_000, expiry - getServerNow().getTime() - 2 * 60 * 1000);
    refreshTimerRef.current = setTimeout(async () => {
      const rt = localStorage.getItem("refreshToken");
      if (!rt || !isLoggedInRef.current) return;
      try {
        const res = await fetch("/api/auth/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: rt }),
        });
        if (res.ok) {
          const data = await res.json() as { accessToken: string; refreshToken: string };
          localStorage.setItem("accessToken", data.accessToken);
          localStorage.setItem("refreshToken", data.refreshToken);
          scheduleRefresh(data.accessToken); // schedule the next cycle
        }
      } catch {
        // silent — next API call 401 will fall through to the unauthorized handler
      }
    }, delay);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── silent token refresh (used by the unauthorized handler) ───────────── */

  const doRefresh = useCallback(async (): Promise<boolean> => {
    const rt = localStorage.getItem("refreshToken");
    if (!rt) return false;
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: rt }),
      });
      if (res.ok) {
        const data = await res.json() as { accessToken: string; refreshToken: string };
        localStorage.setItem("accessToken", data.accessToken);
        localStorage.setItem("refreshToken", data.refreshToken);
        scheduleRefresh(data.accessToken);
        return true;
      }
    } catch { /* empty */ }
    return false;
  }, [scheduleRefresh]);

  /* ── logout ────────────────────────────────────────────────────────────── */

  const performLogout = useCallback(async () => {
    isLoggedInRef.current  = false;
    warningActiveRef.current = false;
    clearRefreshTimer();
    clearCountdownTimer();
    setShowWarning(false);
    try { await logoutMutation.mutateAsync(); } catch { /* ignore */ }
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    setUser(null);
    setLocationRef.current("/login");
  }, [logoutMutation]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── inactivity / countdown ────────────────────────────────────────────── */

  const startCountdown = useCallback(() => {
    warningActiveRef.current = true;
    setShowWarning(true);
    setCountdown(WARN_SECONDS);
    clearCountdownTimer();
    let remaining = WARN_SECONDS;
    countdownTimerRef.current = setInterval(() => {
      remaining -= 1;
      setCountdown(remaining);
      if (remaining <= 0) {
        clearCountdownTimer();
        performLogout();
      }
    }, 1000);
  }, [performLogout]);

  /* ── global auth hooks ─────────────────────────────────────────────────── */

  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (!localStorage.getItem("accessToken")) return;
      // Try a silent refresh before giving up
      doRefresh().then(ok => {
        if (!ok) performLogout();
      });
    });
    return () => setUnauthorizedHandler(null);
  }, [doRefresh, performLogout]);

  useEffect(() => {
    if (me) setUser(me);
    if (!isLoadingMe) setIsInitializing(false);
    if (isError) {
      const isUnauthorized = error && typeof error === "object" && "status" in error && error.status === 401;
      if (isUnauthorized || !localStorage.getItem("accessToken")) {
        localStorage.removeItem("accessToken");
        localStorage.removeItem("refreshToken");
        setUser(null);
      }
      setIsInitializing(false);
    }
  }, [me, isLoadingMe, isError, error]);

  /* ── start timers + activity listeners when authenticated ───────────────── */

  const startCountdownRef = useRef(startCountdown);
  startCountdownRef.current = startCountdown;

  useEffect(() => {
    if (!me) return;
    isLoggedInRef.current = true;
    lastActivityRef.current = Date.now();

    const token = localStorage.getItem("accessToken");
    if (token) scheduleRefresh(token);

    const onActivity = () => {
      // Only record activity if warning is NOT currently showing
      if (!warningActiveRef.current) {
        lastActivityRef.current = Date.now();
      }
    };

    ACTIVITY_EVENTS.forEach(ev => window.addEventListener(ev, onActivity, { passive: true }));

    // Check inactivity every 2 seconds for high responsiveness
    const interval = setInterval(() => {
      if (warningActiveRef.current || !isLoggedInRef.current) return;
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed >= INACTIVITY_MS) {
        startCountdownRef.current();
      }
    }, 2000);

    return () => {
      clearInterval(interval);
      clearRefreshTimer();
      clearCountdownTimer();
      ACTIVITY_EVENTS.forEach(ev => window.removeEventListener(ev, onActivity));
    };
  }, [me, scheduleRefresh]);

  /* ── prompt actions ────────────────────────────────────────────────────── */

  const handleStayIn = async () => {
    clearCountdownTimer();
    setShowWarning(false);
    warningActiveRef.current = false;
    lastActivityRef.current = Date.now();
    try {
      const refreshed = await doRefresh();
      if (refreshed) {
        toast.success("Session renewed successfully.");
      } else {
        performLogout();
      }
    } catch {
      performLogout();
    }
  };

  const handleLogoutClick = () => {
    performLogout();
  };

  /* ── login / logout exposed on context ─────────────────────────────────── */

  const login = async (data: import("@workspace/api-client-react").LoginInput) => {
    const res = await loginMutation.mutateAsync({ data });
    localStorage.setItem("accessToken", res.accessToken);
    localStorage.setItem("refreshToken", res.refreshToken);
    setUser(res.user);
    setLocation("/dashboard");
  };

  const logout = async () => {
    await performLogout();
  };

  const isLoading = isInitializing || (hasToken && isLoadingMe) || loginMutation.isPending;

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}

      {/* ── Inactivity warning overlay — premium glassmorphic modal ─────────── */}
      {showWarning && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center animate-in fade-in duration-300"
          style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}
          onMouseDown={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          <div className="bg-background border border-border rounded-3xl shadow-2xl p-8 max-w-sm w-full mx-4 text-center select-none backdrop-blur-xl animate-in zoom-in-95 duration-300">
            <div className={`mx-auto mb-4 w-12 h-12 rounded-full flex items-center justify-center ${countdown <= 10 ? "bg-destructive/10 text-destructive animate-bounce" : "bg-amber-500/10 text-amber-500 animate-pulse"}`}>
              <svg
                className="w-6 h-6"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
              >
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            </div>
            <p className={`text-xl font-bold tracking-tight mb-1.5 ${countdown <= 10 ? "text-destructive" : "text-amber-500"}`}>
              Session Expiring
            </p>
            <p className="text-xs text-muted-foreground mb-6 leading-relaxed">
              Your session has been inactive. You will be logged out in:
            </p>
            <div
              className="text-7xl font-mono font-bold tracking-tighter leading-none mb-6 tabular-nums"
              style={{ color: countdown <= 10 ? "var(--destructive)" : "var(--primary)" }}
            >
              {String(countdown).padStart(2, "0")}
            </div>
            
            <div className="flex flex-col gap-2.5">
              <Button
                onClick={handleStayIn}
                className="w-full h-11 rounded-xl font-semibold bg-primary text-primary-foreground hover:bg-primary/95 transition-all"
              >
                Stay in
              </Button>
              <Button
                variant="outline"
                onClick={handleLogoutClick}
                className="w-full h-11 rounded-xl font-semibold border-border hover:bg-muted text-muted-foreground transition-all"
              >
                Log out
              </Button>
            </div>
          </div>
        </div>
      )}
    </AuthContext.Provider>
  );
}
