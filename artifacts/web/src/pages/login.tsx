import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ROLES = [
  { value: "director", label: "Director" },
  { value: "administrator", label: "Administrator" },
  { value: "cashier", label: "Cashier" },
  { value: "gross_entry", label: "Gross Entry" },
  { value: "wins_entry", label: "Wins Entry" },
  { value: "agent", label: "Agent" },
];

export function Login() {
  const { login, isLoading } = useAuth();
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (pin.length !== 4) {
      setError("PIN must be exactly 4 digits.");
      return;
    }
    try {
      await login({
        phone,
        role: role as "director" | "administrator" | "cashier" | "gross_entry" | "wins_entry" | "agent",
        pin,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      setError(
        msg.includes("401") || msg.toLowerCase().includes("invalid")
          ? "Invalid phone number, role, or PIN."
          : "Login failed. Please try again."
      );
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{
        backgroundImage: "url(/login-bg.png)",
        backgroundSize: "150%",
        backgroundPosition: "center center",
        backgroundRepeat: "no-repeat",
      }}
    >
      {/* dark overlay for readability */}
      <div className="absolute inset-0 bg-black/45" />

      <div className="relative z-10 w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-7">
          <div className="text-4xl font-extrabold text-white tracking-tight drop-shadow-lg">
            VS2000
          </div>
          <div className="text-blue-200 text-sm mt-1 tracking-wide font-medium">
            Smart Office Platform
          </div>
        </div>

        {/* Frosted-glass card */}
        <div
          className="rounded-2xl px-8 py-8 shadow-2xl"
          style={{
            background: "rgba(255,255,255,0.12)",
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
            border: "1px solid rgba(255,255,255,0.25)",
          }}
        >
          <h2 className="text-white text-lg font-semibold mb-1">Sign in</h2>
          <p className="text-blue-100 text-xs mb-6">
            Enter your phone number, select your role, and enter your 4-digit PIN.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-blue-100 font-medium">Phone Number</Label>
              <Input
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                required
                placeholder="e.g. 0244000001"
                className="h-10 text-sm bg-white/20 border-white/30 text-white placeholder:text-white/50 focus:bg-white/30 focus:border-white/60"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-blue-100 font-medium">Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="h-10 text-sm bg-white/20 border-white/30 text-white focus:bg-white/30 focus:border-white/60 [&>span]:text-white data-[placeholder]:text-white/50">
                  <SelectValue placeholder="Select your role…" />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map(r => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-blue-100 font-medium">4-Digit PIN</Label>
              <Input
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={4}
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                required
                placeholder="••••"
                className="h-10 text-sm text-center tracking-[0.6em] bg-white/20 border-white/30 text-white placeholder:text-white/40 focus:bg-white/30 focus:border-white/60"
              />
            </div>

            {error && (
              <p className="text-xs text-red-300 font-medium bg-red-900/30 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <Button
              type="submit"
              className="w-full h-10 mt-1 font-bold bg-blue-500 hover:bg-blue-400 active:bg-blue-600 text-white border-2 border-blue-300 hover:border-white shadow-[0_0_18px_rgba(59,130,246,0.7)] hover:shadow-[0_0_26px_rgba(147,197,253,0.8)] transition-all duration-200 tracking-wide"
              disabled={isLoading || !phone || !role || pin.length !== 4}
            >
              {isLoading ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
