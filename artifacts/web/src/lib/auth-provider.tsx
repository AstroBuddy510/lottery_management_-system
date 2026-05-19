import React, { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { setAuthTokenGetter, useGetMe, useLogin, useLogout, getGetMeQueryKey } from "@workspace/api-client-react";
import { AuthContext } from "./auth-context";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<import("@workspace/api-client-react").User | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [, setLocation] = useLocation();

  const loginMutation = useLogin();
  const logoutMutation = useLogout();

  const hasToken = !!localStorage.getItem("accessToken");
  const { data: me, isLoading: isLoadingMe, isError } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      enabled: hasToken,
      retry: false,
    },
  });

  useEffect(() => {
    setAuthTokenGetter(() => localStorage.getItem("accessToken"));
  }, []);

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

  const login = async (data: import("@workspace/api-client-react").LoginInput) => {
    const res = await loginMutation.mutateAsync({ data });
    localStorage.setItem("accessToken", res.accessToken);
    localStorage.setItem("refreshToken", res.refreshToken);
    setUser(res.user);
    setLocation("/dashboard");
  };

  const logout = async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch {
      // ignore
    } finally {
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
      setUser(null);
      setLocation("/login");
    }
  };

  const isLoading = isInitializing || (hasToken && isLoadingMe) || loginMutation.isPending;

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
