import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  LogOut,
  Search,
  Users,
  CalendarCheck,
  Percent,
  MapPin,
  FileDown,
  FileUp,
  Plus,
  Trash2,
  Compass,
  BarChart2,
} from "lucide-react";
import { format } from "date-fns";
import { buildUrl } from "@/lib/queryClient";

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const [_, setLocation] = useLocation();

  const [records, setRecords] = useState([]);
  const [stats, setStats] = useState({
    totalStudents: 0,
    presentToday: 0,
    attendanceRate: 0,
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [gradeFilter, setGradeFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ─────────────────────────────
  // NEW: Attendance report state
  // ─────────────────────────────
  const [reportFilters, setReportFilters] = useState({
    centerId: "",
    grade: "",
    status: "",
    dateFrom: "",
    dateTo: "",
    page: 1,
    pageSize: 50,
  });
  const [reportRows, setReportRows] = useState([]);
  const [reportMeta, setReportMeta] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState(null);
  const [reportCsvLoading, setReportCsvLoading] = useState(false); // <─ NEW

  // ─────────────────────────────
  // NEW: Student management state
  // ─────────────────────────────
  const [studentForm, setStudentForm] = useState({
    name: "",
    email: "",
    password: "",
    centerId: "",
    grade: "",
    rollNumber: "",
  });
  const [studentAddLoading, setStudentAddLoading] = useState(false);
  const [studentAddMessage, setStudentAddMessage] = useState(null);

  const [studentDeleteId, setStudentDeleteId] = useState("");
  const [studentDeleteLoading, setStudentDeleteLoading] = useState(false);
  const [studentDeleteMessage, setStudentDeleteMessage] = useState(null);

  const [studentsExportLoading, setStudentsExportLoading] = useState(false);

  // ─────────────────────────────
  // NEW: CSV import state
  // ─────────────────────────────
  const [importFile, setImportFile] = useState(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState(null);

  // ─────────────────────────────
  // NEW: Center geofence state
  // ─────────────────────────────
  const [centerForm, setCenterForm] = useState({
    centerId: "",
    lat: "",
    lng: "",
    radiusMeters: "",
  });
  const [centerUpdateLoading, setCenterUpdateLoading] = useState(false);
  const [centerUpdateMessage, setCenterUpdateMessage] = useState(null);

  // ─────────────────────────────
  // NEW: helper for header-based auth
  // ─────────────────────────────
  const getAuthHeaders = () => {
    if (!user) return {};
    return {
      "x-user-id": String(user.id),
      "x-user-password": user.passwordHash, // stored from login
    };
  };

  // Redirect if not admin
  useEffect(() => {
    if (!user) {
      setLocation("/");
    } else if (user.role !== "admin") {
      setLocation("/student");
    }
  }, [user, setLocation]);

  // Fetch stats + basic attendance records
  useEffect(() => {
    if (!user || user.role !== "admin") return;

    let cancelled = false;

    async function fetchData() {
      try {
        setLoading(true);
        setError(null);

        const authHeaders = getAuthHeaders();

        const [statsRes, recordsRes] = await Promise.all([
          fetch(buildUrl("/admin/stats"), {
            credentials: "include",
            headers: {
              ...authHeaders,
            },
          }),
          fetch(buildUrl("/admin/attendance-records"), {
            credentials: "include",
            headers: {
              ...authHeaders,
            },
          }),
        ]);

        if (!statsRes.ok) {
          const text = (await statsRes.text()) || statsRes.statusText;
          throw new Error(`Stats error: ${text}`);
        }
        if (!recordsRes.ok) {
          const text = (await recordsRes.text()) || recordsRes.statusText;
          throw new Error(`Records error: ${text}`);
        }

        const statsJson = await statsRes.json();
        const recordsJson = await recordsRes.json();

        if (!cancelled) {
          setStats({
            totalStudents: statsJson.totalStudents ?? 0,
            presentToday: statsJson.presentToday ?? 0,
            attendanceRate: statsJson.attendanceRate ?? 0,
          });
          setRecords(Array.isArray(recordsJson) ? recordsJson : []);
        }
      } catch (err) {
        console.error("Failed to load admin data:", err);
        if (!cancelled) {
          setError(
            "Failed to load attendance data. Please refresh or try again later."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user || user.role !== "admin") return null;

  const { totalStudents, presentToday, attendanceRate } = stats;

  // Build grade options dynamically from records (plus "All")
  const gradeOptions = useMemo(() => {
    const set = new Set();
    records.forEach((r) => {
      if (r.userGrade && r.userGrade !== "N/A") {
        set.add(r.userGrade);
      }
    });
    return Array.from(set).sort();
  }, [records]);

  // Filter logic for main sheet
  const filteredRecords = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    return records.filter((record) => {
      const matchesSearch =
        !search ||
        record.userName?.toLowerCase().includes(search) ||
        record.userId?.toLowerCase().includes(search);

      const matchesGrade =
        gradeFilter === "all" || record.userGrade === gradeFilter;

      return matchesSearch && matchesGrade;
    });
  }, [records, searchTerm, gradeFilter]);

  // ─────────────────────────────
  // Handlers: Attendance report
  // ─────────────────────────────
  async function handleGenerateReport(pageOverride) {
    if (!user) return;

    const {
      centerId,
      grade,
      status,
      dateFrom,
      dateTo,
      page,
      pageSize,
    } = reportFilters;

    const query = new URLSearchParams();
    if (centerId) query.set("centerId", centerId);
    if (grade) query.set("grade", grade);
    if (status) query.set("status", status);
    if (dateFrom) query.set("dateFrom", dateFrom);
    if (dateTo) query.set("dateTo", dateTo);
    query.set("page", String(pageOverride ?? page));
    query.set("pageSize", String(pageSize));

    const url = buildUrl(`/admin/attendance-report?${query.toString()}`);

    try {
      setReportLoading(true);
      setReportError(null);

      const authHeaders = getAuthHeaders();

      const res = await fetch(url, {
        credentials: "include",
        headers: {
          ...authHeaders,
        },
      });
      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(text);
      }

      const json = await res.json();
      setReportRows(Array.isArray(json.rows) ? json.rows : []);
      setReportMeta(json.meta || null);

      // if page changed, sync state
      if (pageOverride != null) {
        setReportFilters((prev) => ({ ...prev, page: pageOverride }));
      }
    } catch (err) {
      console.error("Failed to generate report:", err);
      setReportError(
        "Failed to load report. Please check filters and try again."
      );
    } finally {
      setReportLoading(false);
    }
  }

  // ─────────────────────────────
  // NEW: Export attendance report CSV
  // ─────────────────────────────
  async function handleExportReportCsv() {
    if (!user) return;

    const { centerId, grade, status, dateFrom, dateTo } = reportFilters;

    const query = new URLSearchParams();
    if (centerId) query.set("centerId", centerId);
    if (grade) query.set("grade", grade);
    if (status) query.set("status", status);
    if (dateFrom) query.set("dateFrom", dateFrom);
    if (dateTo) query.set("dateTo", dateTo);

    const url = buildUrl(
      `/admin/attendance-report/export?${query.toString()}`
    );

    try {
      setReportCsvLoading(true);

      const authHeaders = getAuthHeaders();

      const res = await fetch(url, {
        credentials: "include",
        headers: {
          ...authHeaders,
        },
      });
      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(text);
      }

      const blob = await res.blob();
      const href = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safeFrom = dateFrom || "all";
      const safeTo = dateTo || "all";
      a.href = href;
      a.download = `attendance_report_${safeFrom}_to_${safeTo}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(href);
    } catch (err) {
      console.error("Failed to export attendance CSV:", err);
      alert("Failed to export attendance CSV. Please try again.");
    } finally {
      setReportCsvLoading(false);
    }
  }

  // ─────────────────────────────
  // Handlers: Export students CSV
  // ─────────────────────────────
  async function handleExportStudents() {
    try {
      setStudentsExportLoading(true);

      const centerId = reportFilters.centerId || ""; // reuse filter if you want
      const query = new URLSearchParams();
      if (centerId) query.set("centerId", centerId);

      const url = buildUrl(`/admin/students/export?${query.toString()}`);

      const authHeaders = getAuthHeaders();

      const res = await fetch(url, {
        credentials: "include",
        headers: {
          ...authHeaders,
        },
      });
      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(text);
      }

      const blob = await res.blob();
      const href = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `students_${centerId || "all"}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(href);
    } catch (err) {
      console.error("Failed to export students:", err);
      alert("Failed to export students CSV.");
    } finally {
      setStudentsExportLoading(false);
    }
  }

  // ─────────────────────────────
  // Handlers: Add student
  // ─────────────────────────────
  async function handleAddStudent(e) {
    e.preventDefault();
    const { name, email, password, centerId, grade, rollNumber } = studentForm;

    if (!name || !email || !password || !centerId) {
      setStudentAddMessage({
        type: "error",
        text: "Name, email, password and centerId are required.",
      });
      return;
    }

    try {
      setStudentAddLoading(true);
      setStudentAddMessage(null);

      const authHeaders = getAuthHeaders();

      const res = await fetch(buildUrl("/admin/students"), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({
          name,
          email,
          password,
          centerId: Number(centerId),
          grade: grade || undefined,
          rollNumber: rollNumber || undefined,
        }),
      });

      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(text);
      }

      await res.json();
      setStudentAddMessage({
        type: "success",
        text: "Student created successfully.",
      });

      // Clear form
      setStudentForm({
        name: "",
        email: "",
        password: "",
        centerId: "",
        grade: "",
        rollNumber: "",
      });
    } catch (err) {
      console.error("Failed to add student:", err);
      setStudentAddMessage({
        type: "error",
        text: "Failed to add student. Please try again.",
      });
    } finally {
      setStudentAddLoading(false);
    }
  }

  // ─────────────────────────────
  // Handlers: Delete student
  // ─────────────────────────────
  async function handleDeleteStudent() {
    if (!studentDeleteId) {
      setStudentDeleteMessage({
        type: "error",
        text: "Please provide a student ID to delete.",
      });
      return;
    }

    if (!window.confirm("Are you sure you want to delete this student?")) {
      return;
    }

    try {
      setStudentDeleteLoading(true);
      setStudentDeleteMessage(null);

      const authHeaders = getAuthHeaders();

      const res = await fetch(
        buildUrl(`/admin/students/${encodeURIComponent(studentDeleteId)}`),
        {
          method: "DELETE",
          credentials: "include",
          headers: {
            ...authHeaders,
          },
        }
      );

      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(text);
      }

      await res.json();
      setStudentDeleteMessage({
        type: "success",
        text: "Student deleted successfully.",
      });
      setStudentDeleteId("");
    } catch (err) {
      console.error("Failed to delete student:", err);
      setStudentDeleteMessage({
        type: "error",
        text: "Failed to delete student. Please check the ID and try again.",
      });
    } finally {
      setStudentDeleteLoading(false);
    }
  }

  // ─────────────────────────────
  // Handlers: Import CSV
  // ─────────────────────────────
  async function handleImportCsv(e) {
    e.preventDefault();
    if (!importFile) {
      setImportResult({
        type: "error",
        text: "Please choose a CSV file to import.",
      });
      return;
    }

    try {
      setImportLoading(true);
      setImportResult(null);

      const formData = new FormData();
      formData.append("file", importFile);

      const authHeaders = getAuthHeaders();

      const res = await fetch(buildUrl("/admin/students/import"), {
        method: "POST",
        credentials: "include",
        headers: {
          ...authHeaders,
        },
        body: formData,
      });

      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(text);
      }

      const json = await res.json();
      setImportResult({
        type: "success",
        text: `Imported successfully. Users: ${
          json.summary?.createdUsers ?? 0
        }, Students: ${json.summary?.createdStudents ?? 0}, Skipped existing: ${
          json.summary?.skippedExisting ?? 0
        }, Errors: ${json.summary?.rowsWithErrors ?? 0}`,
        raw: json,
      });

      // Clear file input
      setImportFile(null);
      e.target.reset?.();
    } catch (err) {
      console.error("Failed to import CSV:", err);
      setImportResult({
        type: "error",
        text: "Failed to import CSV. Please check the file format and try again.",
      });
    } finally {
      setImportLoading(false);
    }
  }

  // ─────────────────────────────
  // Handlers: Update center location
  // ─────────────────────────────
  async function handleUpdateCenter(e) {
    e.preventDefault();
    const { centerId, lat, lng, radiusMeters } = centerForm;

    if (!centerId || !lat || !lng || !radiusMeters) {
      setCenterUpdateMessage({
        type: "error",
        text: "Center ID, latitude, longitude and radius are required.",
      });
      return;
    }

    try {
      setCenterUpdateLoading(true);
      setCenterUpdateMessage(null);

      const authHeaders = getAuthHeaders();

      const res = await fetch(
        buildUrl(`/admin/centers/${encodeURIComponent(centerId)}/location`),
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders,
          },
          body: JSON.stringify({
            lat: Number(lat),
            lng: Number(lng),
            radiusMeters: Number(radiusMeters),
          }),
        }
      );

      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(text);
      }

      await res.json();

      setCenterUpdateMessage({
        type: "success",
        text: "Center geofence updated successfully.",
      });
    } catch (err) {
      console.error("Failed to update center:", err);
      setCenterUpdateMessage({
        type: "error",
        text: "Failed to update center coordinates. Please verify values.",
      });
    } finally {
      setCenterUpdateLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Navigation */}
      <nav className="bg-white dark:bg-slate-900 border-b px-6 py-4 sticky top-0 z-20">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-2">
            <div className="bg-primary text-primary-foreground p-2 rounded-lg">
              <CalendarCheck className="w-5 h-5" />
            </div>
            <span className="font-heading font-bold text-xl">
              Admin Portal
            </span>
          </div>

          <div className="flex items-center gap-4">
            {user && (
              <div className="hidden md:flex items-center gap-3 px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-full">
                {user.avatar && (
                  <img
                    src={user.avatar}
                    alt="Admin"
                    className="w-6 h-6 rounded-full"
                  />
                )}
                <span className="text-sm font-medium">
                  {user.fullName || user.name || user.username || user.email}
                </span>
              </div>
            )}
            <Button variant="outline" size="sm" onClick={logout}>
              <LogOut className="w-4 h-4 mr-2" /> Logout
            </Button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="bg-blue-500 text-white border-none shadow-lg shadow-blue-200 dark:shadow-none">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="p-3 bg-white/20 rounded-full backdrop-blur-sm">
                <Users className="w-8 h-8 text-white" />
              </div>
              <div>
                <p className="text-blue-100 font-medium text-sm">
                  Total Students
                </p>
                <h3 className="text-3xl font-bold">{totalStudents}</h3>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-emerald-500 text-white border-none shadow-lg shadow-emerald-200 dark:shadow-none">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="p-3 bg-white/20 rounded-full backdrop-blur-sm">
                <CalendarCheck className="w-8 h-8 text-white" />
              </div>
              <div>
                <p className="text-emerald-100 font-medium text-sm">
                  Present Today
                </p>
                <h3 className="text-3xl font-bold">{presentToday}</h3>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-purple-500 text-white border-none shadow-lg shadow-purple-200 dark:shadow-none">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="p-3 bg-white/20 rounded-full backdrop-blur-sm">
                <Percent className="w-8 h-8 text-white" />
              </div>
              <div>
                <p className="text-purple-100 font-medium text-sm">
                  Attendance Rate
                </p>
                <h3 className="text-3xl font-bold">{attendanceRate}%</h3>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content: Live attendance sheet */}
        <div className="grid gap-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">
                Attendance Sheet
              </h2>
              <p className="text-muted-foreground">
                Monitor real-time student check-ins.
              </p>
            </div>

            <div className="flex gap-3 w-full md:w-auto">
              <div className="relative flex-1 md:w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or ID..."
                  className="pl-9"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <Select
                value={gradeFilter}
                onValueChange={(value) => setGradeFilter(value)}
              >
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Filter Grade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Grades</SelectItem>
                  {gradeOptions.map((grade) => (
                    <SelectItem key={grade} value={grade}>
                      {grade}
                    </SelectItem>
                  ))}
                  {gradeOptions.length === 0 && (
                    <SelectItem value="none" disabled>
                      No grade data
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Card>
            {loading ? (
              <div className="py-10 text-center text-muted-foreground">
                Loading attendance records…
              </div>
            ) : error ? (
              <div className="py-10 text-center text-red-600 text-sm">
                {error}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student Name</TableHead>
                    <TableHead>Grade</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Location</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRecords.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="text-center py-8 text-muted-foreground"
                      >
                        No records found matching your filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredRecords.map((record) => {
                      const dateObj = record.date
                        ? new Date(record.date)
                        : null;

                      const dateStr = dateObj
                        ? format(dateObj, "MMM dd, yyyy")
                        : "—";

                      const timeStr = dateObj
                        ? format(dateObj, "hh:mm a")
                        : record.time || "—";

                      return (
                        <TableRow key={record.id}>
                          <TableCell className="font-medium">
                            <div className="flex flex-col">
                              <span>{record.userName}</span>
                              <span className="text-xs text-muted-foreground">
                                {record.userId}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="secondary"
                              className="rounded-sm font-normal"
                            >
                              {record.userGrade || "N/A"}
                            </Badge>
                          </TableCell>
                          <TableCell>{dateStr}</TableCell>
                          <TableCell>{timeStr}</TableCell>
                          <TableCell>
                            <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-green-200 shadow-none">
                              {(record.status || "")
                                .toString()
                                .toUpperCase()}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {record.location ? (
                              <div className="flex items-center text-xs text-muted-foreground">
                                <MapPin className="w-3 h-3 mr-1" />
                                {Number(record.location.lat).toFixed(4)},{" "}
                                {Number(record.location.lng).toFixed(4)}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                —
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>

        {/* ─────────────────────────────────────────────
            Reports & Management Section
            ───────────────────────────────────────────── */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Attendance Report (takes 2 columns) */}
          <Card className="lg:col-span-2">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <BarChart2 className="w-5 h-5 text-blue-600" />
                    Attendance Report
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Generate date-range and classwise reports with filters.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleGenerateReport()}
                    disabled={reportLoading}
                  >
                    {reportLoading ? "Generating..." : "Generate"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleExportReportCsv}
                    disabled={reportCsvLoading}
                  >
                    <FileDown className="w-4 h-4 mr-1" />
                    {reportCsvLoading ? "Exporting..." : "Download CSV"}
                  </Button>
                </div>
              </div>

              {/* Filters */}
              <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
                <Input
                  type="date"
                  value={reportFilters.dateFrom}
                  onChange={(e) =>
                    setReportFilters((prev) => ({
                      ...prev,
                      dateFrom: e.target.value,
                    }))
                  }
                  placeholder="From date"
                />
                <Input
                  type="date"
                  value={reportFilters.dateTo}
                  onChange={(e) =>
                    setReportFilters((prev) => ({
                      ...prev,
                      dateTo: e.target.value,
                    }))
                  }
                  placeholder="To date"
                />
                <Input
                  type="number"
                  min="1"
                  placeholder="Center ID"
                  value={reportFilters.centerId}
                  onChange={(e) =>
                    setReportFilters((prev) => ({
                      ...prev,
                      centerId: e.target.value,
                    }))
                  }
                />
                <Input
                  placeholder="Grade (optional)"
                  value={reportFilters.grade}
                  onChange={(e) =>
                    setReportFilters((prev) => ({
                      ...prev,
                      grade: e.target.value,
                    }))
                  }
                />
                <Input
                  placeholder="Status (present/late...)"
                  value={reportFilters.status}
                  onChange={(e) =>
                    setReportFilters((prev) => ({
                      ...prev,
                      status: e.target.value,
                    }))
                  }
                />
                <Input
                  type="number"
                  min="1"
                  max="500"
                  placeholder="Page size"
                  value={reportFilters.pageSize}
                  onChange={(e) =>
                    setReportFilters((prev) => ({
                      ...prev,
                      pageSize: e.target.value || 50,
                    }))
                  }
                />
              </div>

              {reportError && (
                <div className="text-xs text-red-600">{reportError}</div>
              )}

              {/* Report meta & pagination */}
              {reportMeta && (
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Showing {reportRows.length} of {reportMeta.total} records{" "}
                    (page {reportMeta.page} / {reportMeta.totalPages || 1})
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={reportLoading || reportMeta.page <= 1}
                      onClick={() =>
                        handleGenerateReport(reportMeta.page - 1)
                      }
                    >
                      Prev
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={
                        reportLoading ||
                        !reportMeta.totalPages ||
                        reportMeta.page >= reportMeta.totalPages
                      }
                      onClick={() =>
                        handleGenerateReport(reportMeta.page + 1)
                      }
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}

              {/* Report table */}
              <div className="border rounded-md overflow-hidden">
                {reportLoading ? (
                  <div className="py-8 text-center text-muted-foreground text-sm">
                    Generating report…
                  </div>
                ) : reportRows.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground text-sm">
                    No report data yet. Choose filters and click Generate.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Student</TableHead>
                        <TableHead>Grade</TableHead>
                        <TableHead>Center</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>In</TableHead>
                        <TableHead>Out</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reportRows.map((row) => {
                        const inDate = row.checkInAt
                          ? new Date(row.checkInAt)
                          : null;
                        const outDate = row.checkOutAt
                          ? new Date(row.checkOutAt)
                          : null;

                        return (
                          <TableRow key={row.id}>
                            <TableCell className="font-medium">
                              <div className="flex flex-col">
                                <span>{row.studentName}</span>
                                <span className="text-[10px] text-muted-foreground">
                                  {row.studentEmail || "—"} • ID:{" "}
                                  {row.studentId}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>{row.grade || "N/A"}</TableCell>
                            <TableCell className="text-xs">
                              <div className="flex flex-col">
                                <span>{row.centerName || "—"}</span>
                                <span className="text-[10px] text-muted-foreground">
                                  {row.centerCode || ""}{" "}
                                  {row.centerId ? `(#${row.centerId})` : ""}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              {inDate ? format(inDate, "MMM dd, yyyy") : "—"}
                            </TableCell>
                            <TableCell>
                              {inDate ? format(inDate, "hh:mm a") : "—"}
                            </TableCell>
                            <TableCell>
                              {outDate ? format(outDate, "hh:mm a") : "—"}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className="text-xs font-normal"
                              >
                                {(row.status || "").toUpperCase()}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Right column: Students & Geofence tools */}
          <div className="space-y-4">
            {/* Students: export + import */}
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <FileDown className="w-4 h-4 text-slate-700" />
                    Student Data
                  </h3>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={handleExportStudents}
                    disabled={studentsExportLoading}
                  >
                    {studentsExportLoading ? "Exporting…" : "Export CSV"}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Export all students (or filtered by centerId) with their
                  hashed passwords.
                </p>

                <form
                  className="border-t pt-3 mt-3 space-y-2"
                  onSubmit={handleImportCsv}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <FileUp className="w-4 h-4 text-slate-700" />
                      Import CSV
                    </div>
                    <Input
                      type="file"
                      accept=".csv,text/csv"
                      className="h-8 text-xs"
                      onChange={(e) =>
                        setImportFile(e.target.files?.[0] || null)
                      }
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Expected columns:{" "}
                    <code>
                      name,email,password,role,centerCode,grade,rollNumber
                    </code>
                  </p>
                  <Button
                    type="submit"
                    size="xs"
                    className="w-full mt-1"
                    disabled={importLoading}
                  >
                    {importLoading ? "Importing…" : "Import Students"}
                  </Button>
                  {importResult && (
                    <p
                      className={`text-[11px] mt-1 ${
                        importResult.type === "success"
                          ? "text-emerald-600"
                          : "text-red-600"
                      }`}
                    >
                      {importResult.text}
                    </p>
                  )}
                </form>
              </CardContent>
            </Card>

            {/* Add student */}
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Plus className="w-4 h-4 text-slate-700" />
                  <h3 className="text-sm font-semibold">Add Student</h3>
                </div>
                <form className="space-y-2" onSubmit={handleAddStudent}>
                  <Input
                    placeholder="Full name"
                    value={studentForm.name}
                    onChange={(e) =>
                      setStudentForm((prev) => ({
                        ...prev,
                        name: e.target.value,
                      }))
                    }
                  />
                  <Input
                    type="email"
                    placeholder="Email"
                    value={studentForm.email}
                    onChange={(e) =>
                      setStudentForm((prev) => ({
                        ...prev,
                        email: e.target.value,
                      }))
                    }
                  />
                  <Input
                    type="password"
                    placeholder="Temporary password"
                    value={studentForm.password}
                    onChange={(e) =>
                      setStudentForm((prev) => ({
                        ...prev,
                        password: e.target.value,
                      }))
                    }
                  />
                  <Input
                    type="number"
                    placeholder="Center ID"
                    value={studentForm.centerId}
                    onChange={(e) =>
                      setStudentForm((prev) => ({
                        ...prev,
                        centerId: e.target.value,
                      }))
                    }
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      placeholder="Grade (optional)"
                      value={studentForm.grade}
                      onChange={(e) =>
                        setStudentForm((prev) => ({
                          ...prev,
                          grade: e.target.value,
                        }))
                      }
                    />
                    <Input
                      placeholder="Roll no. (optional)"
                      value={studentForm.rollNumber}
                      onChange={(e) =>
                        setStudentForm((prev) => ({
                          ...prev,
                          rollNumber: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <Button
                    type="submit"
                    size="sm"
                    className="w-full"
                    disabled={studentAddLoading}
                  >
                    {studentAddLoading ? "Creating…" : "Create Student"}
                  </Button>
                  {studentAddMessage && (
                    <p
                      className={`text-[11px] mt-1 ${
                        studentAddMessage.type === "success"
                          ? "text-emerald-600"
                          : "text-red-600"
                      }`}
                    >
                      {studentAddMessage.text}
                    </p>
                  )}
                </form>
              </CardContent>
            </Card>

            {/* Delete student */}
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Trash2 className="w-4 h-4 text-red-600" />
                  <h3 className="text-sm font-semibold text-red-700">
                    Delete Student
                  </h3>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Provide the <strong>student ID</strong> (not user ID). You can
                  see it under Attendance Sheet.
                </p>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="Student ID"
                    value={studentDeleteId}
                    onChange={(e) => setStudentDeleteId(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    onClick={handleDeleteStudent}
                    disabled={studentDeleteLoading}
                  >
                    <Trash2 className="w-4 h-4 text-red-600" />
                  </Button>
                </div>
                {studentDeleteMessage && (
                  <p
                    className={`text-[11px] ${
                      studentDeleteMessage.type === "success"
                        ? "text-emerald-600"
                        : "text-red-600"
                    }`}
                  >
                    {studentDeleteMessage.text}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Center geofence */}
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Compass className="w-4 h-4 text-slate-700" />
                  <h3 className="text-sm font-semibold">
                    Center Geofence
                  </h3>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Update latitude, longitude and allowed radius (meters) for a
                  center.
                </p>
                <form
                  className="space-y-2 text-xs"
                  onSubmit={handleUpdateCenter}
                >
                  <Input
                    type="number"
                    placeholder="Center ID"
                    value={centerForm.centerId}
                    onChange={(e) =>
                      setCenterForm((prev) => ({
                        ...prev,
                        centerId: e.target.value,
                      }))
                    }
                  />
                  <Input
                    type="number"
                    step="0.000001"
                    placeholder="Latitude"
                    value={centerForm.lat}
                    onChange={(e) =>
                      setCenterForm((prev) => ({
                        ...prev,
                        lat: e.target.value,
                      }))
                    }
                  />
                  <Input
                    type="number"
                    step="0.000001"
                    placeholder="Longitude"
                    value={centerForm.lng}
                    onChange={(e) =>
                      setCenterForm((prev) => ({
                        ...prev,
                        lng: e.target.value,
                      }))
                    }
                  />
                  <Input
                    type="number"
                    step="1"
                    placeholder="Radius (meters)"
                    value={centerForm.radiusMeters}
                    onChange={(e) =>
                      setCenterForm((prev) => ({
                        ...prev,
                        radiusMeters: e.target.value,
                      }))
                    }
                  />
                  <Button
                    type="submit"
                    size="sm"
                    className="w-full"
                    disabled={centerUpdateLoading}
                  >
                    {centerUpdateLoading
                      ? "Updating…"
                      : "Update Center Location"}
                  </Button>
                  {centerUpdateMessage && (
                    <p
                      className={`text-[11px] mt-1 ${
                        centerUpdateMessage.type === "success"
                          ? "text-emerald-600"
                          : "text-red-600"
                      }`}
                    >
                      {centerUpdateMessage.text}
                    </p>
                  )}
                </form>
              </CardContent>
            </Card>
          </div>
        </section>
      </main>
    </div>
  );
}
