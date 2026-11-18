import { useState } from "react";
import { useLocation, Link, Redirect } from "wouter";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { postJson } from "@/lib/writer-api";

/**
 * The Writer Portal sign-in - the first screen of the VS2000 Writers app and
 * where it returns after signing out. Same galaxy background, logo and
 * frosted-glass card as the office login, so the two read as one product;
 * no role picker, because everyone signing in here is a writer.
 */
export function WriterLogin() {
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const { user, isLoading: authLoading, setTokens } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Already signed in as a writer (the app reopened): straight to the dashboard.
  if (!authLoading && user?.role === "writer") {
    return <Redirect to="/writer/dashboard" replace />;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!phone || pin.length !== 4) {
      setError("Enter your phone number and 4-digit PIN.");
      return;
    }

    setIsLoading(true);
    try {
      const data = await postJson<{
        accessToken: string;
        refreshToken: string;
        user: unknown;
      }>("/api/writer-auth/login", { phone, pin });

      setTokens(data.accessToken, data.refreshToken, data.user);
      setLocation("/writer/dashboard", { replace: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Login failed. Please try again.";
      setError(message);
      toast({ title: "Login failed", description: message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="relative flex items-center justify-center px-4 py-12"
      style={{
        minHeight: "100dvh",
        backgroundImage: "url(/login-bg-v5.png)",
        backgroundSize: "cover",
        backgroundPosition: "center center",
        backgroundRepeat: "no-repeat",
        backgroundColor: "#0b1120",
      }}
    >
      {/* dark overlay for readability */}
      <div className="absolute inset-0 bg-black/45" />

      <div className="relative z-10 w-full max-w-sm">
        <div className="text-center mb-7">
          <div className="flex justify-center mb-3">
            <div className="w-28 h-28 rounded-full shadow-xl overflow-hidden flex items-center justify-center">
              <img src="/company-logo-v3.png" alt="VS2000 Logo" className="w-full h-full object-cover scale-[1.18]" />
            </div>
          </div>
          <div className="text-4xl font-extrabold text-white tracking-tight drop-shadow-lg">VS2000</div>
          <div className="text-blue-200 text-sm mt-1 tracking-wide font-medium">Writer Portal</div>
        </div>

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
          <p className="text-blue-100 text-xs mb-6">Enter your phone number and your 4-digit PIN.</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="writer-phone" className="text-xs text-blue-100 font-medium">Phone Number</Label>
              <Input
                id="writer-phone"
                type="tel"
                autoComplete="tel"
                placeholder="e.g. 024XXXXXXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                className="h-10 text-sm bg-white/20 border-white/30 text-white placeholder:text-white/50 focus:bg-white/30 focus:border-white/60"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="writer-pin" className="text-xs text-blue-100 font-medium">4-Digit PIN</Label>
              <Input
                id="writer-pin"
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={4}
                placeholder="••••"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                required
                className="h-10 text-sm text-center tracking-[0.6em] bg-white/20 border-white/30 text-white placeholder:text-white/40 focus:bg-white/30 focus:border-white/60"
              />
            </div>

            {error && (
              <p role="alert" className="text-xs text-red-300 font-medium bg-red-900/30 rounded-lg px-3 py-2">{error}</p>
            )}

            <Button
              type="submit"
              className="w-full h-10 mt-1 font-bold bg-blue-500 hover:bg-blue-400 active:bg-blue-600 text-white border-2 border-blue-300 hover:border-white shadow-[0_0_18px_rgba(59,130,246,0.7)] hover:shadow-[0_0_26px_rgba(147,197,253,0.8)] transition-all duration-200 tracking-wide"
              disabled={isLoading || !phone || pin.length !== 4}
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isLoading ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <div className="mt-6 border-t border-white/20 pt-4 text-center text-xs text-blue-100">
            Need an account?{" "}
            <Link href="/writer/register" className="font-semibold text-white hover:underline">
              Register here
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
