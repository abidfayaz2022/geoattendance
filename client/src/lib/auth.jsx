// src/lib/auth.js
import { createContext, useContext, useState, useEffect } from "react";
import { useLocation } from "wouter";

const AuthContext = createContext(null);

// Read API base URL from env; fallback to same as other frontend code
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  "https://geoattendance-asi9.onrender.com/api";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [_, setLocation] = useLocation();

  // Restore session on load
  useEffect(() => {
    try {
      // Backward-compatible: try eduTrack_user first, then authUser
      const storedEduTrack = localStorage.getItem("eduTrack_user");
      const storedAuthUser = localStorage.getItem("authUser");

      const raw = storedEduTrack || storedAuthUser;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          setUser(parsed);
        }
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
   * Response: { user, student? }  OR just { id, name, email, role, ... }
   *
   * expectedRole (optional): "student" | "admin"
   * - Use this to enforce that /admin only logs in admins, and "/" only students.
   */
  const login = async (email, password, expectedRole) => {
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

      const role = loggedInUser.role;

      // If a specific portal is expected (student/admin) and the role doesn't match, block login
      if (expectedRole && role !== expectedRole) {
        setAuthError(
          expectedRole === "admin"
            ? "This account is not an admin. Please use the student login page."
            : "This account is not a student. Please use the admin login page."
        );
        return false;
      }

      setUser(loggedInUser);

      try {
        // Persist under both keys so:
        // - Your existing code keeps using "eduTrack_user"
        // - The API client can read from "authUser" to send x-user-id / x-user-password
        const serialized = JSON.stringify(loggedInUser);
        localStorage.setItem("eduTrack_user", serialized);
        localStorage.setItem("authUser", serialized);
      } catch (err) {
        console.warn("Failed to persist user in localStorage:", err);
      }

      // Route based on actual role
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
      localStorage.removeItem("authUser");
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
