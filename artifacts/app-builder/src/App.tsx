import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import "@/lib/session"; // registers the Bearer-token getter for the api-client
import { Layout } from "@/components/layout";
import { Home } from "@/pages/home";
import { AiEditor } from "@/pages/ai-editor";
import { ProjectWorkspace } from "@/pages/project-workspace";
import { Privacy } from "@/pages/privacy";
import { Voorwaarden } from "@/pages/voorwaarden";
import { ClaudeConnect } from "@/pages/claude-connect";
import { Uitleg } from "@/pages/uitleg";
import { Help } from "@/pages/help";
import { Welkom } from "@/pages/welkom";
import { PlatformUitleg } from "@/pages/platform-uitleg";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/projects"><Redirect to="/ai-editor" /></Route>
      <Route path="/ai-editor" component={AiEditor} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/voorwaarden" component={Voorwaarden} />
      <Route path="/claude" component={ClaudeConnect} />
      <Route path="/uitleg" component={Uitleg} />
      <Route path="/help" component={Help} />
      <Route path="/welkom" component={Welkom} />
      <Route path="/platform-uitleg" component={PlatformUitleg} />
      <Route path="/projects/:id" component={ProjectWorkspace} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Layout>
            <Router />
          </Layout>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
