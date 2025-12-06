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

// Simple wrapper to protect routes for student dashboard
function ProtectedRoute({ component: Component, role }) {
  const { user } = useAuth();

  if (!user) {
    // Not logged in → send to appropriate login
    if (role === "admin") return <Redirect to="/admin" />;
    return <Redirect to="/" />;
  }

  if (role && user.role !== role) {
    // Logged in but wrong role → bounce to their area
    if (user.role === "admin") return <Redirect to="/admin" />;
    if (user.role === "student") return <Redirect to="/student" />;
    return <Redirect to="/" />;
  }

  return <Component />;
}

// Special wrapper for /admin path: show login if not admin, else dashboard
function AdminEntry() {
  const { user } = useAuth();

  if (!user) {
    // Not logged in → show admin login page
    return <LoginPage mode="admin" />;
  }

  if (user.role !== "admin") {
    // Logged in but not admin → push them to their area
    if (user.role === "student") return <Redirect to="/student" />;
    return <Redirect to="/" />;
  }

  // Logged in as admin → show dashboard
  return <AdminDashboard />;
}

function Router() {
  return (
    <Switch>
      {/* Default root: student login */}
      <Route path="/">
        <LoginPage mode="student" />
      </Route>

      {/* Student dashboard (protected) */}
      <Route path="/student">
        <ProtectedRoute component={StudentDashboard} role="student" />
      </Route>

      {/* Admin entry: login if logged out, dashboard if logged in as admin */}
      <Route path="/admin">
        <AdminEntry />
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
