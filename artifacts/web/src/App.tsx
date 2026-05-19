import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth-provider";
import { useAuth } from "@/lib/auth";

// Pages
import NotFound from "@/pages/not-found";
import { Login } from "@/pages/login";
import { Dashboard } from "@/pages/dashboard";
import { Users } from "@/pages/users";
import { Agents } from "@/pages/agents";
import { Settings } from "@/pages/settings";
import { Games } from "@/pages/games";
import { AgentDetail } from "@/pages/agent-detail";
import { Sales } from "@/pages/sales";
import { GrossEntries } from "@/pages/gross-entries";
import { WinsEntries } from "@/pages/wins-entries";
import { Payments } from "@/pages/payments";
import { Calculations } from "@/pages/calculations";
import { Reports } from "@/pages/reports";
import { Reserve } from "@/pages/reserve";
import { Notifications } from "@/pages/notifications";
import { MyWriters } from "@/pages/my-writers";

import { Layout } from "@/components/layout";

const queryClient = new QueryClient();

function ProtectedRoute({ component: Component, roles }: { component: React.ComponentType, roles?: string[] }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center">Loading...</div>;
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  if (roles && !roles.includes(user.role)) {
    return <Redirect to="/dashboard" />;
  }

  return (
    <Layout>
      <Component />
    </Layout>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      
      <Route path="/">
        <Redirect to="/dashboard" />
      </Route>

      <Route path="/dashboard">
        {() => <ProtectedRoute component={Dashboard} />}
      </Route>
      
      <Route path="/users">
        {() => <ProtectedRoute component={Users} roles={['director', 'administrator']} />}
      </Route>

      <Route path="/agents">
        {() => <ProtectedRoute component={Agents} roles={['director', 'administrator']} />}
      </Route>

      <Route path="/agents/:agentId/detail">
        {() => <ProtectedRoute component={AgentDetail} roles={['director', 'administrator']} />}
      </Route>

      <Route path="/games">
        {() => <ProtectedRoute component={Games} roles={['director', 'administrator']} />}
      </Route>

      <Route path="/settings">
        {() => <ProtectedRoute component={Settings} roles={['director', 'administrator']} />}
      </Route>

      <Route path="/sales">
        {() => <ProtectedRoute component={Sales} roles={['agent', 'administrator']} />}
      </Route>

      <Route path="/entries/gross">
        {() => <ProtectedRoute component={GrossEntries} roles={['gross_entry', 'administrator']} />}
      </Route>

      <Route path="/entries/wins">
        {() => <ProtectedRoute component={WinsEntries} roles={['wins_entry', 'administrator']} />}
      </Route>

      <Route path="/payments">
        {() => <ProtectedRoute component={Payments} roles={['cashier', 'administrator']} />}
      </Route>

      <Route path="/calculations">
        {() => <ProtectedRoute component={Calculations} roles={['director', 'administrator']} />}
      </Route>

      <Route path="/reports">
        {() => <ProtectedRoute component={Reports} roles={['director', 'administrator', 'cashier']} />}
      </Route>

      <Route path="/reserve">
        {() => <ProtectedRoute component={Reserve} roles={['director', 'administrator']} />}
      </Route>

      <Route path="/my-writers">
        {() => <ProtectedRoute component={MyWriters} roles={["agent"]} />}
      </Route>

      <Route path="/notifications">
        {() => <ProtectedRoute component={Notifications} />}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
