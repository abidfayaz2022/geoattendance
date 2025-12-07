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
import { LogOut, CheckCircle2, History, Download } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  "https://geoattendance-asi9.onrender.com/api";

export default function StudentDashboard() {
  const { user, logout } = useAuth();
  const [_, setLocation] = useLocation();
  const { toast } = useToast();

  const [attendanceHistory, setAttendanceHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // student report export state
  const [reportFrom, setReportFrom] = useState("");
  const [reportTo, setReportTo] = useState("");
  const [reportLoading, setReportLoading] = useState(false);

  const studentId = user?.id || null;

  // Helper: build auth headers for secure routes
  const getAuthHeaders = () => {
    if (!user) return {};
    return {
      "x-user-id": String(user.id),
      "x-user-password": user.passwordHash, // same value stored in DB
    };
  };

  // Redirect if not logged in
  useEffect(() => {
    if (!user) setLocation("/");
  }, [user, setLocation]);

  // Fetch attendance history when user present
  useEffect(() => {
    if (!user || !studentId) return;

    let cancelled = false;

    async function loadAttendanceHistory() {
      try {
        setLoadingHistory(true);

        const authHeaders = getAuthHeaders();
        const historyUrl = `${API_BASE_URL}/student/attendance-history`;

        const historyRes = await fetch(historyUrl, {
          credentials: "include",
          headers: {
            ...authHeaders,
          },
        });

        if (!cancelled) {
          if (historyRes.ok) {
            const historyJson = await historyRes.json();
            setAttendanceHistory(
              Array.isArray(historyJson) ? historyJson : []
            );
          } else {
            console.warn("Failed to load attendance history");
            setAttendanceHistory([]);
          }
        }
      } catch (err) {
        console.error("Failed to load attendance history:", err);
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
          setLoadingHistory(false);
        }
      }
    }

    loadAttendanceHistory();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, studentId, toast]);

  // Student attendance report CSV export
  const exportAttendanceReport = async () => {
    if (!studentId) return;

    if (!reportFrom || !reportTo) {
      toast({
        variant: "destructive",
        title: "Date Range Required",
        description: "Please select both start and end dates to export report.",
      });
      return;
    }

    try {
      setReportLoading(true);

      const params = new URLSearchParams({
        from: reportFrom,
        to: reportTo,
        format: "csv",
      });

      const url = `${API_BASE_URL}/student/attendance/report?${params.toString()}`;
      const authHeaders = getAuthHeaders();

      const res = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers: {
          ...authHeaders,
        },
      });

      if (!res.ok) {
        const txt = (await res.text()) || res.statusText;
        throw new Error(txt);
      }

      const blob = await res.blob();
      const href = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = href;
      a.download = `attendance_${reportFrom}_to_${reportTo}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(href);

      toast({
        title: "Report Downloaded",
        description: "Your attendance report has been downloaded as a CSV.",
      });
    } catch (err) {
      console.error("Failed to export report:", err);
      toast({
        variant: "destructive",
        title: "Export Failed",
        description:
          err?.message ||
          "Could not export your attendance report. Please try again.",
      });
    } finally {
      setReportLoading(false);
    }
  };

  if (!user) return null;

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
        {/* Simple info card (optional) */}
        <Card className="border-none shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl">Your Attendance</CardTitle>
            <CardDescription>
              View your recent attendance and download detailed reports.
            </CardDescription>
          </CardHeader>
        </Card>

        {/* History Section */}
        <section>
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
        </section>

        {/* Student Attendance Report Export */}
        <section>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Download className="w-5 h-5 text-primary" />
            Attendance Report
          </h2>
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                Download a CSV report of your attendance for a selected date
                range. You can open it in Excel or Google Sheets.
              </p>
              <div className="grid gap-3 sm:grid-cols-[1fr,1fr,auto] items-end">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    From date
                  </label>
                  <input
                    type="date"
                    value={reportFrom}
                    onChange={(e) => setReportFrom(e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    To date
                  </label>
                  <input
                    type="date"
                    value={reportTo}
                    onChange={(e) => setReportTo(e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                  />
                </div>
                <Button
                  size="sm"
                  className="mt-2 sm:mt-0"
                  onClick={exportAttendanceReport}
                  disabled={reportLoading}
                >
                  <Download className="w-4 h-4 mr-2" />
                  {reportLoading ? "Exporting…" : "Download CSV"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}
