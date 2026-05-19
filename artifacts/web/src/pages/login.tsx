import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
      await login({ phone, role: role as "director" | "administrator" | "cashier" | "gross_entry" | "wins_entry" | "agent", pin });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      setError(msg.includes("401") || msg.toLowerCase().includes("invalid") ? "Invalid phone number, role, or PIN." : "Login failed. Please try again.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-3xl font-bold text-primary tracking-tight">VS2000</div>
          <div className="text-muted-foreground text-sm mt-1">Smart Office Platform</div>
        </div>
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Sign in</CardTitle>
            <CardDescription className="text-xs">Enter your phone number, select your role, and enter your 4-digit PIN.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="phone" className="text-xs">Phone Number</Label>
                <Input
                  id="phone"
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  required
                  placeholder="e.g. 8000001"
                  className="h-9 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Role</Label>
                <Select value={role} onValueChange={setRole} required>
                  <SelectTrigger className="h-9 text-sm">
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
                <Label htmlFor="pin" className="text-xs">4-Digit PIN</Label>
                <Input
                  id="pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={4}
                  value={pin}
                  onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  required
                  placeholder="••••"
                  className="h-9 text-sm tracking-[0.5em] text-center"
                />
              </div>

              {error && <p className="text-xs text-destructive">{error}</p>}

              <Button
                type="submit"
                className="w-full h-9"
                disabled={isLoading || !phone || !role || pin.length !== 4}
              >
                {isLoading ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
