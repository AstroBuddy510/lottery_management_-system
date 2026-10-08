import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth-provider";
import { useAuth } from "@/lib/auth";

// Pages
import NotFound from "@/pages/not-found";
import { Login } from "@/pages/login";

// Writer Pages

import { WriterLogin } from "@/pages/writer-login";

import { WriterLayout } from "@/components/writer-layout";

// Admin Pages

import { Layout } from "@/components/layout";

/**
 * Routes load when they are visited.
 *
 * Every page used to be imported at the top of this file, so one chunk
 * carried all 42 of them plus everything they pull in - the PDF generator,
 * the charting library, the map - and a writer on mobile data downloaded
 * and parsed the lot before the login screen painted, to use three screens.
 *
 * The login screens stay eager: they are the first thing anyone sees, and
 * making them lazy would add a round trip before anything is on screen.
 *
 * The pages export names rather than defaults, hence the .then() that hands
 * React.lazy the default shape it expects.
 */
const Dashboard = lazy(() => import("@/pages/dashboard").then((m) => ({ default: m.Dashboard })));
const Users = lazy(() => import("@/pages/users").then((m) => ({ default: m.Users })));
const Settings = lazy(() => import("@/pages/settings").then((m) => ({ default: m.Settings })));
const Games = lazy(() => import("@/pages/games").then((m) => ({ default: m.Games })));
const AgentDetail = lazy(() => import("@/pages/agent-detail").then((m) => ({ default: m.AgentDetail })));
const Sales = lazy(() => import("@/pages/sales").then((m) => ({ default: m.Sales })));
const GrossEntries = lazy(() => import("@/pages/gross-entries").then((m) => ({ default: m.GrossEntries })));
const WinsEntries = lazy(() => import("@/pages/wins-entries").then((m) => ({ default: m.WinsEntries })));
const GrossWins = lazy(() => import("@/pages/gross-wins").then((m) => ({ default: m.GrossWins })));
const Payments = lazy(() => import("@/pages/payments").then((m) => ({ default: m.Payments })));
const Calculations = lazy(() => import("@/pages/calculations").then((m) => ({ default: m.Calculations })));
const Reports = lazy(() => import("@/pages/reports").then((m) => ({ default: m.Reports })));
const Reserve = lazy(() => import("@/pages/reserve").then((m) => ({ default: m.Reserve })));
const ReserveReceipts = lazy(() => import("@/pages/reserve-receipts").then((m) => ({ default: m.ReserveReceipts })));
const Notifications = lazy(() => import("@/pages/notifications").then((m) => ({ default: m.Notifications })));
const MyWriters = lazy(() => import("@/pages/my-writers").then((m) => ({ default: m.MyWriters })));
const WinsDebt = lazy(() => import("@/pages/wins-debt").then((m) => ({ default: m.WinsDebt })));
const AgencyDashboard = lazy(() => import("@/pages/agency-dashboard").then((m) => ({ default: m.AgencyDashboard })));
const EntryChangeRequests = lazy(() => import("@/pages/entry-change-requests").then((m) => ({ default: m.EntryChangeRequests })));
const OnlinePayment = lazy(() => import("@/pages/online-payment").then((m) => ({ default: m.OnlinePayment })));
const AgencyStaffExpenses = lazy(() => import("@/pages/agency-staff-expenses").then((m) => ({ default: m.AgencyStaffExpenses })));
const StaffsEmployees = lazy(() => import("@/pages/staffs-employees").then((m) => ({ default: m.StaffsEmployees })));
const CompanyExpenses = lazy(() => import("@/pages/company-expenses").then((m) => ({ default: m.CompanyExpenses })));
const Inventory = lazy(() => import("@/pages/inventory").then((m) => ({ default: m.Inventory })));
const TokenSales = lazy(() => import("@/pages/token-sales").then((m) => ({ default: m.TokenSales })));
const WriterRegister = lazy(() => import("@/pages/writer-register").then((m) => ({ default: m.WriterRegister })));
const WriterDashboard = lazy(() => import("@/pages/writer-dashboard").then((m) => ({ default: m.WriterDashboard })));
const WriterPlaceBet = lazy(() => import("@/pages/writer-place-bet").then((m) => ({ default: m.WriterPlaceBet })));
const WriterTickets = lazy(() => import("@/pages/writer-tickets").then((m) => ({ default: m.WriterTickets })));
const WriterWallet = lazy(() => import("@/pages/writer-wallet").then((m) => ({ default: m.WriterWallet })));
const AdminRiskManagement = lazy(() => import("@/pages/admin-risk-management").then((m) => ({ default: m.AdminRiskManagement })));
const TicketLookup = lazy(() => import("@/pages/ticket-lookup").then((m) => ({ default: m.TicketLookup })));


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

function ProtectedRoute({ component: Component, roles, bare }: { component: React.ComponentType, roles?: string[], bare?: boolean }) {
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

  // Writer routes supply their own chrome (WriterLayout). Wrapping them in the
  // admin Layout as well nested two layouts and rendered its fixed w-56
  // sidebar on phones, squeezing the content into the remaining strip.
  if (bare) {
    return <Component />;
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
      <Route path="/risk-management">
        {() => <ProtectedRoute component={AdminRiskManagement} roles={['administrator', 'director']} />}
      </Route>

      {/* These screens now live as tabs inside other sections. The old paths
          redirect so existing bookmarks and links keep working. */}
      <Route path="/bet-types">{() => <Redirect to="/settings" />}</Route>
      <Route path="/game-results">{() => <Redirect to="/calculations" />}</Route>
      <Route path="/postpaid-settlement">{() => <Redirect to="/payments" />}</Route>
      <Route path="/writer-approvals">{() => <Redirect to="/users" />}</Route>

      {/* Writer Routes */}
      <Route path="/ticket-lookup">
        {() => <ProtectedRoute component={TicketLookup} roles={['director', 'administrator', 'cashier', 'agent']} />}
      </Route>

      <Route path="/writer/login" component={WriterLogin} />
      <Route path="/writer/register" component={WriterRegister} />
      <Route path="/writer/dashboard">
        {() => (
          <WriterLayout>
             <ProtectedRoute component={WriterDashboard} roles={['writer']} bare />
          </WriterLayout>
        )}
      </Route>
      <Route path="/writer/place-bet">
        {() => (
          <WriterLayout>
             <ProtectedRoute component={WriterPlaceBet} roles={['writer']} bare />
          </WriterLayout>
        )}
      </Route>
      <Route path="/writer/tickets">
        {() => (
          <WriterLayout>
             <ProtectedRoute component={WriterTickets} roles={['writer']} bare />
          </WriterLayout>
        )}
      </Route>
      <Route path="/writer/wallet">
        {() => (
          <WriterLayout>
             <ProtectedRoute component={WriterWallet} roles={['writer']} bare />
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
        {() => <ProtectedRoute component={Payments} roles={['cashier', 'administrator', 'director']} />}
      </Route>

      <Route path="/token-sales">
        {() => (
          <ProtectedRoute
            component={TokenSales}
            roles={['cashier', 'administrator', 'director']}
          />
        )}
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
            {/* A route's chunk arrives over the network, so there is a moment
                with nothing to render. This is what fills it - deliberately
                the same wording and layout as the auth check above, so a
                slow connection shows one steady "Loading..." rather than two
                different ones flickering past each other. */}
            <Suspense
              fallback={
                <div className="flex h-screen items-center justify-center">Loading...</div>
              }
            >
              <Router />
            </Suspense>
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
