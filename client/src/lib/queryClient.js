// src/lib/apiClient.js (or wherever you keep it)
import { QueryClient } from "@tanstack/react-query";

// Read API base URL from env; fallback to same-origin relative if not set
// Example .env: VITE_API_BASE_URL="https://geoattendance-asi9.onrender.com/api"
export const API_BASE_URL = "https://geoattendance-asi9.onrender.com/api" || "";

/**
 * Build a full URL from a relative path or segments.
 *
 * - If given an absolute URL (http/https), returns as-is.
 * - If API_BASE_URL is set, prefixes it and normalises slashes.
 * - If API_BASE_URL is empty, uses the path as-is (same-origin, no prefix).
 *
 * Examples:
 *   buildUrl("/auth/login")            -> "https://geoattendance-asi9.onrender.com/api/auth/login"
 *   buildUrl(["student", "attendance"]) -> "http://.../api/student/attendance"
 */
export function buildUrl(pathOrSegments) {
  // If caller already passed an absolute URL, don't touch it
  if (
    typeof pathOrSegments === "string" &&
    /^https?:\/\//i.test(pathOrSegments)
  ) {
    return pathOrSegments;
  }

  const segments = Array.isArray(pathOrSegments)
    ? pathOrSegments
    : [String(pathOrSegments || "")];

  // Join segments, avoiding accidental double slashes
  const path = segments
    .filter(Boolean)
    .join("/")
    .replace(/\/{2,}/g, "/");

  if (!API_BASE_URL) {
    // No base set → use relative path as-is
    return path.startsWith("/") ? path : `/${path}`;
  }

  const base = API_BASE_URL.replace(/\/+$/, "");
  const cleanPath = path.replace(/^\/+/, "");
  return `${base}/${cleanPath}`;
}

async function throwIfResNotOk(res) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

/**
 * Generic API request helper for mutations / ad-hoc calls.
 *
 * Usage:
 *   const res = await apiRequest("POST", "/auth/login", { email, password });
 *   const data = await res.json();
 */
export async function apiRequest(method, url, data) {
  const finalUrl = buildUrl(url);

  const res = await fetch(finalUrl, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

/**
 * React Query default queryFn builder.
 *
 * It expects queryKey as an array, e.g.:
 *   ["classes"]             → GET {API_BASE_URL}/classes
 *   ["sessions", classId]   → GET {API_BASE_URL}/sessions/{classId}
 *
 * If you need query params, you can either:
 *   - encode them in the last segment (e.g. ["student/attendance-history?studentId=123"])
 *   - or build the URL yourself and pass a single string queryKey.
 */
export const getQueryFn =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = buildUrl(queryKey);

    const res = await fetch(url, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
