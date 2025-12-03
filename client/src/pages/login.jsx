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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { GraduationCap, School, Lock, User } from "lucide-react";
import { motion } from "framer-motion";

export default function LoginPage() {
  const { login, authError } = useAuth(); // authError is optional if you wired it
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState("");
  const [activeTab, setActiveTab] = useState("student"); // "student" | "admin"
  const [submitting, setSubmitting] = useState(false);

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

      // Recommended: login(email, password, role)
      const success = await login(email, password, activeTab);
      // If your login only accepts (email, password), just do:
      // const success = await login(email, password);

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
            Secure Geo-fenced Attendance System
          </p>
        </div>

        <Card className="border-none shadow-xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-lg">
          <CardHeader>
            <CardTitle>Welcome Back</CardTitle>
            <CardDescription>Sign in to your account to continue</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs
              defaultValue="student"
              value={activeTab}
              onValueChange={setActiveTab}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="student">Student/Parent</TabsTrigger>
                <TabsTrigger value="admin">Administrator</TabsTrigger>
              </TabsList>

              {/* We only need a single form; role is taken from activeTab */}
              <TabsContent value="student">
                <LoginFormFields
                  activeTab={activeTab}
                  email={email}
                  setEmail={setEmail}
                  password={password}
                  setPassword={setPassword}
                  error={combinedError}
                  submitting={submitting}
                  onSubmit={handleLogin}
                />
              </TabsContent>

              <TabsContent value="admin">
                <LoginFormFields
                  activeTab={activeTab}
                  email={email}
                  setEmail={setEmail}
                  password={password}
                  setPassword={setPassword}
                  error={combinedError}
                  submitting={submitting}
                  onSubmit={handleLogin}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

// Reusable form fields so both tabs show same form, just different CTA text / placeholder
function LoginFormFields({
  activeTab,
  email,
  setEmail,
  password,
  setPassword,
  error,
  submitting,
  onSubmit,
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`email-${activeTab}`}>Email</Label>
        <div className="relative">
          <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            id={`email-${activeTab}`}
            placeholder={activeTab === "student" ? "e.g., john" : "e.g., admin"}
            className="pl-9 bg-white dark:bg-slate-950/50"
            value={email}
            onChange={(e) => setEmail (e.target.value)}
            autoComplete="username"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`password-${activeTab}`}>Password</Label>
        <div className="relative">
          <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            id={`password-${activeTab}`}
            type="password"
            placeholder="••••••••"
            className="pl-9 bg-white dark:bg-slate-950/50"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
      </div >

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
        {activeTab === "student" ? (
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
