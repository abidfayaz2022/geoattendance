// src/App.jsx
import { Switch, Route, Redirect } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AuthProvider, useAuth } from "@/lib/auth";

// Pages
import LoginPage from "@/pages/login";
import StudentDashboard from "@/pages/student-dashboard";
import AdminDashboard from "@/pages/admin-dashboard";

// Simple wrapper to protect routes
function ProtectedRoute({ component: Component, role }) {
  const { user } = useAuth();

  if (!user) {
    return <Redirect to="/" />;
  }

  if (role && user.role !== role) {
    if (user.role === "admin") return <Redirect to="/admin" />;
    if (user.role === "student") return <Redirect to="/student" />;
    return <Redirect to="/" />;
  }

  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={LoginPage} />
      <Route path="/student">
        <ProtectedRoute component={StudentDashboard} role="student" />
      </Route>
      <Route path="/admin">
        <ProtectedRoute component={AdminDashboard} role="admin" />
      </Route>
      {/* Catch-all route */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
