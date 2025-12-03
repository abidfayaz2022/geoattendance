// server/routes.js
import express from "express";
import { and, eq, desc, gte, lt, sql } from "drizzle-orm";
import { db } from "./storage.js";
import { centers, users, students, attendanceRecords } from "../shared/schema.js";

export function createRouter() {
  const router = express.Router();

  // ─────────────────────────
  // Auth (SUPER SIMPLE)
  // ─────────────────────────

  /**
   * POST /auth/register
   * Body: {
   *   name,
   *   email,
   *   password,
   *   role?: "admin" | "student" (default "student"),
   *   centerId?: number (required if role === "student"),
   *   grade?: string,
   *   rollNumber?: string
   * }
   */
  router.post("/auth/register", async (req, res) => {
    try {
      const {
        name,
        email,
        password,
        role: rawRole,
        centerId,
        grade,
        rollNumber,
      } = req.body || {};

      if (!name || !email || !password) {
        return res.status(400).json({ error: "missing_fields" });
      }

      const role = rawRole === "admin" ? "admin" : "student";

      if (role === "student" && !centerId) {
        return res
          .status(400)
          .json({ error: "centerId_required_for_student" });
      }

      // TODO: hash password properly (bcrypt)
      const [user] = await db
        .insert(users)
        .values({
          name,
          email,
          passwordHash: password,
          role,
        })
        .returning();

      let studentProfile = null;

      if (role === "student") {
        // ensure center exists
        const [center] = await db
          .select()
          .from(centers)
          .where(eq(centers.id, Number(centerId)));

        if (!center) {
          return res.status(400).json({ error: "center_not_found" });
        }

        const [student] = await db
          .insert(students)
          .values({
            userId: user.id,
            centerId: center.id,
            grade: grade || null,
            rollNumber: rollNumber || null,
          })
          .returning();

        studentProfile = student;
      }

      res.json({ user, student: studentProfile });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "register_failed" });
    }
  });

  /**
   * POST /auth/login
   * Body: { email, password }
   * NOTE: plain-text comparison (replace with bcrypt later).
   */
  router.post("/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body || {};

      if (!email || !password) {
        return res.status(400).json({ error: "missing_credentials" });
      }

      const [user] = await db
        .select()
        .from(users)
        .where(
          and(eq(users.email, email), eq(users.passwordHash, password)) // TODO: bcrypt
        );

      if (!user) {
        return res.status(401).json({ error: "invalid_credentials" });
      }

      // For now return user directly; later you can add JWT / sessions
      res.json({ user });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "login_failed" });
    }
  });

  // ─────────────────────────
  // STUDENT APIs
  // ─────────────────────────

  /**
   * POST /student/attendance/check-in
   * Body: {
   *   studentId: number,
   *   lat: number,
   *   lng: number,
   *   accuracy?: number,
   *   deviceId?: string
   * }
   *
   * Uses the student's center (from students.centerId) as the geofence:
   * center.lat/lng + center.radiusMeters
   */
  router.post("/student/attendance/check-in", async (req, res) => {
    try {
      const { studentId, lat, lng, accuracy, deviceId } = req.body || {};

      if (
        !studentId ||
        lat == null ||
        lng == null ||
        Number.isNaN(Number(lat)) ||
        Number.isNaN(Number(lng))
      ) {
        return res.status(400).json({ error: "missing_check_in_data" });
      }

      // who is checking in?
      const [student] = await db
        .select()
        .from(students)
        .where(eq(students.id, Number(studentId)));

      if (!student) {
        return res.status(404).json({ error: "student_not_found" });
      }

      // which center?
      const [center] = await db
        .select()
        .from(centers)
        .where(eq(centers.id, student.centerId));

      if (!center) {
        return res.status(404).json({ error: "center_not_found" });
      }

      const distanceMeters = haversine(
        Number(center.lat),
        Number(center.lng),
        Number(lat),
        Number(lng)
      );

      const withinRadius = distanceMeters <= Number(center.radiusMeters);

      if (!withinRadius) {
        return res.status(403).json({
          error: "outside_geofence",
          distanceMeters,
          radiusMeters: center.radiusMeters,
          allowed: false,
        });
      }

      const now = new Date();
      const ipAddress = req.ip || req.headers["x-forwarded-for"] || null;
      const userAgent = req.headers["user-agent"] || null;

      // New record each check-in (your schema has no unique constraint)
      const [record] = await db
        .insert(attendanceRecords)
        .values({
          studentId: student.id,
          centerId: center.id,
          checkInAt: now,
          status: "present",
          checkInLat: Number(lat),
          checkInLng: Number(lng),
          checkInAccuracy: accuracy != null ? Number(accuracy) : null,
          distanceFromCenterMeters: distanceMeters,
          deviceId: deviceId || null,
          ipAddress,
          userAgent,
        })
        .returning();

      res.json({
        ok: true,
        record,
        distanceMeters,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "student_check_in_failed" });
    }
  });

  /**
   * GET /student/attendance-history?studentId=123
   * Returns recent attendance records for one student.
   */
  router.get("/student/attendance-history", async (req, res) => {
    try {
      const studentId = Number(req.query.studentId);
      if (!studentId) {
        return res.status(400).json({ error: "studentId_required" });
      }

      const rows = await db
        .select({
          id: attendanceRecords.id,
          date: attendanceRecords.checkInAt,
          status: attendanceRecords.status,
          checkInLat: attendanceRecords.checkInLat,
          checkInLng: attendanceRecords.checkInLng,
        })
        .from(attendanceRecords)
        .where(eq(attendanceRecords.studentId, studentId))
        .orderBy(desc(attendanceRecords.checkInAt))
        .limit(50);

      const mapped = rows.map((r) => ({
        id: r.id,
        date: r.date,
        time: r.date ? r.date.toISOString() : null,
        status: r.status || "present",
        location:
          r.checkInLat != null && r.checkInLng != null
            ? { lat: Number(r.checkInLat), lng: Number(r.checkInLng) }
            : null,
      }));

      res.json(mapped);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "student_history_failed" });
    }
  });

  // ─────────────────────────
  // ADMIN APIs
  // ─────────────────────────

  /**
   * GET /admin/stats
   * Returns { totalStudents, presentToday, attendanceRate }
   */
  router.get("/admin/stats", async (_req, res) => {
    try {
      // total students
      const [studentsCountRow] = await db
        .select({ count: sql`count(*)` })
        .from(students);

      const totalStudents = Number(studentsCountRow?.count || 0);

      const now = new Date();
      const todayStart = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          0,
          0,
          0
        )
      );
      const tomorrowStart = new Date(todayStart);
      tomorrowStart.setUTCDate(todayStart.getUTCDate() + 1);

      const [presentRow] = await db
        .select({ count: sql`count(*)` })
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.status, "present"),
            gte(attendanceRecords.checkInAt, todayStart),
            lt(attendanceRecords.checkInAt, tomorrowStart)
          )
        );

      const presentToday = Number(presentRow?.count || 0);
      const attendanceRate =
        totalStudents > 0
          ? Math.round((presentToday / totalStudents) * 100)
          : 0;

      res.json({
        totalStudents,
        presentToday,
        attendanceRate,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "admin_stats_failed" });
    }
  });

  /**
   * GET /admin/attendance-records
   * Returns flattened records for admin table.
   *
   * [
   *   {
   *     id,
   *     userId,      // student.id
   *     userName,    // users.name
   *     userGrade,   // students.grade
   *     date,
   *     time,
   *     status,
   *     location: { lat, lng }
   *   }
   * ]
   */
  router.get("/admin/attendance-records", async (_req, res) => {
    try {
      const rows = await db
        .select({
          id: attendanceRecords.id,
          date: attendanceRecords.checkInAt,
          status: attendanceRecords.status,
          checkInLat: attendanceRecords.checkInLat,
          checkInLng: attendanceRecords.checkInLng,
          studentId: students.id,
          studentGrade: students.grade,
          userName: users.name,
        })
        .from(attendanceRecords)
        .leftJoin(students, eq(attendanceRecords.studentId, students.id))
        .leftJoin(users, eq(students.userId, users.id))
        .orderBy(desc(attendanceRecords.checkInAt))
        .limit(200);

      const mapped = rows.map((r) => ({
        id: r.id,
        userId: String(r.studentId ?? ""),
        userName: r.userName || "Unknown",
        userGrade: r.studentGrade || "N/A",
        date: r.date,
        time: r.date != null ? r.date.toISOString() : null,
        status: r.status || "present",
        location:
          r.checkInLat != null && r.checkInLng != null
            ? { lat: Number(r.checkInLat), lng: Number(r.checkInLng) }
            : null,
      }));

      res.json(mapped);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "admin_records_failed" });
    }
  });

  return router;
}

// ─────────────────────────────
// Haversine distance helper
// ─────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371_000; // meters
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
