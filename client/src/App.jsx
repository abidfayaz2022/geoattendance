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

  // Not logged in → send to login
  if (!user) {
    return <Redirect to="/" />;
  }

  // If a specific role is required and doesn't match → bounce appropriately
  if (role && user.role !== role) {
    // Basic behavior: send student to /student, admin to /admin
    if (user.role === "admin") return <Redirect to="/admin" />;
    if (user.role === "student") return <Redirect to="/student" />;
    // Fallback
    return <Redirect to="/" />;
  }

  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={LoginPage} />
      <Route path="/student">
        {/* Require any logged-in user with role "student" */}
        <ProtectedRoute component={StudentDashboard} role="student" />
      </Route>
      <Route path="/admin">
        {/* Require role "admin" */}
        <ProtectedRoute component={AdminDashboard} role="admin" />
      </Route>
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
