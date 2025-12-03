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

  // Redirect if not admin
  useEffect(() => {
    if (!user) {
      setLocation("/");
    } else if (user.role !== "admin") {
      setLocation("/student");
    }
  }, [user, setLocation]);

  // Fetch stats + records from backend
  useEffect(() => {
    if (!user || user.role !== "admin") return;

    let cancelled = false;

    async function fetchData() {
      try {
        setLoading(true);
        setError(null);

        const [statsRes, recordsRes] = await Promise.all([
          fetch(buildUrl("/admin/stats"), {
            credentials: "include",
          }),
          fetch(buildUrl("/admin/attendance-records"), {
            credentials: "include",
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

  // Filter logic
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

        {/* Main Content */}
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
                                {Number(
                                  record.location.lat
                                ).toFixed(4)}
                                ,{" "}
                                {Number(
                                  record.location.lng
                                ).toFixed(4)}
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
      </main>
    </div>
  );
}
