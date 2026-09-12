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
import { Settings } from "@/pages/settings";
import { Games } from "@/pages/games";
import { AgentDetail } from "@/pages/agent-detail";
import { Sales } from "@/pages/sales";
import { GrossEntries } from "@/pages/gross-entries";
import { WinsEntries } from "@/pages/wins-entries";
import { GrossWins } from "@/pages/gross-wins";
import { Payments } from "@/pages/payments";
import { Calculations } from "@/pages/calculations";
import { Reports } from "@/pages/reports";
import { Reserve } from "@/pages/reserve";
import { ReserveReceipts } from "@/pages/reserve-receipts";
import { Notifications } from "@/pages/notifications";
import { MyWriters } from "@/pages/my-writers";
import { WinsDebt } from "@/pages/wins-debt";
import { AgencyDashboard } from "@/pages/agency-dashboard";
import { EntryChangeRequests } from "@/pages/entry-change-requests";
import { OnlinePayment } from "@/pages/online-payment";
import { AgencyStaffExpenses } from "@/pages/agency-staff-expenses";
import { StaffsEmployees } from "@/pages/staffs-employees";
import { CompanyExpenses } from "@/pages/company-expenses";
import { Inventory } from "@/pages/inventory";

// Writer Pages
import { WriterLogin } from "@/pages/writer-login";
import { WriterRegister } from "@/pages/writer-register";
import { WriterDashboard } from "@/pages/writer-dashboard";
import { WriterPlaceBet } from "@/pages/writer-place-bet";
import { WriterTickets } from "@/pages/writer-tickets";
import { WriterWallet } from "@/pages/writer-wallet";
import { WriterLayout } from "@/components/writer-layout";

// Admin Pages
import { AdminBetTypes } from "@/pages/admin-bet-types";
import { AdminGameResults } from "@/pages/admin-game-results";
import { AdminRiskManagement } from "@/pages/admin-risk-management";
import { AdminPostpaidSettlement } from "@/pages/admin-postpaid-settlement";
import { AdminWriterApprovals } from "@/pages/admin-writer-approvals";
import { TicketLookup } from "@/pages/ticket-lookup";

import { Layout } from "@/components/layout";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      refetchOnMount: true,
      retry: 1,
    },
  },
});

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
        {() => <ProtectedRoute component={Users} roles={['administrator', 'director', 'cashier']} />}
      </Route>

      <Route path="/agency-staff-expenses">
        {() => <ProtectedRoute component={AgencyStaffExpenses} roles={['cashier', 'administrator', 'director']} />}
      </Route>

      <Route path="/company-expenses">
        {() => <ProtectedRoute component={CompanyExpenses} roles={['cashier', 'administrator', 'director']} />}
      </Route>

      <Route path="/staffs-employees">
        {() => <ProtectedRoute component={StaffsEmployees} roles={['cashier', 'administrator', 'director']} />}
      </Route>

      <Route path="/agents/:agentId/detail">
        {() => <ProtectedRoute component={AgentDetail} roles={['director', 'administrator']} />}
      </Route>

      <Route path="/games">
        {() => <ProtectedRoute component={Games} roles={['administrator', 'director']} />}
      </Route>

      {/* Admin Added Routes */}
      <Route path="/bet-types">
        {() => <ProtectedRoute component={AdminBetTypes} roles={['administrator', 'director']} />}
      </Route>
      <Route path="/game-results">
        {() => <ProtectedRoute component={AdminGameResults} roles={['administrator', 'director']} />}
      </Route>
      <Route path="/risk-management">
        {() => <ProtectedRoute component={AdminRiskManagement} roles={['administrator', 'director']} />}
      </Route>
      <Route path="/postpaid-settlement">
        {() => <ProtectedRoute component={AdminPostpaidSettlement} roles={['administrator', 'director', 'cashier']} />}
      </Route>
      <Route path="/writer-approvals">
        {() => <ProtectedRoute component={AdminWriterApprovals} roles={['administrator', 'director']} />}
      </Route>

      {/* Writer Routes */}
      <Route path="/ticket-lookup">
        {() => <ProtectedRoute component={TicketLookup} roles={['director', 'administrator', 'cashier', 'agent']} />}
      </Route>

      <Route path="/writer/login" component={WriterLogin} />
      <Route path="/writer/register" component={WriterRegister} />
      <Route path="/writer/dashboard">
        {() => (
          <WriterLayout>
             <ProtectedRoute component={WriterDashboard} roles={['writer']} />
          </WriterLayout>
        )}
      </Route>
      <Route path="/writer/place-bet">
        {() => (
          <WriterLayout>
             <ProtectedRoute component={WriterPlaceBet} roles={['writer']} />
          </WriterLayout>
        )}
      </Route>
      <Route path="/writer/tickets">
        {() => (
          <WriterLayout>
             <ProtectedRoute component={WriterTickets} roles={['writer']} />
          </WriterLayout>
        )}
      </Route>
      <Route path="/writer/wallet">
        {() => (
          <WriterLayout>
             <ProtectedRoute component={WriterWallet} roles={['writer']} />
          </WriterLayout>
        )}
      </Route>

      <Route path="/settings">
        {() => <ProtectedRoute component={Settings} roles={['administrator', 'director']} />}
      </Route>

      <Route path="/sales">
        {() => <ProtectedRoute component={Sales} roles={['agent', 'administrator']} />}
      </Route>

      <Route path="/gross-wins">
        {() => <ProtectedRoute component={GrossWins} roles={['director', 'administrator']} />}
      </Route>

      <Route path="/entries/gross">
        {() => <ProtectedRoute component={GrossEntries} roles={['gross_entry', 'agent']} />}
      </Route>

      <Route path="/entries/wins">
        {() => <ProtectedRoute component={WinsEntries} roles={['wins_entry', 'agent']} />}
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

      <Route path="/inventory">
        {() => <ProtectedRoute component={Inventory} roles={['cashier', 'administrator', 'director']} />}
      </Route>

      <Route path="/reserve-receipts">
        {() => <ProtectedRoute component={ReserveReceipts} roles={['cashier', 'administrator']} />}
      </Route>

      <Route path="/my-writers">
        {() => <ProtectedRoute component={MyWriters} roles={["agent"]} />}
      </Route>

      <Route path="/online-payment">
        {() => <ProtectedRoute component={OnlinePayment} roles={["agent"]} />}
      </Route>

      <Route path="/wins-debt">
        {() => <ProtectedRoute component={WinsDebt} roles={["director", "administrator"]} />}
      </Route>

      <Route path="/agencies">
        {() => <ProtectedRoute component={AgencyDashboard} roles={["director", "administrator"]} />}
      </Route>

      <Route path="/entry-change-requests">
        {() => <ProtectedRoute component={EntryChangeRequests} roles={['agent', 'administrator', 'director']} />}
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
