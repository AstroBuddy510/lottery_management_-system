import { useContext } from "react";
import { AuthContext } from "./auth-context";
import type { AuthContextType } from "./auth-context";

export type { AuthContextType };

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
