import { useState } from "react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle2 } from "lucide-react";

export function WriterRegister() {
  const [formData, setFormData] = useState({
    fullName: "",
    phone: "",
    idType: "",
    idNumber: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const { toast } = useToast();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.fullName || !formData.phone || !formData.idType || !formData.idNumber) {
      toast({ title: "Missing fields", description: "Please fill out all fields", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/writer-auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Registration failed");
      }

      setIsSuccess(true);
    } catch (error: any) {
      toast({
        title: "Registration failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-md text-center py-8">
          <CardContent className="space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-6">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold">Registration Submitted</h2>
            <p className="text-muted-foreground max-w-sm mx-auto">
              Your registration request has been submitted successfully. An administrator or agent will review your application and generate a PIN for you.
            </p>
            <div className="pt-6">
              <Link href="/writer/login">
                <Button className="w-full">Return to Login</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4 py-8">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto w-16 h-16 rounded-xl overflow-hidden bg-white flex items-center justify-center p-2 mb-2 shadow-sm border">
            <img src="/company-logo-v3.png" alt="Logo" className="w-full h-full object-contain" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">Writer Registration</CardTitle>
          <CardDescription>Join VS2000 as a lottery writer</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleRegister} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Full Name</label>
              <Input
                placeholder="John Doe"
                value={formData.fullName}
                onChange={(e) => setFormData(p => ({ ...p, fullName: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Phone Number</label>
              <Input
                type="tel"
                placeholder="024XXXXXXX"
                value={formData.phone}
                onChange={(e) => setFormData(p => ({ ...p, phone: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">ID Type</label>
              <Select onValueChange={(v) => setFormData(p => ({ ...p, idType: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select ID Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ghana_card">Ghana Card</SelectItem>
                  <SelectItem value="voters_id">Voters ID</SelectItem>
                  <SelectItem value="drivers_license">Drivers License</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">ID Number</label>
              <Input
                placeholder="Enter ID Number"
                value={formData.idNumber}
                onChange={(e) => setFormData(p => ({ ...p, idNumber: e.target.value }))}
                required
              />
            </div>
            
            <Button type="submit" className="w-full mt-6" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit Registration
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex justify-center text-sm text-muted-foreground border-t p-4">
          Already have an account?&nbsp;
          <Link href="/writer/login">
            <a className="text-primary font-medium hover:underline">Sign in</a>
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
