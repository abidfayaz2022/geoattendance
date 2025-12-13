import { useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { School, Lock, User, GraduationCap } from "lucide-react";
import { motion } from "framer-motion";
import { Redirect } from "wouter";

/**
 * LoginPage
 * - mode = "student" (default) or "admin"
 * - "/"  -> <LoginPage mode="student" />
 * - "/admin" -> <LoginPage mode="admin" /> (when not logged in)
 */
export default function LoginPage({ mode = "student" }) {
  const { login, authError, user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isStudent = mode === "student";

  // If already logged in, send them to their dashboard
  if (user) {
    if (user.role === "admin") {
      return <Redirect to="/admin" />;
    }
    if (user.role === "student") {
      return <Redirect to="/student" />;
    }
  }

  const handleLogin = async (e) => {
    e.preventDefault();
    setLocalError("");

    if (!email.trim()) {
      setLocalError("Email is required");
      return;
    }

    if (password.length < 3) {
      setLocalError("Password must be at least 3 characters");
      return;
    }

    try {
      setSubmitting(true);

      // pass role to login: "student" or "admin"
      const success = await login(email, password, isStudent ? "student" : "admin");

      if (!success) {
        setLocalError("Invalid email or password");
      }
    } catch (err) {
      console.error("Login error:", err);
      setLocalError(
        err?.message || "Something went wrong during login. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const combinedError = localError || authError;

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-slate-900 dark:to-slate-800 p-4">
      {/* Decorative background elements */}
      <div className="absolute top-20 left-20 w-64 h-64 bg-blue-300 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob"></div>
      <div className="absolute top-40 right-20 w-64 h-64 bg-purple-300 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-2000"></div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md z-10"
      >
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary text-primary-foreground mb-4 shadow-lg shadow-primary/20">
            <School className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white mb-2">
            KIE
          </h1>
          <p className="text-slate-500 dark:text-slate-400">
            Secure KIE Attendance System
          </p>
        </div>

        <Card className="border-none shadow-xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-lg">
          <CardHeader>
            <CardTitle>
              {isStudent ? "Student / Parent Login" : "Administrator Login"}
            </CardTitle>
            <CardDescription>
              {isStudent
                ? "Sign in to mark your attendance and view records."
                : "Sign in to access admin controls and reports."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LoginFormFields
              mode={mode}
              email={email}
              setEmail={setEmail}
              password={password}
              setPassword={setPassword}
              error={combinedError}
              submitting={submitting}
              onSubmit={handleLogin}
            />
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

function LoginFormFields({
  mode,
  email,
  setEmail,
  password,
  setPassword,
  error,
  submitting,
  onSubmit,
}) {
  const isStudent = mode === "student";

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`email-${mode}`}>Email</Label>
        <div className="relative">
          <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            id={`email-${mode}`}
            placeholder={
              isStudent ? "e.g., student@example.com" : "e.g., admin@example.com"
            }
            className="pl-9 bg-white dark:bg-slate-950/50"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`password-${mode}`}>Password</Label>
        <div className="relative">
          <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            id={`password-${mode}`}
            type="password"
            placeholder="••••••••"
            className="pl-9 bg-white dark:bg-slate-950/50"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-500 font-medium animate-in fade-in slide-in-from-left-1">
          {error}
        </p>
      )}

      <Button
        type="submit"
        className="w-full h-11 text-base font-medium shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all"
        disabled={submitting}
      >
        {isStudent ? (
          <>
            <GraduationCap className="mr-2 h-4 w-4" />
            {submitting ? "Logging in..." : "Student Login"}
          </>
        ) : (
          <>
            <School className="mr-2 h-4 w-4" />
            {submitting ? "Logging in..." : "Admin Login"}
          </>
        )}
      </Button>
    </form>
  );
}
