import { createContext, useContext, useState, useEffect } from "react";
import { useLocation } from "wouter";

const AuthContext = createContext(null);

// Read API base URL from env; fallback to same as other frontend code
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "https://geoattendance-asi9.onrender.com/api";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [_, setLocation] = useLocation();

  // Restore session on load
  useEffect(() => {
    try {
      const storedUser = localStorage.getItem("eduTrack_user");
      if (storedUser) {
        setUser(JSON.parse(storedUser));
      }
    } catch (err) {
      console.error("Failed to restore auth session:", err);
    } finally {
      setIsRestoring(false);
    }
  }, []);

  /**
   * Login against backend
   * Backend route: POST /auth/login
   * Body: { email, password }
   * Response (recommended): { user, student? }
   *   - user: row from users table
   *   - student: row from students table (for role === "student")
   */
  const login = async (email, password) => {
    setAuthError(null);

    try {
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        const message =
          errorBody?.error || errorBody?.message || "Invalid credentials";
        setAuthError(message);
        return false;
      }

      const data = await res.json();

      // Support both shapes:
      // 1) { user, student }
      // 2) { id, name, email, role, ... } (user only)
      const rawUser = data.user || data;
      const student = data.student || data.studentProfile || null;

      const loggedInUser = {
        ...rawUser,
        ...(student && {
          studentId: student.id,
          grade: student.grade,
          centerId: student.centerId,
        }),
      };

      setUser(loggedInUser);

      try {
        localStorage.setItem("eduTrack_user", JSON.stringify(loggedInUser));
      } catch (err) {
        console.warn("Failed to persist user in localStorage:", err);
      }

      // Route based on role
      const role = loggedInUser.role;
      if (role === "admin") {
        setLocation("/admin");
      } else {
        // default to student dashboard
        setLocation("/student");
      }

      return true;
    } catch (err) {
      console.error("Login error:", err);
      setAuthError("Something went wrong. Please try again.");
      return false;
    }
  };

  const logout = () => {
    setUser(null);
    setAuthError(null);
    try {
      localStorage.removeItem("eduTrack_user");
    } catch (err) {
      console.warn("Failed to clear user from localStorage:", err);
    }
    setLocation("/");
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isRestoring,
        authError,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
