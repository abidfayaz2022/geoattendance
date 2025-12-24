import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  FileDown,
  FileUp,
  Plus,
  Trash2,
  BarChart2,
  QrCode,
  Pencil,
  Save,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { buildUrl } from "@/lib/queryClient";

/* ──────────────────────────────────────────────────────────────
   Grade list (used everywhere)
────────────────────────────────────────────────────────────── */
const GRADE_OPTIONS = [
  "1st",
  "2nd",
  "3rd",
  "4th",
  "5th",
  "6th",
  "7th",
  "8th",
  "9th",
  "10th",
  "11th",
  "12th",
];

/* ──────────────────────────────────────────────────────────────
   Small helpers
────────────────────────────────────────────────────────────── */
function safeDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// For <input type="datetime-local"> value
function toLocalInputValue(dateLike) {
  const d = safeDate(dateLike);
  if (!d) return "";
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function parseLocalInputToISO(value) {
  // value like "2025-12-13T18:30"
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function pickStudentPhone(obj) {
  return (
    obj?.studentPhoneNumber ||
    obj?.phoneNumber ||
    obj?.studentPhone ||
    obj?.mobile ||
    null
  );
}

function pickParentPhone(obj) {
  return (
    obj?.parentPhoneNumber ||
    obj?.parentNumber ||
    obj?.guardianPhoneNumber ||
    obj?.guardianPhone ||
    null
  );
}

/* ──────────────────────────────────────────────────────────────
   Attendance Editor (inline panel)
────────────────────────────────────────────────────────────── */
function AttendanceEditor({ record, onClose, onSaved, getAuthHeaders }) {
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState(null);

  // Editor fields
  const [status, setStatus] = useState((record?.status || "").toString());
  const [checkInAt, setCheckInAt] = useState(
    toLocalInputValue(record?.checkInAt || record?.date)
  );
  const [checkOutAt, setCheckOutAt] = useState(
    toLocalInputValue(record?.checkOutAt)
  );

  useEffect(() => {
    setStatus((record?.status || "").toString());
    setCheckInAt(toLocalInputValue(record?.checkInAt || record?.date));
    setCheckOutAt(toLocalInputValue(record?.checkOutAt));
    setMessage(null);
  }, [record]);

  if (!record) return null;

  const isSyntheticAbsent = !record?.id; // ✅ absent row created client-side/back-end response
  const studentPhone = pickStudentPhone(record);
  const parentPhone = pickParentPhone(record);

  async function patch(action, body) {
    if (!record?.id) throw new Error("No record id");
    const url = buildUrl(`/admin/attendance-records/${record.id}`);
    const res = await fetch(url, {
      method: "PATCH",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
      },
      body: JSON.stringify({ action, ...body }),
    });

    if (!res.ok) {
      const text = (await res.text()) || res.statusText;
      throw new Error(text);
    }
    return res.json();
  }

  async function handleSetStatus() {
    try {
      setSaving(true);
      setMessage(null);
      await patch("set_status", { status: status.trim() || "present" });
      setMessage({ type: "success", text: "Status updated." });
      onSaved?.();
    } catch (e) {
      console.error(e);
      setMessage({ type: "error", text: "Failed to update status." });
    } finally {
      setSaving(false);
    }
  }

  async function handleForceCheckout() {
    try {
      setSaving(true);
      setMessage(null);
      const iso = parseLocalInputToISO(checkOutAt);
      await patch("force_checkout", { checkOutAt: iso || undefined });
      setMessage({ type: "success", text: "Checkout saved." });
      onSaved?.();
    } catch (e) {
      console.error(e);
      setMessage({ type: "error", text: "Failed to save checkout." });
    } finally {
      setSaving(false);
    }
  }

  async function handleReopenSession() {
    try {
      setSaving(true);
      setMessage(null);
      await patch("reopen_session", {});
      setMessage({
        type: "success",
        text: "Session reopened (checkout cleared).",
      });
      setCheckOutAt("");
      onSaved?.();
    } catch (e) {
      console.error(e);
      setMessage({ type: "error", text: "Failed to reopen session." });
    } finally {
      setSaving(false);
    }
  }

  async function handleSetTimes() {
    try {
      setSaving(true);
      setMessage(null);

      const ci = parseLocalInputToISO(checkInAt);
      // If user explicitly emptied checkout input, send null to clear it
      const co = checkOutAt === "" ? null : parseLocalInputToISO(checkOutAt);

      await patch("set_times", {
        checkInAt: ci || undefined,
        checkOutAt: co,
      });

      setMessage({ type: "success", text: "Times updated." });
      onSaved?.();
    } catch (e) {
      console.error(e);
      setMessage({ type: "error", text: "Failed to update times." });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm("Delete this attendance record? This cannot be undone."))
      return;

    try {
      setDeleting(true);
      setMessage(null);

      const url = buildUrl(`/admin/attendance-records/${record.id}`);
      const res = await fetch(url, {
        method: "DELETE",
        credentials: "include",
        headers: {
          ...getAuthHeaders(),
        },
      });

      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(text);
      }

      setMessage({ type: "success", text: "Record deleted." });
      onSaved?.();
      onClose?.();
    } catch (e) {
      console.error(e);
      setMessage({ type: "error", text: "Failed to delete record." });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold flex items-center gap-2">
            <Pencil className="w-4 h-4" />
            Edit Attendance Record
          </div>
          <div className="text-[11px] text-muted-foreground">
            {isSyntheticAbsent ? (
              <>
                Synthetic row (Absent) • {record.userName} • Grade{" "}
                {record.userGrade || "N/A"}
              </>
            ) : (
              <>
                Record #{record.id} • {record.userName} • Grade{" "}
                {record.userGrade || "N/A"}
              </>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground">
            Student Phone: {studentPhone || "—"} • Parent Phone:{" "}
            {parentPhone || "—"}
          </div>
          {isSyntheticAbsent && (
            <div className="text-[11px] text-amber-600 mt-1">
              This is an “absent” row generated for today. No DB record exists to
              edit. Marking absent → present requires creating a record (not in
              current API).
            </div>
          )}
        </div>
        <Button size="icon" variant="ghost" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Status */}
      <div className="grid gap-2 md:grid-cols-3">
        <div className="md:col-span-2">
          <div className="text-[11px] text-muted-foreground">Status</div>
          <Select value={status} onValueChange={setStatus} disabled={isSyntheticAbsent}>
            <SelectTrigger>
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="present">Present</SelectItem>
              <SelectItem value="late">Late</SelectItem>
              <SelectItem value="absent">Absent</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          onClick={handleSetStatus}
          disabled={saving || isSyntheticAbsent}
        >
          <Save className="w-4 h-4 mr-2" />
          {saving ? "Saving..." : "Set Status"}
        </Button>
      </div>

      {/* Times */}
      <div className="grid gap-2 md:grid-cols-2">
        <div className="space-y-1">
          <div className="text-[11px] text-muted-foreground">Check-in time</div>
          <Input
            type="datetime-local"
            value={checkInAt}
            onChange={(e) => setCheckInAt(e.target.value)}
            disabled={isSyntheticAbsent}
          />
        </div>
        <div className="space-y-1">
          <div className="text-[11px] text-muted-foreground">Check-out time</div>
          <Input
            type="datetime-local"
            value={checkOutAt}
            onChange={(e) => setCheckOutAt(e.target.value)}
            disabled={isSyntheticAbsent}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={handleSetTimes}
          disabled={saving || isSyntheticAbsent}
        >
          {saving ? "Saving..." : "Save Times"}
        </Button>
        <Button
          variant="outline"
          onClick={handleForceCheckout}
          disabled={saving || isSyntheticAbsent}
        >
          {saving ? "Saving..." : "Force Checkout"}
        </Button>
        <Button
          variant="outline"
          onClick={handleReopenSession}
          disabled={saving || isSyntheticAbsent}
        >
          {saving ? "Saving..." : "Reopen Session"}
        </Button>
        <Button
          variant="destructive"
          onClick={handleDelete}
          disabled={deleting || isSyntheticAbsent}
        >
          {deleting ? "Deleting..." : "Delete Record"}
        </Button>
      </div>

      {message && (
        <div
          className={`text-[11px] ${message.type === "success" ? "text-emerald-600" : "text-red-600"
            }`}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   QR Cards panel with filters (NO Center filters)
   ✅ Grade is now a Select dropdown
────────────────────────────────────────────────────────────── */
function QrCardsPanel({ getAuthHeaders }) {
  const [filters, setFilters] = useState({
    today: false,
    dateFrom: "",
    dateTo: "",
    grade: "",
    rollNumber: "",
    email: "",
    search: "",
    limit: "200",
  });

  const [loading, setLoading] = useState(false);

  const buildQrUrl = () => {
    const q = new URLSearchParams();
    if (filters.today) q.set("today", "1");
    if (!filters.today && filters.dateFrom) q.set("dateFrom", filters.dateFrom);
    if (!filters.today && filters.dateTo) q.set("dateTo", filters.dateTo);
    if (filters.grade) q.set("grade", filters.grade);
    if (filters.rollNumber) q.set("rollNumber", filters.rollNumber);
    if (filters.email) q.set("email", filters.email);
    if (filters.search) q.set("search", filters.search);
    if (filters.limit) q.set("limit", filters.limit);
    return buildUrl(`/admin/students/qr-cards?${q.toString()}`);
  };

  async function handleDownload() {
    try {
      setLoading(true);

      const url = buildQrUrl();
      const res = await fetch(url, {
        credentials: "include",
        headers: {
          ...getAuthHeaders(),
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

      const suffix = filters.today
        ? "today"
        : filters.dateFrom || filters.dateTo
          ? `${filters.dateFrom || "x"}_to_${filters.dateTo || "x"}`
          : "all";

      a.download = `student_qr_cards_${suffix}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(href);
    } catch (err) {
      console.error("QR download failed:", err);
      alert("Failed to download QR cards PDF. Check filters and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <QrCode className="w-4 h-4 text-slate-700" />
            QR Cards PDF
          </h3>
          <Button
            size="xs"
            variant="outline"
            onClick={handleDownload}
            disabled={loading}
          >
            {loading ? "Generating…" : "Download"}
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Filter QR cards by today/date range, email, roll number, grade, etc.
        </p>

        <div className="grid gap-2 md:grid-cols-2">
          <Button
            type="button"
            size="sm"
            variant={filters.today ? "default" : "outline"}
            onClick={() => setFilters((p) => ({ ...p, today: !p.today }))}
          >
            {filters.today ? "Today: ON" : "Today: OFF"}
          </Button>

          <Input
            placeholder="Limit (max 500)"
            type="number"
            min="1"
            max="500"
            value={filters.limit}
            onChange={(e) =>
              setFilters((p) => ({ ...p, limit: e.target.value }))
            }
          />

          <Input
            type="date"
            disabled={filters.today}
            value={filters.dateFrom}
            onChange={(e) =>
              setFilters((p) => ({ ...p, dateFrom: e.target.value }))
            }
            placeholder="Date From"
          />
          <Input
            type="date"
            disabled={filters.today}
            value={filters.dateTo}
            onChange={(e) =>
              setFilters((p) => ({ ...p, dateTo: e.target.value }))
            }
            placeholder="Date To"
          />

          {/* ✅ Grade dropdown */}
          <Select
            value={filters.grade || "all"}
            onValueChange={(value) =>
              setFilters((p) => ({ ...p, grade: value === "all" ? "" : value }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Grade (optional)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Grades</SelectItem>
              {GRADE_OPTIONS.map((g) => (
                <SelectItem key={g} value={g}>
                  {g}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            placeholder="Roll Number"
            value={filters.rollNumber}
            onChange={(e) =>
              setFilters((p) => ({ ...p, rollNumber: e.target.value }))
            }
          />
          <Input
            placeholder="Email"
            value={filters.email}
            onChange={(e) =>
              setFilters((p) => ({ ...p, email: e.target.value }))
            }
          />

          <Input
            className="md:col-span-2"
            placeholder="Search (name/email contains)"
            value={filters.search}
            onChange={(e) =>
              setFilters((p) => ({ ...p, search: e.target.value }))
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}

/* ──────────────────────────────────────────────────────────────
   Main AdminDashboard
────────────────────────────────────────────────────────────── */
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

  // Attendance report state (NO centerId)
  const [reportFilters, setReportFilters] = useState({
    grade: "", // ✅ will be driven by dropdown
    status: "",
    dateFrom: "",
    dateTo: "",
    page: 1,
    pageSize: 100,
  });
  const [reportRows, setReportRows] = useState([]);
  const [reportMeta, setReportMeta] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState(null);
  const [reportCsvLoading, setReportCsvLoading] = useState(false);

  // Student management state (NO centerId)
  const [studentForm, setStudentForm] = useState({
    name: "",
    email: "",
    password: "",
    grade: "", // ✅ dropdown
    rollNumber: "",
    phoneNumber: "",
    parentPhoneNumber: "",
  });
  const [studentAddLoading, setStudentAddLoading] = useState(false);
  const [studentAddMessage, setStudentAddMessage] = useState(null);

  const [studentDeleteId, setStudentDeleteId] = useState("");
  const [studentDeleteLoading, setStudentDeleteLoading] = useState(false);
  const [studentDeleteMessage, setStudentDeleteMessage] = useState(null);

  const [studentsExportLoading, setStudentsExportLoading] = useState(false);

  // CSV import state
  const [importFile, setImportFile] = useState(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState(null);

  // Record editor selection
  const [editingRecord, setEditingRecord] = useState(null);

  const openEditor = useCallback((rec) => {
    setEditingRecord(rec);
  }, []);

  // header-based auth
  const getAuthHeaders = useCallback(() => {
    if (!user) return {};
    return {
      "x-user-id": String(user.id),
      "x-user-password": user.passwordHash,
    };
  }, [user]);

  // Redirect if not admin
  useEffect(() => {
    if (!user) {
      setLocation("/");
    } else if (user.role !== "admin") {
      setLocation("/student");
    }
  }, [user, setLocation]);

  // Central reload function (so editor can refresh)
  const reloadAdminData = useCallback(async () => {
    if (!user || user.role !== "admin") return;

    try {
      setLoading(true);
      setError(null);

      const authHeaders = getAuthHeaders();

      const [statsRes, recordsRes] = await Promise.all([
        fetch(buildUrl("/admin/stats"), {
          credentials: "include",
          headers: { ...authHeaders },
        }),
        fetch(buildUrl("/admin/attendance-records"), {
          credentials: "include",
          headers: { ...authHeaders },
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

      // ✅ supports backend returning: []  OR  { range, data: [] }
      const list = Array.isArray(recordsJson)
        ? recordsJson
        : Array.isArray(recordsJson?.data)
          ? recordsJson.data
          : [];

      setStats({
        totalStudents: statsJson.totalStudents ?? 0,
        presentToday: statsJson.presentToday ?? 0,
        attendanceRate: statsJson.attendanceRate ?? 0,
      });
      setRecords(list);
    } catch (err) {
      console.error("Failed to load admin data:", err);
      setError(
        "Failed to load attendance data. Please refresh or try again later."
      );
    } finally {
      setLoading(false);
    }
  }, [user, getAuthHeaders]);

  // initial load
  useEffect(() => {
    reloadAdminData();
  }, [reloadAdminData]);

  if (!user || user.role !== "admin") return null;

  const { totalStudents, presentToday, attendanceRate } = stats;

  // Grade options for table filter (based on data; fallback to constants)
  const gradeOptions = useMemo(() => {
    const set = new Set();
    records.forEach((r) => {
      if (r.userGrade && r.userGrade !== "N/A") set.add(r.userGrade);
    });
    const arr = Array.from(set);
    return arr.length ? arr : [...GRADE_OPTIONS];
  }, [records]);

  // Filter main table
  const filteredRecords = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    return records.filter((record) => {
      const name = (record.userName || "").toLowerCase();
      const id = String(record.userId ?? "").toLowerCase();

      const matchesSearch = !search || name.includes(search) || id.includes(search);
      const matchesGrade = gradeFilter === "all" || record.userGrade === gradeFilter;

      return matchesSearch && matchesGrade;
    });
  }, [records, searchTerm, gradeFilter]);

  // Convert report row shape to editor record shape
  const reportRowToEditorRecord = useCallback((row) => {
    if (!row) return null;
    return {
      id: row.id,
      userName: row.studentName,
      userId: String(row.studentId ?? ""),
      userGrade: row.grade ?? "N/A",
      status: row.status,
      checkInAt: row.checkInAt,
      checkOutAt: row.checkOutAt,
      studentPhoneNumber: pickStudentPhone(row),
      parentPhoneNumber: pickParentPhone(row),
    };
  }, []);

  // Attendance report (NO centerId query param)
  async function handleGenerateReport(pageOverride) {
    if (!user) return;

    const { grade, status, dateFrom, dateTo, page, pageSize } = reportFilters;

    const query = new URLSearchParams();
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

      const res = await fetch(url, {
        credentials: "include",
        headers: { ...getAuthHeaders() },
      });
      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(text);
      }

      const json = await res.json();
      setReportRows(Array.isArray(json.rows) ? json.rows : []);
      setReportMeta(json.meta || null);

      if (pageOverride != null) {
        setReportFilters((prev) => ({ ...prev, page: pageOverride }));
      }
    } catch (err) {
      console.error("Failed to generate report:", err);
      setReportError("Failed to load report. Please check filters and try again.");
    } finally {
      setReportLoading(false);
    }
  }

  async function handleExportReportCsv() {
    if (!user) return;

    const { grade, status, dateFrom, dateTo } = reportFilters;

    const query = new URLSearchParams();
    if (grade) query.set("grade", grade);
    if (status) query.set("status", status);
    if (dateFrom) query.set("dateFrom", dateFrom);
    if (dateTo) query.set("dateTo", dateTo);

    const url = buildUrl(`/admin/attendance-report/export?${query.toString()}`);

    try {
      setReportCsvLoading(true);

      const res = await fetch(url, {
        credentials: "include",
        headers: { ...getAuthHeaders() },
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

  async function handleExportStudents() {
    try {
      setStudentsExportLoading(true);

      const url = buildUrl(`/admin/students/export`);

      const res = await fetch(url, {
        credentials: "include",
        headers: { ...getAuthHeaders() },
      });
      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(text);
      }

      const blob = await res.blob();
      const href = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `students_all.csv`;
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

  async function handleAddStudent(e) {
    e.preventDefault();
    const {
      name,
      email,
      password,
      grade,
      rollNumber,
      phoneNumber,
      parentPhoneNumber,
    } = studentForm;

    if (!name || !email || !password) {
      setStudentAddMessage({
        type: "error",
        text: "Name, email, and password are required.",
      });
      return;
    }

    try {
      setStudentAddLoading(true);
      setStudentAddMessage(null);

      const res = await fetch(buildUrl("/admin/students"), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          name,
          email,
          password,
          grade: grade || undefined,
          rollNumber: rollNumber || undefined,
          phoneNumber: phoneNumber || undefined,
          parentPhoneNumber: parentPhoneNumber || undefined,
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

      setStudentForm({
        name: "",
        email: "",
        password: "",
        grade: "",
        rollNumber: "",
        phoneNumber: "",
        parentPhoneNumber: "",
      });

      await reloadAdminData();
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

  async function handleDeleteStudent() {
    if (!studentDeleteId) {
      setStudentDeleteMessage({
        type: "error",
        text: "Please provide a student ID to delete.",
      });
      return;
    }

    if (!window.confirm("Are you sure you want to delete this student?")) return;

    try {
      setStudentDeleteLoading(true);
      setStudentDeleteMessage(null);

      const res = await fetch(
        buildUrl(`/admin/students/${encodeURIComponent(studentDeleteId)}`),
        {
          method: "DELETE",
          credentials: "include",
          headers: { ...getAuthHeaders() },
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

      await reloadAdminData();
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

      const res = await fetch(buildUrl("/admin/students/import"), {
        method: "POST",
        credentials: "include",
        headers: { ...getAuthHeaders() },
        body: formData,
      });

      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(text);
      }

      const json = await res.json();
      setImportResult({
        type: "success",
        text: `Imported successfully. Users: ${json.summary?.createdUsers ?? 0}, Students: ${json.summary?.createdStudents ?? 0
          }, Skipped: ${json.summary?.skippedExisting ?? 0}, Errors: ${json.summary?.rowsWithErrors ?? 0
          }`,
        raw: json,
      });

      setImportFile(null);
      e.target.reset?.();

      await reloadAdminData();
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

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Navigation */}
      <nav className="bg-white dark:bg-slate-900 border-b px-6 py-4 sticky top-0 z-20">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-2">
            <div className="bg-primary text-primary-foreground p-2 rounded-lg">
              <CalendarCheck className="w-5 h-5" />
            </div>
            <span className="font-heading font-bold text-xl">Admin Portal</span>
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
                <p className="text-blue-100 font-medium text-sm">Total Students</p>
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
                <p className="text-emerald-100 font-medium text-sm">Present Today</p>
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
                <p className="text-purple-100 font-medium text-sm">Attendance Rate</p>
                <h3 className="text-3xl font-bold">{attendanceRate}%</h3>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Live attendance sheet */}
        <div className="grid gap-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Attendance Sheet</h2>
              <p className="text-muted-foreground">Monitor real-time student check-ins.</p>
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

              {/* Grade dropdown */}
              <Select value={gradeFilter} onValueChange={setGradeFilter}>
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
                </SelectContent>
              </Select>
            </div>
          </div>

          <Dialog
            open={!!editingRecord}
            onOpenChange={(open) => !open && setEditingRecord(null)}
          >
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Edit Attendance</DialogTitle>
              </DialogHeader>

              {editingRecord && (
                <AttendanceEditor
                  record={editingRecord}
                  onClose={() => setEditingRecord(null)}
                  onSaved={async () => {
                    await reloadAdminData();
                    if (reportMeta || reportRows.length > 0) {
                      await handleGenerateReport(reportFilters.page);
                    }
                  }}
                  getAuthHeaders={getAuthHeaders}
                />
              )}
            </DialogContent>
          </Dialog>

          <Card>
            {loading ? (
              <div className="py-10 text-center text-muted-foreground">
                Loading attendance records…
              </div>
            ) : error ? (
              <div className="py-10 text-center text-red-600 text-sm">{error}</div>
            ) : (
              <div className="max-h-[520px] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-white dark:bg-slate-900 z-10">
                    <TableRow>
                      <TableHead>Student Name</TableHead>
                      <TableHead>Grade</TableHead>
                      <TableHead>Student Phone</TableHead>
                      <TableHead>Parent Phone</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>In</TableHead>
                      <TableHead>Out</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRecords.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={9}
                          className="text-center py-8 text-muted-foreground"
                        >
                          No records found matching your filters.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredRecords.map((record) => {
                        const statusLower = String(record.status || "")
                          .toLowerCase()
                          .trim();
                        const isAbsent = statusLower === "absent";
                        const isLate = statusLower === "late";
                        const isPresent = statusLower === "present";
                        const isEditable = !!record.id; // ✅ absent rows are synthetic (id null)


                        const checkInDate = safeDate(record.checkInAt || record.date);
                        const checkOutDate = safeDate(record.checkOutAt);

                        const dateStr = checkInDate
                          ? format(checkInDate, "MMM dd, yyyy")
                          : "—";
                        const checkInStr =
                          !isAbsent && checkInDate
                            ? format(checkInDate, "hh:mm a")
                            : "—";
                        const checkOutStr =
                          !isAbsent && checkOutDate
                            ? format(checkOutDate, "hh:mm a")
                            : "—";

                        const statusText = (record.status || "")
                          .toString()
                          .toUpperCase();

                        const studentPhone = pickStudentPhone(record);
                        const parentPhone = pickParentPhone(record);

                        return (
                          <TableRow
                            key={record.id ?? `absent-${record.userId}`}
                            className={isAbsent ? "bg-red-50/70 hover:bg-red-50" : ""}
                          >

                            <TableCell className="font-medium">
                              <div className="flex flex-col">
                                <span className={isAbsent ? "text-red-700" : ""}>{record.userName}</span>

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
                            <TableCell className="text-xs">
                              {studentPhone || "—"}
                            </TableCell>
                            <TableCell className="text-xs">
                              {parentPhone || "—"}
                            </TableCell>
                            <TableCell>{dateStr}</TableCell>
                            <TableCell>{checkInStr}</TableCell>
                            <TableCell>{checkOutStr}</TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={`text-xs font-normal ${isAbsent
                                  ? "border-red-300 text-red-700 bg-red-50"
                                  : isLate
                                    ? "border-amber-300 text-amber-700 bg-amber-50"
                                    : "border-emerald-300 text-emerald-700 bg-emerald-50"
                                  }`}
                              >
                                {statusText || "—"}
                              </Badge>

                            </TableCell>

                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!isEditable}
                                  title={
                                    isEditable
                                      ? "Edit"
                                      : "Absent row (no DB record to edit)"
                                  }
                                  onClick={() => openEditor(record)}
                                >
                                  <Pencil className="w-4 h-4 mr-1" />
                                  Edit
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </div>

        {/* Reports & Management */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Attendance Report */}
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

              <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
                <Input
                  type="date"
                  value={reportFilters.dateFrom}
                  onChange={(e) =>
                    setReportFilters((p) => ({ ...p, dateFrom: e.target.value }))
                  }
                />
                <Input
                  type="date"
                  value={reportFilters.dateTo}
                  onChange={(e) =>
                    setReportFilters((p) => ({ ...p, dateTo: e.target.value }))
                  }
                />

                {/* Grade dropdown */}
                <Select
                  value={reportFilters.grade || "all"}
                  onValueChange={(value) =>
                    setReportFilters((p) => ({
                      ...p,
                      grade: value === "all" ? "" : value,
                      page: 1,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Grade (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Grades</SelectItem>
                    {GRADE_OPTIONS.map((g) => (
                      <SelectItem key={g} value={g}>
                        {g}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Input
                  placeholder="Status (present/late...)"
                  value={reportFilters.status}
                  onChange={(e) =>
                    setReportFilters((p) => ({
                      ...p,
                      status: e.target.value,
                      page: 1,
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
                    setReportFilters((p) => ({
                      ...p,
                      pageSize: Number(e.target.value || 100),
                      page: 1,
                    }))
                  }
                />
              </div>

              {reportError && <div className="text-xs text-red-600">{reportError}</div>}

              {reportMeta && (
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Showing {reportRows.length} of {reportMeta.total} records (page{" "}
                    {reportMeta.page} / {reportMeta.totalPages || 1})
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={reportLoading || reportMeta.page <= 1}
                      onClick={() => handleGenerateReport(reportMeta.page - 1)}
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
                      onClick={() => handleGenerateReport(reportMeta.page + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}

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
                  <div className="max-h-[520px] overflow-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-white dark:bg-slate-900 z-10">
                        <TableRow>
                          <TableHead>Student</TableHead>
                          <TableHead>Grade</TableHead>
                          <TableHead>Student Phone</TableHead>
                          <TableHead>Parent Phone</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>In</TableHead>
                          <TableHead>Out</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {reportRows.map((row) => {
                          const inDate = safeDate(row.checkInAt);
                          const outDate = safeDate(row.checkOutAt);

                          const studentPhone = pickStudentPhone(row);
                          const parentPhone = pickParentPhone(row);

                          return (
                            <TableRow key={row.id}>
                              <TableCell className="font-medium">
                                <div className="flex flex-col">
                                  <span>{row.studentName}</span>
                                  <span className="text-[10px] text-muted-foreground">
                                    {row.studentEmail || "—"} • ID: {row.studentId}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell>{row.grade || "N/A"}</TableCell>
                              <TableCell className="text-xs">{studentPhone || "—"}</TableCell>
                              <TableCell className="text-xs">{parentPhone || "—"}</TableCell>
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
                                <Badge variant="outline" className="text-xs font-normal">
                                  {(row.status || "").toUpperCase()}
                                </Badge>
                              </TableCell>

                              <TableCell className="text-right">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openEditor(reportRowToEditorRecord(row))}
                                >
                                  <Pencil className="w-4 h-4 mr-1" />
                                  Edit
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Right column */}
          <div className="space-y-4">
            {/* Student Data */}
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

                <p className="text-[11px] text-muted-foreground">Export all students.</p>

                {/* QR Cards with filters */}
                <QrCardsPanel getAuthHeaders={getAuthHeaders} />

                {/* Import CSV */}
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
                      onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Expected columns:{" "}
                    <code>
                      name,email,password,role,grade,rollNumber,phoneNumber,parentPhoneNumber
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
                      className={`text-[11px] mt-1 ${importResult.type === "success"
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
                    onChange={(e) => setStudentForm((p) => ({ ...p, name: e.target.value }))}
                  />
                  <Input
                    type="email"
                    placeholder="Email"
                    value={studentForm.email}
                    onChange={(e) => setStudentForm((p) => ({ ...p, email: e.target.value }))}
                  />
                  <Input
                    type="password"
                    placeholder="Temporary password"
                    value={studentForm.password}
                    onChange={(e) =>
                      setStudentForm((p) => ({ ...p, password: e.target.value }))
                    }
                  />

                  <div className="grid grid-cols-2 gap-2">
                    <Select
                      value={studentForm.grade || "none"}
                      onValueChange={(value) =>
                        setStudentForm((p) => ({ ...p, grade: value === "none" ? "" : value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Grade (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No Grade</SelectItem>
                        {GRADE_OPTIONS.map((g) => (
                          <SelectItem key={g} value={g}>
                            {g}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Input
                      placeholder="Roll no. (optional)"
                      value={studentForm.rollNumber}
                      onChange={(e) =>
                        setStudentForm((p) => ({ ...p, rollNumber: e.target.value }))
                      }
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      placeholder="Student phone (optional)"
                      value={studentForm.phoneNumber}
                      onChange={(e) =>
                        setStudentForm((p) => ({ ...p, phoneNumber: e.target.value }))
                      }
                    />
                    <Input
                      placeholder="Parent phone (optional)"
                      value={studentForm.parentPhoneNumber}
                      onChange={(e) =>
                        setStudentForm((p) => ({
                          ...p,
                          parentPhoneNumber: e.target.value,
                        }))
                      }
                    />
                  </div>

                  <Button type="submit" size="sm" className="w-full" disabled={studentAddLoading}>
                    {studentAddLoading ? "Creating…" : "Create Student"}
                  </Button>
                  {studentAddMessage && (
                    <p
                      className={`text-[11px] mt-1 ${studentAddMessage.type === "success"
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
                  Provide the <strong>student ID</strong> (not user ID).
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
                    className={`text-[11px] ${studentDeleteMessage.type === "success"
                      ? "text-emerald-600"
                      : "text-red-600"
                      }`}
                  >
                    {studentDeleteMessage.text}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </section>
      </main>
    </div>
  );
}
