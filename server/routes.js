// server/routes.js
import express from "express";
import { and, eq, desc, gte, lt, sql } from "drizzle-orm";
import { db } from "./storage.js";
import {
  centers,
  users,
  students,
  attendanceRecords,
} from "../shared/schema.js";
import multer from "multer";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024, // 2MB, adjust if needed
  },
});


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

      // For MySQL, .returning() is not supported
      const userInsertResult = await db.insert(users).values({
        name,
        email,
        passwordHash: password, // TODO: hash password properly (bcrypt)
        role,
      });

      const userId = userInsertResult.insertId;
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId));

      if (!user) {
        return res.status(500).json({ error: "user_creation_failed" });
      }

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

        const studentInsertResult = await db.insert(students).values({
          userId: user.id,
          centerId: center.id,
          grade: grade || null,
          rollNumber: rollNumber || null,
        });

        const studentId = studentInsertResult.insertId;
        const [student] = await db
          .select()
          .from(students)
          .where(eq(students.id, studentId));

        studentProfile = student || null;
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
   *   studentId: number, // actually userId from frontend
   *   lat: number,
   *   lng: number,
   *   accuracy?: number,
   *   deviceId?: string
   * }
   *
   * Uses the student's center (from students.centerId) as the geofence:
   * center.lat/lng + center.radiusMeters
   * - Enforces 1 check-in per day (409)
   * - Enforces radius on server side
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

      const studentUserId = Number(studentId);

      // who is checking in? (student linked by userId)
      const [student] = await db
        .select()
        .from(students)
        .where(eq(students.userId, studentUserId));

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

      if (
        center.lat == null ||
        center.lng == null ||
        center.radiusMeters == null
      ) {
        return res
          .status(400)
          .json({ error: "center_geofence_not_configured" });
      }

      // ---- Prevent multiple check-ins per day (matches 409 handling in UI)
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

      const [existingToday] = await db
        .select({ id: attendanceRecords.id })
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.studentId, student.id),
            gte(attendanceRecords.checkInAt, todayStart),
            lt(attendanceRecords.checkInAt, tomorrowStart)
          )
        );

      if (existingToday) {
        return res.status(409).json({
          error: "already_checked_in",
          message: "You have already marked attendance for today.",
        });
      }
      // ---- END: duplicate check

      // Check distance from center
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

      const ipAddress = req.ip || req.headers["x-forwarded-for"] || null;
      const userAgent = req.headers["user-agent"] || null;

      // MySQL: no returning(); use insertId
      const insertResult = await db.insert(attendanceRecords).values({
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
      });

      const newId = insertResult.insertId;

      let [record] = await db
        .select()
        .from(attendanceRecords)
        .where(eq(attendanceRecords.id, newId));

      if (!record) {
        // Fallback if select fails for some reason
        record = {
          id: newId,
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
        };
      }

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
   * POST /student/attendance/check-out
   * Body: {
   *   studentId: number, // userId from frontend
   *   lat: number,
   *   lng: number,
   *   accuracy?: number,
   *   deviceId?: string
   * }
   *
   * - Finds today's "open" attendance record (no checkOutAt yet)
   * - Enforces geofence again on checkout
   */
  router.post("/student/attendance/check-out", async (req, res) => {
    try {
      const { studentId, lat, lng, accuracy, deviceId } = req.body || {};

      if (
        !studentId ||
        lat == null ||
        lng == null ||
        Number.isNaN(Number(lat)) ||
        Number.isNaN(Number(lng))
      ) {
        return res.status(400).json({ error: "missing_checkout_data" });
      }

      const studentUserId = Number(studentId);

      // resolve student
      const [student] = await db
        .select()
        .from(students)
        .where(eq(students.userId, studentUserId));

      if (!student) {
        return res.status(404).json({ error: "student_not_found" });
      }

      const [center] = await db
        .select()
        .from(centers)
        .where(eq(centers.id, student.centerId));

      if (!center) {
        return res.status(404).json({ error: "center_not_found" });
      }

      if (
        center.lat == null ||
        center.lng == null ||
        center.radiusMeters == null
      ) {
        return res
          .status(400)
          .json({ error: "center_geofence_not_configured" });
      }

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

      // find today's attendance record with no checkout yet
      const [openRecord] = await db
        .select()
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.studentId, student.id),
            gte(attendanceRecords.checkInAt, todayStart),
            lt(attendanceRecords.checkInAt, tomorrowStart),
            sql`${attendanceRecords.checkOutAt} IS NULL`
          )
        )
        .orderBy(desc(attendanceRecords.checkInAt));

      if (!openRecord) {
        return res.status(409).json({
          error: "no_open_session",
          message: "No open attendance record found for today.",
        });
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

      const ipAddress = req.ip || req.headers["x-forwarded-for"] || null;
      const userAgent = req.headers["user-agent"] || null;

      await db
        .update(attendanceRecords)
        .set({
          checkOutAt: now,
          checkOutLat: Number(lat),
          checkOutLng: Number(lng),
          checkOutAccuracy: accuracy != null ? Number(accuracy) : null,
          distanceFromCenterCheckoutMeters: distanceMeters,
          deviceId: deviceId || openRecord.deviceId || null,
          ipAddress: ipAddress || openRecord.ipAddress || null,
          userAgent: userAgent || openRecord.userAgent || null,
        })
        .where(eq(attendanceRecords.id, openRecord.id));

      const [updated] = await db
        .select()
        .from(attendanceRecords)
        .where(eq(attendanceRecords.id, openRecord.id));

      res.json({
        ok: true,
        record: updated || null,
        distanceMeters,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "student_check_out_failed" });
    }
  });


  /**
   * GET /student/geofence?studentId=123
   *
   * Returns the geofence for the student's center:
   * {
   *   centerId,
   *   centerName,
   *   centerLat,
   *   centerLng,
   *   radiusMeters
   * }
   *
   * NOTE: studentId is user.id from frontend
   */
  router.get("/student/geofence", async (req, res) => {
    try {
      const studentUserId = Number(req.query.studentId);

      if (!studentUserId) {
        return res.status(400).json({ error: "studentId_required" });
      }

      // Find the student by userId
      const [student] = await db
        .select()
        .from(students)
        .where(eq(students.userId, studentUserId));

      if (!student) {
        return res.status(404).json({ error: "student_not_found" });
      }

      // Get their center
      const [center] = await db
        .select()
        .from(centers)
        .where(eq(centers.id, student.centerId));

      if (!center) {
        return res.status(404).json({ error: "center_not_found" });
      }

      if (
        center.lat == null ||
        center.lng == null ||
        center.radiusMeters == null
      ) {
        return res
          .status(400)
          .json({ error: "center_geofence_not_configured" });
      }

      res.json({
        centerId: center.id,
        centerName: center.name,
        centerLat: Number(center.lat),
        centerLng: Number(center.lng),
        radiusMeters: Number(center.radiusMeters),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "student_geofence_failed" });
    }
  });

  /**
   * GET /student/attendance-history?studentId=123
   * Returns recent attendance records for one student.
   *
   * NOTE: studentId is user.id from frontend
   */
  router.get("/student/attendance-history", async (req, res) => {
    try {
      const studentUserId = Number(req.query.studentId);
      if (!studentUserId) {
        return res.status(400).json({ error: "studentId_required" });
      }

      // Resolve the student by userId
      const [student] = await db
        .select()
        .from(students)
        .where(eq(students.userId, studentUserId));

      if (!student) {
        return res.status(404).json({ error: "student_not_found" });
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
        .where(eq(attendanceRecords.studentId, student.id))
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
   * GET /admin/attendance-report
   *
   * Query params:
   *  - centerId?: number
   *  - grade?: string
   *  - status?: string ("present", "late", etc.)
   *  - dateFrom?: YYYY-MM-DD
   *  - dateTo?: YYYY-MM-DD
   *  - page?: number (default 1)
   *  - pageSize?: number (default 50, max 500)
   *
   * Returns:
   * {
   *   meta: { page, pageSize, total, totalPages },
   *   rows: [ ... ]
   * }
   */
  router.get("/admin/attendance-report", async (req, res) => {
    try {
      const centerId = req.query.centerId ? Number(req.query.centerId) : null;
      const grade = req.query.grade ? String(req.query.grade) : null;
      const status = req.query.status ? String(req.query.status) : null;
      const dateFromStr = req.query.dateFrom
        ? String(req.query.dateFrom)
        : null;
      const dateToStr = req.query.dateTo ? String(req.query.dateTo) : null;

      let page = parseInt(String(req.query.page || "1"), 10);
      let pageSize = parseInt(String(req.query.pageSize || "50"), 10);

      if (Number.isNaN(page) || page < 1) page = 1;
      if (Number.isNaN(pageSize) || pageSize < 1) pageSize = 50;
      if (pageSize > 500) pageSize = 500;

      const now = new Date();
      let fromDate = dateFromStr ? new Date(dateFromStr) : null;
      let toDate = dateToStr ? new Date(dateToStr) : null;

      if (fromDate && Number.isNaN(fromDate.getTime())) {
        return res.status(400).json({ error: "invalid_dateFrom" });
      }
      if (toDate && Number.isNaN(toDate.getTime())) {
        return res.status(400).json({ error: "invalid_dateTo" });
      }

      // default: last 30 days
      if (!fromDate && !toDate) {
        toDate = now;
        fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      } else if (fromDate && !toDate) {
        toDate = now;
      } else if (!fromDate && toDate) {
        fromDate = new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      // Normalize to UTC day bounds [fromStart, toEnd)
      const fromStart = new Date(
        Date.UTC(
          fromDate.getUTCFullYear(),
          fromDate.getUTCMonth(),
          fromDate.getUTCDate(),
          0,
          0,
          0
        )
      );
      const toEnd = new Date(
        Date.UTC(
          toDate.getUTCFullYear(),
          toDate.getUTCMonth(),
          toDate.getUTCDate() + 1,
          0,
          0,
          0
        )
      );

      const conditions = [
        gte(attendanceRecords.checkInAt, fromStart),
        lt(attendanceRecords.checkInAt, toEnd),
      ];

      if (centerId) {
        conditions.push(eq(attendanceRecords.centerId, centerId));
      }
      if (grade) {
        conditions.push(eq(students.grade, grade));
      }
      if (status) {
        conditions.push(eq(attendanceRecords.status, status));
      }

      const whereExpr = and(...conditions);
      const offset = (page - 1) * pageSize;

      // count total rows
      const [countRow] = await db
        .select({ count: sql`count(*)` })
        .from(attendanceRecords)
        .leftJoin(students, eq(attendanceRecords.studentId, students.id))
        .leftJoin(users, eq(students.userId, users.id))
        .leftJoin(centers, eq(attendanceRecords.centerId, centers.id))
        .where(whereExpr);

      const total = Number(countRow?.count || 0);
      const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;

      const rows = await db
        .select({
          id: attendanceRecords.id,
          checkInAt: attendanceRecords.checkInAt,
          checkOutAt: attendanceRecords.checkOutAt,
          status: attendanceRecords.status,
          checkInLat: attendanceRecords.checkInLat,
          checkInLng: attendanceRecords.checkInLng,
          checkOutLat: attendanceRecords.checkOutLat,
          checkOutLng: attendanceRecords.checkOutLng,
          distanceFromCenterMeters: attendanceRecords.distanceFromCenterMeters,
          distanceFromCenterCheckoutMeters:
            attendanceRecords.distanceFromCenterCheckoutMeters,
          studentId: students.id,
          studentGrade: students.grade,
          rollNumber: students.rollNumber,
          userName: users.name,
          userEmail: users.email,
          centerId: centers.id,
          centerName: centers.name,
          centerCode: centers.code,
        })
        .from(attendanceRecords)
        .leftJoin(students, eq(attendanceRecords.studentId, students.id))
        .leftJoin(users, eq(students.userId, users.id))
        .leftJoin(centers, eq(attendanceRecords.centerId, centers.id))
        .where(whereExpr)
        .orderBy(desc(attendanceRecords.checkInAt))
        .limit(pageSize)
        .offset(offset);

      const mapped = rows.map((r) => ({
        id: r.id,
        studentId: r.studentId,
        studentName: r.userName || "Unknown",
        studentEmail: r.userEmail || null,
        grade: r.studentGrade || null,
        rollNumber: r.rollNumber || null,
        centerId: r.centerId,
        centerName: r.centerName,
        centerCode: r.centerCode,
        checkInAt: r.checkInAt,
        checkOutAt: r.checkOutAt,
        status: r.status || "present",
        checkInLocation:
          r.checkInLat != null && r.checkInLng != null
            ? { lat: Number(r.checkInLat), lng: Number(r.checkInLng) }
            : null,
        checkOutLocation:
          r.checkOutLat != null && r.checkOutLng != null
            ? { lat: Number(r.checkOutLat), lng: Number(r.checkOutLng) }
            : null,
        distanceFromCenterMeters:
          r.distanceFromCenterMeters != null
            ? Number(r.distanceFromCenterMeters)
            : null,
        distanceFromCenterCheckoutMeters:
          r.distanceFromCenterCheckoutMeters != null
            ? Number(r.distanceFromCenterCheckoutMeters)
            : null,
      }));

      res.json({
        meta: {
          page,
          pageSize,
          total,
          totalPages,
          dateFrom: fromStart,
          dateTo: toEnd,
        },
        rows: mapped,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "admin_attendance_report_failed" });
    }
  });

  /**
   * GET /admin/students/export?centerId=1
   *
   * Exports students + their hashed password as CSV.
   */
  router.get("/admin/students/export", async (req, res) => {
    try {
      const centerId = req.query.centerId ? Number(req.query.centerId) : null;

      const conditions = [];
      if (centerId) {
        conditions.push(eq(students.centerId, centerId));
      }
      const whereExpr = conditions.length ? and(...conditions) : undefined;

      let query = db
        .select({
          studentId: students.id,
          userId: users.id,
          name: users.name,
          email: users.email,
          passwordHash: users.passwordHash,
          grade: students.grade,
          rollNumber: students.rollNumber,
          centerName: centers.name,
          centerCode: centers.code,
        })
        .from(students)
        .leftJoin(users, eq(students.userId, users.id))
        .leftJoin(centers, eq(students.centerId, centers.id));

      if (whereExpr) {
        query = query.where(whereExpr);
      }

      const rows = await query;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="students_${centerId || "all"}.csv"`
      );

      const header = [
        "student_id",
        "user_id",
        "name",
        "email",
        "password_hash",
        "grade",
        "roll_number",
        "center_name",
        "center_code",
      ];
      const lines = [header.join(",")];

      for (const r of rows) {
        const row = [
          r.studentId,
          r.userId,
          r.name || "",
          r.email || "",
          r.passwordHash || "",
          r.grade || "",
          r.rollNumber || "",
          r.centerName || "",
          r.centerCode || "",
        ];
        lines.push(row.join(","));
      }

      res.send(lines.join("\n"));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "admin_students_export_failed" });
    }
  });


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



  /**
   * GET /student/attendance-export?studentId=123&from=YYYY-MM-DD&to=YYYY-MM-DD&format=csv|json
   *
   * - studentId is users.id on frontend (like other student routes)
   * - from/to are required and interpreted as dates in UTC day-bounds
   * - default format is "csv"
   */
  router.get("/student/attendance/report", async (req, res) => {
    try {
      const studentUserId = Number(req.query.studentId);
      const fromStr = String(req.query.from || "");
      const toStr = String(req.query.to || "");
      const format = (req.query.format || "csv").toString().toLowerCase();

      if (!studentUserId) {
        return res.status(400).json({ error: "studentId_required" });
      }
      if (!fromStr || !toStr) {
        return res.status(400).json({ error: "from_and_to_required" });
      }

      const fromDateRaw = new Date(fromStr);
      const toDateRaw = new Date(toStr);

      if (Number.isNaN(fromDateRaw.getTime()) || Number.isNaN(toDateRaw.getTime())) {
        return res.status(400).json({ error: "invalid_date_range" });
      }

      // Normalize to UTC day bounds [fromStart, toEnd)
      const fromStart = new Date(
        Date.UTC(
          fromDateRaw.getUTCFullYear(),
          fromDateRaw.getUTCMonth(),
          fromDateRaw.getUTCDate(),
          0,
          0,
          0
        )
      );
      const toEnd = new Date(
        Date.UTC(
          toDateRaw.getUTCFullYear(),
          toDateRaw.getUTCMonth(),
          toDateRaw.getUTCDate() + 1,
          0,
          0,
          0
        )
      );

      // Resolve student by userId
      const [student] = await db
        .select()
        .from(students)
        .where(eq(students.userId, studentUserId));

      if (!student) {
        return res.status(404).json({ error: "student_not_found" });
      }

      const rows = await db
        .select()
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.studentId, student.id),
            gte(attendanceRecords.checkInAt, fromStart),
            lt(attendanceRecords.checkInAt, toEnd)
          )
        )
        .orderBy(desc(attendanceRecords.checkInAt));

      if (format === "json") {
        const mapped = rows.map((r) => ({
          id: r.id,
          checkInAt: r.checkInAt,
          checkOutAt: r.checkOutAt,
          status: r.status,
          checkInLat: r.checkInLat,
          checkInLng: r.checkInLng,
          checkOutLat: r.checkOutLat,
          checkOutLng: r.checkOutLng,
          distanceFromCenterMeters: r.distanceFromCenterMeters,
          distanceFromCenterCheckoutMeters: r.distanceFromCenterCheckoutMeters,
        }));
        return res.json({ from: fromStart, to: toEnd, records: mapped });
      }

      // default: CSV
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="attendance_${studentUserId}_${fromStr}_${toStr}.csv"`
      );

      const header = [
        "id",
        "check_in_at",
        "check_out_at",
        "status",
        "check_in_lat",
        "check_in_lng",
        "check_out_lat",
        "check_out_lng",
        "distance_from_center_m",
        "distance_from_center_checkout_m",
      ];

      const lines = [header.join(",")];

      for (const r of rows) {
        const row = [
          r.id,
          r.checkInAt ? r.checkInAt.toISOString() : "",
          r.checkOutAt ? r.checkOutAt.toISOString() : "",
          r.status || "",
          r.checkInLat != null ? Number(r.checkInLat) : "",
          r.checkInLng != null ? Number(r.checkInLng) : "",
          r.checkOutLat != null ? Number(r.checkOutLat) : "",
          r.checkOutLng != null ? Number(r.checkOutLng) : "",
          r.distanceFromCenterMeters != null
            ? Number(r.distanceFromCenterMeters)
            : "",
          r.distanceFromCenterCheckoutMeters != null
            ? Number(r.distanceFromCenterCheckoutMeters)
            : "",
        ];
        lines.push(row.join(","));
      }

      res.send(lines.join("\n"));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "student_export_failed" });
    }
  });




    /**
   * POST /admin/students
   * Body: { name, email, password, centerId, grade?, rollNumber? }
   */
  router.post("/admin/students", async (req, res) => {
    try {
      const { name, email, password, centerId, grade, rollNumber } =
        req.body || {};

      if (!name || !email || !password || !centerId) {
        return res.status(400).json({ error: "missing_fields" });
      }

      // ensure center exists
      const [center] = await db
        .select()
        .from(centers)
        .where(eq(centers.id, Number(centerId)));

      if (!center) {
        return res.status(400).json({ error: "center_not_found" });
      }

      // TODO: hash password using bcrypt in real prod
      const userInsertResult = await db.insert(users).values({
        name,
        email,
        passwordHash: password,
        role: "student",
      });
      const userId = userInsertResult.insertId;

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId));

      if (!user) {
        return res.status(500).json({ error: "user_creation_failed" });
      }

      const studentInsertResult = await db.insert(students).values({
        userId: user.id,
        centerId: center.id,
        grade: grade || null,
        rollNumber: rollNumber || null,
      });

      const studentId = studentInsertResult.insertId;
      const [student] = await db
        .select()
        .from(students)
        .where(eq(students.id, studentId));

      res.status(201).json({ user, student });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "admin_add_student_failed" });
    }
  });

    /**
   * DELETE /admin/students/:studentId
   *
   * - Deletes student profile
   * - Also deletes user if role === 'student'
   */
  router.delete("/admin/students/:studentId", async (req, res) => {
    try {
      const studentId = Number(req.params.studentId);
      if (!studentId) {
        return res.status(400).json({ error: "invalid_student_id" });
      }

      const [student] = await db
        .select()
        .from(students)
        .where(eq(students.id, studentId));

      if (!student) {
        return res.status(404).json({ error: "student_not_found" });
      }

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, student.userId));

      // delete student first (FK)
      await db.delete(students).where(eq(students.id, studentId));

      // delete user only if it's a pure student account
      if (user && user.role === "student") {
        await db.delete(users).where(eq(users.id, user.id));
      }

      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "admin_delete_student_failed" });
    }
  });

    /**
   * PATCH /admin/centers/:centerId/location
   * Body: { lat: number, lng: number, radiusMeters: number }
   */
  router.patch("/admin/centers/:centerId/location", async (req, res) => {
    try {
      const centerId = Number(req.params.centerId);
      const { lat, lng, radiusMeters } = req.body || {};

      if (
        !centerId ||
        lat == null ||
        lng == null ||
        radiusMeters == null ||
        Number.isNaN(Number(lat)) ||
        Number.isNaN(Number(lng)) ||
        Number.isNaN(Number(radiusMeters))
      ) {
        return res.status(400).json({ error: "invalid_payload" });
      }

      if (Number(radiusMeters) <= 0) {
        return res.status(400).json({ error: "radius_must_be_positive" });
      }

      const [center] = await db
        .select()
        .from(centers)
        .where(eq(centers.id, centerId));

      if (!center) {
        return res.status(404).json({ error: "center_not_found" });
      }

      await db
        .update(centers)
        .set({
          lat: Number(lat),
          lng: Number(lng),
          radiusMeters: Number(radiusMeters),
        })
        .where(eq(centers.id, centerId));

      const [updated] = await db
        .select()
        .from(centers)
        .where(eq(centers.id, centerId));

      res.json({ ok: true, center: updated || null });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "admin_update_center_location_failed" });
    }
  });


    /**
   * POST /admin/students/import
   *
   * Content-Type: multipart/form-data
   * Body:
   *   file: CSV file
   *
   * CSV header expected:
   *   name,email,password,role,centerCode,grade,rollNumber
   *
   * Behavior:
   *   - For each row:
   *       - If user with same email exists -> skip (counted as skippedExisting)
   *       - Else create user (role=admin/student)
   *       - If role=student and centerCode is valid -> create students row
   *   - Returns JSON summary with counts and per-row issues.
   */
  router.post(
    "/admin/students/import",
    upload.single("file"),
    async (req, res) => {
      try {
        if (!req.file || !req.file.buffer) {
          return res.status(400).json({ error: "file_required" });
        }

        const csvRaw = req.file.buffer.toString("utf8");
        const lines = csvRaw
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.length > 0);

        if (lines.length < 2) {
          return res.status(400).json({ error: "csv_has_no_data_rows" });
        }

        const header = lines[0].split(",").map((h) => h.trim());
        const idx = (name) => header.indexOf(name);

        const idxName = idx("name");
        const idxEmail = idx("email");
        const idxPassword = idx("password");
        const idxRole = idx("role");
        const idxCenterCode = idx("centerCode");
        const idxGrade = idx("grade");
        const idxRollNumber = idx("rollNumber");

        const requiredCols = ["name", "email", "password"];
        for (const col of requiredCols) {
          if (idx(col) === -1) {
            return res.status(400).json({
              error: "missing_required_column",
              column: col,
            });
          }
        }

        let createdUsers = 0;
        let createdStudents = 0;
        let skippedExisting = 0;
        let rowErrors = [];

        // Simple CSV splitting; if you need quoted values with commas,
        // consider using a CSV library instead.
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          if (!line) continue;

          const parts = line.split(",");
          const name = (parts[idxName] || "").trim();
          const email = (parts[idxEmail] || "").trim().toLowerCase();
          const password = (parts[idxPassword] || "").trim();
          const roleRaw =
            idxRole !== -1 ? (parts[idxRole] || "").trim() : "";
          const centerCode =
            idxCenterCode !== -1 ? (parts[idxCenterCode] || "").trim() : "";
          const grade =
            idxGrade !== -1 ? (parts[idxGrade] || "").trim() : "";
          const rollNumber =
            idxRollNumber !== -1 ? (parts[idxRollNumber] || "").trim() : "";

          const rowNumber = i + 1; // for messages

          if (!name || !email || !password) {
            rowErrors.push({
              row: rowNumber,
              email,
              error: "missing_name_email_or_password",
            });
            continue;
          }

          const role = roleRaw === "admin" ? "admin" : "student";

          try {
            // Check if user exists
            const [existing] = await db
              .select()
              .from(users)
              .where(eq(users.email, email));

            if (existing) {
              skippedExisting++;
              continue;
            }

            // TODO: In production hash with bcrypt
            const userInsert = await db.insert(users).values({
              name,
              email,
              passwordHash: password,
              role,
            });

            const userId = userInsert.insertId;
            createdUsers++;

            if (role === "student") {
              if (!centerCode) {
                rowErrors.push({
                  row: rowNumber,
                  email,
                  error: "student_missing_centerCode",
                });
                continue;
              }

              const [center] = await db
                .select()
                .from(centers)
                .where(eq(centers.code, centerCode));

              if (!center) {
                rowErrors.push({
                  row: rowNumber,
                  email,
                  centerCode,
                  error: "center_not_found",
                });
                continue;
              }

              await db.insert(students).values({
                userId,
                centerId: center.id,
                grade: grade || null,
                rollNumber: rollNumber || null,
              });

              createdStudents++;
            }
          } catch (err) {
            console.error(`Error on CSV row ${rowNumber}`, err);
            rowErrors.push({
              row: rowNumber,
              email,
              error: "exception",
              message: err.message || String(err),
            });
          }
        }

        res.json({
          ok: true,
          summary: {
            createdUsers,
            createdStudents,
            skippedExisting,
            rowsProcessed: lines.length - 1,
            rowsWithErrors: rowErrors.length,
          },
          errors: rowErrors,
        });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "admin_students_import_failed" });
      }
    }
  );
  /**
   * GET /admin/attendance-report/export
   *
   * Query params (all optional, same as /admin/attendance-report):
   *   centerId?: number
   *   grade?: string
   *   status?: string
   *   dateFrom?: YYYY-MM-DD
   *   dateTo?: YYYY-MM-DD
   *
   * Returns: CSV file (attachment)
   */
  router.get("/admin/attendance-report/export", async (req, res) => {
    try {
      const { centerId, grade, status, dateFrom, dateTo } = req.query || {};

      // Build WHERE conditions
      const whereClauses = [];

      // Date range filter (inclusive start, exclusive end)
      if (dateFrom) {
        const fromDate = new Date(`${dateFrom}T00:00:00.000Z`);
        if (!Number.isNaN(fromDate.getTime())) {
          whereClauses.push(gte(attendanceRecords.checkInAt, fromDate));
        }
      }

      if (dateTo) {
        // exclusive upper bound: next day at 00:00 UTC
        const toDate = new Date(`${dateTo}T00:00:00.000Z`);
        if (!Number.isNaN(toDate.getTime())) {
          const endExclusive = new Date(toDate);
          endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
          whereClauses.push(lt(attendanceRecords.checkInAt, endExclusive));
        }
      }

      if (centerId) {
        whereClauses.push(eq(attendanceRecords.centerId, Number(centerId)));
      }

      if (status) {
        whereClauses.push(eq(attendanceRecords.status, String(status)));
      }

      if (grade) {
        // filter via students.grade, so we’ll add this after joins using and()
        // we can't use students.grade here yet, so we’ll handle below
      }

      // Base query with joins
      let query = db
        .select({
          id: attendanceRecords.id,
          checkInAt: attendanceRecords.checkInAt,
          status: attendanceRecords.status,
          checkInLat: attendanceRecords.checkInLat,
          checkInLng: attendanceRecords.checkInLng,
          studentId: students.id,
          studentGrade: students.grade,
          studentRoll: students.rollNumber,
          studentName: users.name,
          studentEmail: users.email,
          centerId: centers.id,
          centerName: centers.name,
          centerCode: centers.code,
        })
        .from(attendanceRecords)
        .leftJoin(students, eq(attendanceRecords.studentId, students.id))
        .leftJoin(users, eq(students.userId, users.id))
        .leftJoin(centers, eq(attendanceRecords.centerId, centers.id));

      if (whereClauses.length > 0) {
        query = query.where(and(...whereClauses));
      }

      // extra grade filter via joined students table (if provided)
      if (grade) {
        query = query.where(
          and(
            ...(whereClauses.length > 0 ? whereClauses : []),
            eq(students.grade, String(grade))
          )
        );
      }

      // You can add an upper limit if needed, e.g. .limit(10000)
      const rows = await query.orderBy(desc(attendanceRecords.checkInAt));

      // Build CSV
      const escapeCsv = (value) => {
        if (value == null) return "";
        const str = String(value);
        // escape double quotes by doubling them
        const escaped = str.replace(/"/g, '""');
        return `"${escaped}"`;
      };

      const header = [
        "Record ID",
        "Date",
        "Time",
        "Status",
        "Student ID",
        "Student Name",
        "Student Email",
        "Grade",
        "Roll Number",
        "Center ID",
        "Center Name",
        "Center Code",
        "Check-in Lat",
        "Check-in Lng",
      ];

      const lines = [header.join(",")];

      for (const r of rows) {
        const dt = r.checkInAt ? new Date(r.checkInAt) : null;
        const dateStr = dt
          ? dt.toISOString().slice(0, 10) // YYYY-MM-DD
          : "";
        const timeStr = dt ? dt.toISOString().slice(11, 19) : ""; // HH:MM:SS

        const line = [
          escapeCsv(r.id),
          escapeCsv(dateStr),
          escapeCsv(timeStr),
          escapeCsv(r.status || "present"),
          escapeCsv(r.studentId ?? ""),
          escapeCsv(r.studentName || ""),
          escapeCsv(r.studentEmail || ""),
          escapeCsv(r.studentGrade || ""),
          escapeCsv(r.studentRoll || ""),
          escapeCsv(r.centerId ?? ""),
          escapeCsv(r.centerName || ""),
          escapeCsv(r.centerCode || ""),
          escapeCsv(
            r.checkInLat != null ? Number(r.checkInLat).toFixed(6) : ""
          ),
          escapeCsv(
            r.checkInLng != null ? Number(r.checkInLng).toFixed(6) : ""
          ),
        ].join(",");

        lines.push(line);
      }

      const csv = lines.join("\n");

      // Build filename from filters
      const safeFrom = dateFrom || "all";
      const safeTo = dateTo || "all";
      const fileName = `attendance_report_${safeFrom}_to_${safeTo}.csv`;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fileName}"`
      );
      res.status(200).send(csv);
    } catch (err) {
      console.error("admin_attendance_report_export_failed:", err);
      res
        .status(500)
        .json({ error: "admin_attendance_report_export_failed" });
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


