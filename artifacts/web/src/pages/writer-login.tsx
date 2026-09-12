import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export function WriterLogin() {
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { setTokens } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone || pin.length !== 4) {
      toast({ title: "Invalid input", description: "Please enter your phone number and 4-digit PIN", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/writer-auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, pin }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Login failed");
      }

      setTokens(data.accessToken, data.refreshToken, data.user);
      setLocation("/writer/dashboard");
    } catch (error: any) {
      toast({
        title: "Login failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto w-16 h-16 rounded-xl overflow-hidden bg-white flex items-center justify-center p-2 mb-2 shadow-sm border">
            <img src="/company-logo-v3.png" alt="Logo" className="w-full h-full object-contain" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">Writer Portal</CardTitle>
          <CardDescription>Enter your phone number and 4-digit PIN to sign in</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="phone" className="text-sm font-medium">Phone Number</label>
              <Input
                id="phone"
                type="tel"
                placeholder="024XXXXXXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="pin" className="text-sm font-medium">4-Digit PIN</label>
              <Input
                id="pin"
                type="password"
                inputMode="numeric"
                maxLength={4}
                placeholder="••••"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading || pin.length !== 4}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sign In
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex justify-center text-sm text-muted-foreground border-t p-4">
          Need an account?&nbsp;
          <Link href="/writer/register">
            <a className="text-primary font-medium hover:underline">Register here</a>
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
