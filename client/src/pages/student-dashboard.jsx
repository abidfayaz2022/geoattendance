import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  MapPin,
  LogOut,
  CheckCircle2,
  RefreshCw,
  History,
} from "lucide-react";
// import { motion } from "framer-motion"; // not used currently
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "https://geoattendance-zeta.vercel.app/api";

export default function StudentDashboard() {
  const { user, logout } = useAuth();
  const [_, setLocation] = useLocation();
  const { toast } = useToast();

  const [currentLocation, setCurrentLocation] = useState(null);
  const [distance, setDistance] = useState(null);
  const [inRange, setInRange] = useState(false);

  const [geofence, setGeofence] = useState(null);
  const [attendanceHistory, setAttendanceHistory] = useState([]);

  const [loadingLocation, setLoadingLocation] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [loadingGeofence, setLoadingGeofence] = useState(true);

  const studentId = user?.id || null;

  // Redirect if not logged in
  useEffect(() => {
    if (!user) setLocation("/");
  }, [user, setLocation]);

  // Fetch geofence + history when user present
  useEffect(() => {
    if (!user || !studentId) return;

    let cancelled = false;

    async function loadStudentData() {
      try {
        setLoadingGeofence(true);
        setLoadingHistory(true);

        const geofenceUrl = `${API_BASE_URL}/student/geofence${
          studentId ? `?studentId=${studentId}` : ""
        }`;
        const historyUrl = `${API_BASE_URL}/student/attendance-history?studentId=${studentId}`;

        const [geofenceRes, historyRes] = await Promise.all([
          fetch(geofenceUrl, {
            credentials: "include",
          }),
          fetch(historyUrl, {
            credentials: "include",
          }),
        ]);

        if (!cancelled) {
          if (geofenceRes.ok) {
            const gf = await geofenceRes.json();
            setGeofence(gf);
          } else {
            console.warn("Failed to load geofence");
          }

          if (historyRes.ok) {
            const historyJson = await historyRes.json();
            setAttendanceHistory(Array.isArray(historyJson) ? historyJson : []);
          } else {
            console.warn("Failed to load attendance history");
          }
        }
      } catch (err) {
        console.error("Failed to load student data:", err);
        if (!cancelled) {
          toast({
            variant: "destructive",
            title: "Error",
            description:
              "Could not load your attendance data. Please refresh the page.",
          });
        }
      } finally {
        if (!cancelled) {
          setLoadingGeofence(false);
          setLoadingHistory(false);
        }
      }
    }

    loadStudentData();

    return () => {
      cancelled = true;
    };
  }, [user, studentId, toast]);

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // metres
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  };

  const getCurrentPosition = () =>
    new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation is not supported by your browser"));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      });
    });

  const refreshLocation = async () => {
    if (!geofence) {
      toast({
        title: "Location Rules Unavailable",
        description: "Geofence is not configured yet. Please contact admin.",
        variant: "destructive",
      });
      return;
    }

    setLoadingLocation(true);
    try {
      const pos = await getCurrentPosition();
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const accuracy = pos.coords.accuracy;

      setCurrentLocation({ lat, lng, accuracy });

      const dist = calculateDistance(
        lat,
        lng,
        Number(geofence.centerLat),
        Number(geofence.centerLng)
      );
      const rounded = Math.round(dist);
      setDistance(rounded);
      setInRange(rounded <= Number(geofence.radiusMeters));

      toast({
        title: "Location Updated",
        description: `Current distance from campus: ${rounded}m (accuracy ~${Math.round(
          accuracy
        )}m)`,
      });
    } catch (err) {
      console.error("Failed to get location:", err);
      toast({
        variant: "destructive",
        title: "Location Error",
        description:
          err?.message ||
          "Could not get your location. Please enable GPS and try again.",
      });
    } finally {
      setLoadingLocation(false);
    }
  };

  // Optional dev helper: pretend we stand at center of geofence
  const teleportToSchool = () => {
    if (!geofence) return;

    const lat = Number(geofence.centerLat);
    const lng = Number(geofence.centerLng);

    setCurrentLocation({ lat, lng, accuracy: 0 });
    setDistance(0);
    setInRange(true);
    toast({
      title: "Location Updated",
      description: "Simulated: you are now at the school location.",
    });
  };

  const markAttendance = async () => {
    if (!user || !studentId) return;

    if (!geofence) {
      toast({
        variant: "destructive",
        title: "Not Configured",
        description:
          "Attendance location rules are not configured yet. Please contact admin.",
      });
      return;
    }

    if (!currentLocation) {
      toast({
        variant: "destructive",
        title: "Location Required",
        description:
          "Please refresh your GPS location before marking attendance.",
      });
      return;
    }

    if (!inRange) {
      toast({
        variant: "destructive",
        title: "Too Far",
        description:
          "You must be within the allowed radius of campus to check in.",
      });
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/student/attendance/check-in`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          studentId,
          lat: currentLocation.lat,
          lng: currentLocation.lng,
          accuracy: currentLocation.accuracy,
          // deviceId: you can send something here if you want
        }),
      });

      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        toast({
          variant: "destructive",
          title: "Already Checked In",
          description:
            body?.message || "You have already marked attendance for today.",
        });
        return;
      }

      if (!res.ok) {
        const txt = (await res.text()) || res.statusText;
        throw new Error(txt);
      }

      const data = await res.json();
      const rec = data.record || data;

      // Normalise the record to the same shape as history items
      const historyItem = {
        id: rec.id,
        date: rec.checkInAt || rec.date || new Date(),
        time: rec.checkInAt
          ? new Date(rec.checkInAt).toISOString()
          : rec.time || null,
        status: rec.status || "present",
        location:
          rec.checkInLat != null && rec.checkInLng != null
            ? {
                lat: Number(rec.checkInLat),
                lng: Number(rec.checkInLng),
              }
            : rec.location || null,
      };

      setAttendanceHistory((prev) => [historyItem, ...(prev || [])]);

      const displayDate = historyItem.date
        ? new Date(historyItem.date)
        : new Date();

      toast({
        title: "Attendance Marked!",
        description: `Checked in successfully at ${format(
          displayDate,
          "hh:mm a"
        )}`,
        className:
          "bg-green-50 border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-900",
      });
    } catch (err) {
      console.error("Failed to mark attendance:", err);
      toast({
        variant: "destructive",
        title: "Error",
        description:
          err?.message ||
          "Something went wrong while marking attendance. Please try again.",
      });
    }
  };

  if (!user) return null;

  const geofenceRadius = geofence ? Number(geofence.radiusMeters) : null;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-20">
      {/* Header */}
      <header className="bg-white dark:bg-slate-900 border-b sticky top-0 z-10 px-4 py-4 shadow-sm">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden border border-primary/20">
              {user.avatar && (
                <img
                  src={user.avatar}
                  alt={user.email || user.fullName}
                  className="w-full h-full object-cover"
                />
              )}
            </div>
            <div>
              <h1 className="font-heading font-bold text-lg leading-tight">
                {user.fullName || user.name || user.email}
              </h1>
              <p className="text-xs text-muted-foreground">
                {user.grade || "Student"}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={logout}>
            <LogOut className="w-5 h-5 text-slate-500" />
          </Button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Status Card */}
        <Card className="overflow-hidden border-none shadow-lg">
          <div
            className={`h-2 w-full ${
              inRange ? "bg-green-500" : "bg-amber-500"
            }`}
          />
          <CardHeader className="pb-2">
            <div className="flex justify-between items-start">
              <div>
                <CardTitle className="text-xl">Attendance Check</CardTitle>
                <CardDescription>
                  Mark your daily attendance securely.
                </CardDescription>
              </div>
              <Badge
                variant={inRange ? "default" : "secondary"}
                className={
                  inRange
                    ? "bg-green-100 text-green-700 hover:bg-green-100 border-green-200"
                    : "bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200"
                }
              >
                {inRange ? "In Range" : "Out of Range"}
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            <div className="flex flex-col items-center justify-center py-4">
              <div className="relative">
                {/* Ripple Effect when in range */}
                {inRange && (
                  <>
                    <div className="absolute inset-0 rounded-full bg-green-500/20 animate-ping duration-1000" />
                    <div className="absolute inset-[-10px] rounded-full bg-green-500/10 animate-pulse duration-2000" />
                  </>
                )}

                <Button
                  size="lg"
                  className={`w-40 h-40 rounded-full flex flex-col gap-2 text-lg font-bold shadow-xl transition-all active:scale-95
                    ${
                      inRange
                        ? "bg-gradient-to-b from-green-500 to-green-600 hover:from-green-400 hover:to-green-500 border-4 border-green-100"
                        : "bg-slate-200 text-slate-400 cursor-not-allowed hover:bg-slate-200 border-4 border-slate-100"
                    }`}
                  disabled={!inRange}
                  onClick={markAttendance}
                >
                  <MapPin
                    className={`w-10 h-10 ${inRange ? "animate-bounce" : ""}`}
                  />
                  {inRange ? "CHECK IN" : "TOO FAR"}
                </Button>
              </div>

              <div className="mt-6 text-center space-y-1">
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300 flex items-center justify-center gap-2">
                  Current Distance:
                  {loadingLocation ? (
                    <span className="w-12 h-4 bg-slate-200 animate-pulse rounded" />
                  ) : distance == null ? (
                    <span className="text-slate-400 text-xs">
                      GPS not updated
                    </span>
                  ) : (
                    <span
                      className={
                        inRange ? "text-green-600" : "text-amber-600"
                      }
                    >
                      {distance}m
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {loadingGeofence
                    ? "Loading allowed radius…"
                    : geofenceRadius
                    ? `Must be within ${geofenceRadius}m of campus`
                    : "Campus geofence not configured"}
                </p>
              </div>
            </div>

            {/* Controls */}
            <div className="flex gap-2 justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={refreshLocation}
                disabled={loadingLocation}
              >
                <RefreshCw
                  className={`w-3 h-3 mr-2 ${
                    loadingLocation ? "animate-spin" : ""
                  }`}
                />
                Refresh GPS
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={teleportToSchool}
              >
                Simulate "At School"
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* History Section */}
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <History className="w-5 h-5 text-primary" />
            Recent Activity
          </h2>
          <Card>
            <ScrollArea className="h-[300px]">
              <div className="divide-y dark:divide-slate-800">
                {loadingHistory ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">
                    Loading attendance history…
                  </div>
                ) : attendanceHistory.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    No attendance records found.
                  </div>
                ) : (
                  attendanceHistory.map((record) => (
                    <div
                      key={record.id}
                      className="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/20 flex items-center justify-center text-green-600 dark:text-green-400">
                          <CheckCircle2 className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="font-medium text-sm">
                            {record.date
                              ? format(
                                  new Date(record.date),
                                  "EEEE, MMMM do"
                                )
                              : "—"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Checked in at{" "}
                            {record.time ||
                              (record.date &&
                                format(new Date(record.date), "hh:mm a")) ||
                              "—"}
                          </p>
                        </div>
                      </div>
                      <Badge variant="outline" className="font-normal">
                        {(record.status || "Present").toString()}
                      </Badge>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </Card>
        </div>
      </main>
    </div>
  );
}
