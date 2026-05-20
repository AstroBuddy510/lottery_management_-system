import React, { useEffect, useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
  setAuthTokenGetter, setUnauthorizedHandler,
  useGetMe, useLogin, useLogout, getGetMeQueryKey,
} from "@workspace/api-client-react";
import { AuthContext } from "./auth-context";

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<import("@workspace/api-client-react").User | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [showWarning, setShowWarning] = useState(false);
  const [countdown, setCountdown] = useState(WARN_SECONDS);
  const [, setLocation] = useLocation();

  const loginMutation  = useLogin();
  const logoutMutation = useLogout();

  const hasToken = !!localStorage.getItem("accessToken");
  const { data: me, isLoading: isLoadingMe, isError } = useGetMe({
    query: { queryKey: getGetMeQueryKey(), enabled: hasToken, retry: false },
  });

  const setLocationRef   = useRef(setLocation);
  setLocationRef.current = setLocation;

  const refreshTimerRef   = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const warningActiveRef   = useRef(false); // mirrors showWarning without stale-closure issues
  const isLoggedInRef      = useRef(false); // true once a user is authenticated

  /* ── timer helpers ─────────────────────────────────────────────────────── */

  const clearRefreshTimer   = () => { if (refreshTimerRef.current)    { clearTimeout(refreshTimerRef.current);    refreshTimerRef.current = null; } };
  const clearInactivityTimer = () => { if (inactivityTimerRef.current) { clearTimeout(inactivityTimerRef.current); inactivityTimerRef.current = null; } };
  const clearCountdownTimer  = () => { if (countdownTimerRef.current)  { clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; } };

  /* ── proactive token refresh ───────────────────────────────────────────── */

  const scheduleRefresh = useCallback((accessToken: string) => {
    clearRefreshTimer();
    const expiry = parseTokenExpiry(accessToken);
    if (!expiry) return;
    // Refresh 2 minutes before expiry; never less than 30 s from now
    const delay = Math.max(30_000, expiry - Date.now() - 2 * 60 * 1000);
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
    clearInactivityTimer();
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

  const resetInactivityTimer = useCallback(() => {
    if (warningActiveRef.current || !isLoggedInRef.current) return;
    clearInactivityTimer();
    inactivityTimerRef.current = setTimeout(startCountdown, INACTIVITY_MS);
  }, [startCountdown]);


  /* ── global auth hooks ─────────────────────────────────────────────────── */

  useEffect(() => {
    setAuthTokenGetter(() => localStorage.getItem("accessToken"));
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
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
      setUser(null);
      setIsInitializing(false);
    }
  }, [me, isLoadingMe, isError]);

  /* ── start timers + activity listeners when authenticated ───────────────── */

  useEffect(() => {
    if (!me) return;
    isLoggedInRef.current = true;

    const token = localStorage.getItem("accessToken");
    if (token) scheduleRefresh(token);

    resetInactivityTimer();

    const onActivity = () => resetInactivityTimer();
    ACTIVITY_EVENTS.forEach(ev => window.addEventListener(ev, onActivity, { passive: true }));

    return () => {
      clearRefreshTimer();
      clearInactivityTimer();
      clearCountdownTimer();
      ACTIVITY_EVENTS.forEach(ev => window.removeEventListener(ev, onActivity));
    };
  }, [me, scheduleRefresh, resetInactivityTimer]); // eslint-disable-line react-hooks/exhaustive-deps

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

      {/* ── Inactivity warning overlay — no dismiss, no override ─────────── */}
      {showWarning && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}
          onMouseDown={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-xs w-full mx-4 text-center select-none">
            <div className={`mx-auto mb-4 w-12 h-12 rounded-full flex items-center justify-center ${countdown <= 10 ? "bg-red-100" : "bg-amber-100"}`}>
              <svg
                className={`w-6 h-6 ${countdown <= 10 ? "text-red-600" : "text-amber-600"}`}
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
              >
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            </div>
            <p className={`text-lg font-semibold mb-1 ${countdown <= 10 ? "text-red-600" : "text-amber-600"}`}>
              Session Expiring
            </p>
            <p className="text-sm text-gray-500 mb-5">
              Inactive session. Logging out in:
            </p>
            <div
              className="text-8xl font-mono font-bold tabular-nums leading-none mb-2"
              style={{ color: countdown <= 10 ? "#dc2626" : "#1e3a5f" }}
            >
              {String(countdown).padStart(2, "0")}
            </div>
            <p className="text-xs text-gray-400">seconds</p>
          </div>
        </div>
      )}
    </AuthContext.Provider>
  );
}
