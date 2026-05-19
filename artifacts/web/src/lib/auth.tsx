import { useContext } from "react";
import { AuthContext } from "./auth-provider";
import type { AuthContextType } from "./auth-provider";

export type { AuthContextType };
export { AuthContext };

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
