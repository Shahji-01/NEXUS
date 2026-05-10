import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FloatingCopilot } from "@/components/copilot/floating-copilot";
import NotFound from "@/pages/not-found";

import Dashboard from "@/pages/dashboard";
import Analytics from "@/pages/analytics";
import Control from "@/pages/control";
import Emergency from "@/pages/emergency";
import SignalLog from "@/pages/signal-log";
import GreenWave from "@/pages/green-wave";
import CopilotPage from "@/pages/copilot";
import Scenarios from "@/pages/scenarios";
import Carbon from "@/pages/carbon";
import Incidents from "@/pages/incidents";
import Transit from "@/pages/transit";
import Schedule from "@/pages/schedule";
import Network from "@/pages/network";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/analytics" component={Analytics} />
      <Route path="/control" component={Control} />
      <Route path="/emergency" component={Emergency} />
      <Route path="/signal-log" component={SignalLog} />
      <Route path="/green-wave" component={GreenWave} />
      <Route path="/copilot" component={CopilotPage} />
      <Route path="/scenarios" component={Scenarios} />
      <Route path="/carbon" component={Carbon} />
      <Route path="/incidents" component={Incidents} />
      <Route path="/transit" component={Transit} />
      <Route path="/schedule" component={Schedule} />
      <Route path="/network" component={Network} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
          <FloatingCopilot />
        </WouterRouter>
        <Toaster theme="dark" position="top-right" closeButton />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
