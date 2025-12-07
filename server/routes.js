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
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024, // 2MB, adjust if needed
  },
});

// ─────────────────────────
// Simple auth middlewares
// ─────────────────────────

/**
 * Reads credentials from headers:
 *   x-user-id:       user.id  (number)
 *   x-user-password: users.passwordHash  (what you already store)
 *
 * Verifies against DB, attaches req.user.
 */
async function simpleAuth(req, res, next) {
  try {
    const rawId = req.header("x-user-id");
    const password = req.header("x-user-password");

    if (!rawId || !password) {
      return res.status(401).json({ error: "missing_auth_headers" });
    }

    const userId = Number(rawId);
    if (!userId || Number.isNaN(userId)) {
      return res.status(401).json({ error: "invalid_user_id" });
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId));

    if (!user) {
      return res.status(401).json({ error: "user_not_found" });
    }

    // You currently store plain password in passwordHash; compare directly.
    // If you later hash it, you can change this to bcrypt.compare.
    if (user.passwordHash !== password) {
      return res.status(401).json({ error: "invalid_credentials" });
    }

    req.user = user;
    return next();
  } catch (err) {
    console.error("simpleAuth failed:", err);
    return res.status(500).json({ error: "auth_failed" });
  }
}

/**
 * Role guard: require that req.user.role === role.
 */
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "unauthorized" });
    }
    if (req.user.role !== role) {
      return res.status(403).json({ error: "forbidden" });
    }
    return next();
  };
}

export function createRouter() {
  const router = express.Router();

  // ─────────────────────────
  // Auth (SUPER SIMPLE)
  // ─────────────────────────

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

      const normalizedEmail = String(email).toLowerCase().trim();

      // optional: prevent duplicate emails
      const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.email, normalizedEmail));

      if (existing) {
        return res.status(409).json({ error: "user_already_exists" });
      }

      // For now you store plain password in passwordHash
      const userInsertResult = await db.insert(users).values({
        name,
        email: normalizedEmail,
        passwordHash: password,
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
   * Returns user (including passwordHash), which frontend can store
   * and resend via headers on each request.
   */
  router.post("/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body || {};

      if (!email || !password) {
        return res.status(400).json({ error: "missing_credentials" });
      }

      const normalizedEmail = String(email).toLowerCase().trim();

      const [user] = await db
        .select()
        .from(users)
        .where(
          and(
            eq(users.email, normalizedEmail),
            eq(users.passwordHash, password)
          )
        );

      if (!user) {
        return res.status(401).json({ error: "invalid_credentials" });
      }

      res.json({ user });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "login_failed" });
    }
  });

  // ─────────────────────────
  // STUDENT APIs (protected)
  // ─────────────────────────

 
  /**
   * GET /student/attendance-history
   */
  router.get(
    "/student/attendance-history",
    simpleAuth,
    requireRole("student"),
    async (req, res) => {
      try {
        const studentUserId = Number(req.user.id);

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
    }
  );

  /**
   * GET /student/attendance/report?from=YYYY-MM-DD&to=YYYY-MM-DD&format=csv|json
   */
  router.get(
    "/student/attendance/report",
    simpleAuth,
    requireRole("student"),
    async (req, res) => {
      try {
        const studentUserId = Number(req.user.id);
        const fromStr = String(req.query.from || "");
        const toStr = String(req.query.to || "");
        const format = (req.query.format || "csv").toString().toLowerCase();

        if (!fromStr || !toStr) {
          return res.status(400).json({ error: "from_and_to_required" });
        }

        const fromDateRaw = new Date(fromStr);
        const toDateRaw = new Date(toStr);

        if (
          Number.isNaN(fromDateRaw.getTime()) ||
          Number.isNaN(toDateRaw.getTime())
        ) {
          return res.status(400).json({ error: "invalid_date_range" });
        }

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
            distanceFromCenterCheckoutMeters:
              r.distanceFromCenterCheckoutMeters,
          }));
          return res.json({ from: fromStart, to: toEnd, records: mapped });
        }

        // default CSV
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
    }
  );

  // ─────────────────────────
  // ADMIN APIs (protected)
  // ─────────────────────────

  router.get(
    "/admin/attendance-report",
    simpleAuth,
    requireRole("admin"),
    async (req, res) => {
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

        if (!fromDate && !toDate) {
          toDate = now;
          fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        } else if (fromDate && !toDate) {
          toDate = now;
        } else if (!fromDate && toDate) {
          fromDate = new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        }

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
    }
  );

  router.get(
    "/admin/students/export",
    simpleAuth,
    requireRole("admin"),
    async (req, res) => {
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
    }
  );


/**
 * POST /admin/attendance/scan
 *
 * Body: { studentId, centerId?, deviceId? }
 *
 * Logic:
 *  - If student has an open session (today, center, checkOutAt IS NULL) → CHECK-OUT
 *  - Else → CHECK-IN
 *
 * Additional constraints:
 *  - Max 2 sessions (check-in/out pairs) per student per center per day
 *  - Minimum 1-minute gap between consecutive actions
 *
 * Response:
 *  { ok: true, action: "check_in" | "check_out", record: {...} }
 */
router.post(
  "/admin/attendance/scan",
  simpleAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const { studentId: rawStudentId, centerId: rawCenterId, deviceId } =
        req.body || {};

      const studentId = Number(rawStudentId);
      const centerId = rawCenterId != null ? Number(rawCenterId) : null;

      if (!studentId || Number.isNaN(studentId)) {
        return res.status(400).json({ error: "invalid_student_id" });
      }

      // 1) Find student
      const [student] = await db
        .select()
        .from(students)
        .where(eq(students.id, studentId));

      if (!student) {
        return res.status(404).json({ error: "student_not_found" });
      }

      // Decide centerId: prefer explicit, fallback to student's center
      const effectiveCenterId = centerId || student.centerId;

      // 2) Validate center
      const [center] = await db
        .select()
        .from(centers)
        .where(eq(centers.id, effectiveCenterId));

      if (!center) {
        return res.status(400).json({ error: "center_not_found" });
      }

      // 3) Build "today" window in UTC
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

      // 4A) Look for an open session (today, center, no checkout)
      const [openRecord] = await db
        .select()
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.studentId, studentId),
            eq(attendanceRecords.centerId, effectiveCenterId),
            gte(attendanceRecords.checkInAt, todayStart),
            lt(attendanceRecords.checkInAt, tomorrowStart),
            sql`check_out_at IS NULL`
          )
        )
        .orderBy(desc(attendanceRecords.checkInAt));

      // 4B) Count how many sessions today (for max 2 sessions rule)
      const [{ totalSessionsToday }] = await db
        .select({
          totalSessionsToday: sql`COUNT(*)`.mapWith(Number),
        })
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.studentId, studentId),
            eq(attendanceRecords.centerId, effectiveCenterId),
            gte(attendanceRecords.checkInAt, todayStart),
            lt(attendanceRecords.checkInAt, tomorrowStart)
          )
        );

      // 4C) Find the last record today (for cooldown / accidental double-scan)
      const [lastTodayRecord] = await db
        .select()
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.studentId, studentId),
            eq(attendanceRecords.centerId, effectiveCenterId),
            gte(attendanceRecords.checkInAt, todayStart),
            lt(attendanceRecords.checkInAt, tomorrowStart)
          )
        )
        .orderBy(desc(attendanceRecords.checkInAt));

      // --- Anti-accidental double-scan: enforce 1-minute gap between actions ---
      const MIN_GAP_MS = 60 * 1000; // 1 minute
      let lastActionAt = null;

      if (lastTodayRecord) {
        if (openRecord && lastTodayRecord.id === openRecord.id) {
          // Last action was a CHECK-IN for the currently open session
          lastActionAt = lastTodayRecord.checkInAt;
        } else {
          // Last action was the CHECK-OUT (if present), else the CHECK-IN
          lastActionAt =
            lastTodayRecord.checkOutAt || lastTodayRecord.checkInAt;
        }
      }

      if (
        lastActionAt &&
        now.getTime() - new Date(lastActionAt).getTime() < MIN_GAP_MS
      ) {
        return res.status(402).json({
          error: "too_soon",
          message:
            "Please wait at least one minute between attendance scans to avoid accidental check-ins/check-outs.",
        });
      }

      // --- Max 2 sessions per day rule ---
      // If there is NO open session and the student already has 2 sessions today,
      // do not allow creating a new one.
      if (!openRecord && totalSessionsToday >= 2) {
        return res.status(406).json({
          error: "daily_limit_reached",
          message:
            "Maximum number of attendance sessions for today has been reached for this student.",
        });
      }

      const ipAddress =
        req.headers["x-forwarded-for"]?.toString().split(",")[0] ||
        req.ip ||
        null;
      const userAgent = req.headers["user-agent"] || null;

      // 5A) If open session exists → CHECK-OUT
      if (openRecord) {
        await db
          .update(attendanceRecords)
          .set({
            checkOutAt: now,
            // Optionally override / keep device + audit info
            deviceId: deviceId || openRecord.deviceId || null,
            ipAddress: ipAddress || openRecord.ipAddress || null,
            userAgent: userAgent || openRecord.userAgent || null,
          })
          .where(eq(attendanceRecords.id, openRecord.id));

        const [updated] = await db
          .select()
          .from(attendanceRecords)
          .where(eq(attendanceRecords.id, openRecord.id));

        return res.json({
          ok: true,
          action: "check_out",
          record: updated,
        });
      }

      // 5B) No open session → CHECK-IN
      const insertResult = await db.insert(attendanceRecords).values({
        studentId,
        centerId: effectiveCenterId,
        checkInAt: now,
        status: "present",

        checkInLat: null,
        checkInLng: null,
        checkInAccuracy: null,
        distanceFromCenterMeters: null,

        checkOutAt: null,
        checkOutLat: null,
        checkOutLng: null,
        checkOutAccuracy: null,
        distanceFromCenterCheckoutMeters: null,

        deviceId: deviceId || null,
        ipAddress,
        userAgent,
      });

      const insertedId =
        insertResult?.insertId ??
        insertResult?.[0]?.insertId ??
        null;

      const [newRecord] = await db
        .select()
        .from(attendanceRecords)
        .where(
          insertedId
            ? eq(attendanceRecords.id, insertedId)
            : and(
                eq(attendanceRecords.studentId, studentId),
                eq(attendanceRecords.centerId, effectiveCenterId),
                eq(attendanceRecords.checkInAt, now)
              )
        );

      return res.status(201).json({
        ok: true,
        action: "check_in",
        record: newRecord,
      });
    } catch (err) {
      console.error("admin_scan_attendance_failed:", err);
      return res.status(500).json({ error: "admin_scan_attendance_failed" });
    }
  }
);


  router.get(
    "/admin/stats",
    simpleAuth,
    requireRole("admin"),
    async (_req, res) => {
      try {
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
    }
  );

  router.get(
    "/admin/attendance-records",
    simpleAuth,
    requireRole("admin"),
    async (_req, res) => {
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
            checkOutAt: attendanceRecords.checkOutAt,
            checkOutLat: attendanceRecords.checkOutLat,
            checkOutLng: attendanceRecords.checkOutLng,
            checkInAccuracy: attendanceRecords.checkInAccuracy,
            checkOutAccuracy: attendanceRecords.checkOutAccuracy,
            
          })
          .from(attendanceRecords)
          .leftJoin(students, eq(attendanceRecords.studentId, students.id))
          .leftJoin(users, eq(students.userId, users.id))
          .orderBy(desc(attendanceRecords.checkInAt))
          .limit(20);

        const mapped = rows.map((r) => ({
          id: r.id,
          userId: String(r.studentId ?? ""),
          userName: r.userName || "Unknown",
          userGrade: r.studentGrade || "N/A",
          date: r.date,
          time: r.date != null ? r.date.toISOString() : null,
          status: r.status || "present",
          checkOutAt: r.checkOutAt,
          checkOutTime: r.checkOutAt != null ? r.checkOutAt.toISOString() : null,
          checkInAt: r.date,
          location:
            r.checkInLat != null && r.checkInLng != null
              ? { lat: Number(r.checkInLat), lng: Number(r.checkInLng) }
              : null,
          checkOutLocation:
            r.checkOutLat != null && r.checkOutLng != null
              ? { lat: Number(r.checkOutLat), lng: Number(r.checkOutLng) }
              : null,
          checkInAccuracy: r.checkInAccuracy != null ? Number(r.checkInAccuracy) : null,
          checkOutAccuracy: r.checkOutAccuracy != null ? Number(r.checkOutAccuracy) : null,
        }));

        res.json(mapped);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "admin_records_failed" });
      }
    }
  );

  router.post(
    "/admin/students",
    simpleAuth,
    requireRole("admin"),
    async (req, res) => {
      try {
        const { name, email, password, centerId, grade, rollNumber } =
          req.body || {};

        if (!name || !email || !password || !centerId) {
          return res.status(400).json({ error: "missing_fields" });
        }

        const [center] = await db
          .select()
          .from(centers)
          .where(eq(centers.id, Number(centerId)));

        if (!center) {
          return res.status(400).json({ error: "center_not_found" });
        }

        const normalizedEmail = String(email).toLowerCase().trim();

        const [existingUser] = await db
          .select()
          .from(users)
          .where(eq(users.email, normalizedEmail));

        if (existingUser) {
          return res.status(409).json({ error: "user_already_exists" });
        }

        console.log("Inserting new user with email:", normalizedEmail);

        // const passwordHash = await hashPassword(password);
        const userInsertResult = await db.insert(users).values({
          name,
          email: normalizedEmail,
          passwordHash: password, // TODO: replace with real hash
          role: "student",
        });

        console.log("userInsertResult:", userInsertResult);

        // ✅ Re-fetch by email instead of insertId (email is unique)
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, normalizedEmail));

        if (!user) {
          console.error("User not found after insert", {
            normalizedEmail,
            userInsertResult,
          });
          return res.status(500).json({ error: "user_creation_failed" });
        }

        const studentInsertResult = await db.insert(students).values({
          userId: user.id,
          centerId: center.id,
          grade: grade || null,
          rollNumber: rollNumber || null,
        });

        const studentId =
          studentInsertResult?.insertId ??
          studentInsertResult?.[0]?.insertId ??
          null;

        const [student] = await db
          .select()
          .from(students)
          .where(
            studentId
              ? eq(students.id, studentId)
              : eq(students.userId, user.id) // fallback
          );

        if (!student) {
          console.error("Student not found after insert", {
            userId: user.id,
            studentInsertResult,
          });
          return res
            .status(500)
            .json({ error: "student_creation_failed", userId: user.id });
        }

        return res.status(201).json({ user, student });
      } catch (err) {
        console.error("admin_add_student_failed:", err);
        return res.status(500).json({ error: "admin_add_student_failed" });
      }
    }
  );

  router.delete(
    "/admin/students/:studentId",
    simpleAuth,
    requireRole("admin"),
    async (req, res) => {
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

        await db.delete(students).where(eq(students.id, studentId));

        if (user && user.role === "student") {
          await db.delete(users).where(eq(users.id, user.id));
        }

        res.json({ ok: true });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "admin_delete_student_failed" });
      }
    }
  );

 

  router.post(
  "/admin/students/import",
  simpleAuth,
  requireRole("admin"),
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

        const rowNumber = i + 1;

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
          // 1) Check if user already exists
          const [existing] = await db
            .select()
            .from(users)
            .where(eq(users.email, email));

          if (existing) {
            skippedExisting++;
            continue;
          }

          // 2) Insert user
          // TODO: use real hash later
          const userInsertResult = await db.insert(users).values({
            name,
            email,
            passwordHash: password,
            role,
          });

          // 3) Re-fetch user by email (same pattern as /admin/students)
          const [user] = await db
            .select()
            .from(users)
            .where(eq(users.email, email));

          if (!user) {
            console.error("User not found after insert in import", {
              rowNumber,
              email,
              userInsertResult,
            });
            rowErrors.push({
              row: rowNumber,
              email,
              error: "user_creation_failed",
            });
            continue;
          }

          createdUsers++;

          // 4) Only create student row for student role
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

            // 🔴 VERY IMPORTANT: use the correct property name here
            // It must match your Drizzle schema (likely "userId")
            await db.insert(students).values({
              userId: user.id,             // <-- this must not be undefined
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

      return res.json({
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
      return res.status(500).json({ error: "admin_students_import_failed" });
    }
  }
);

  router.get(
    "/admin/attendance-report/export",
    simpleAuth,
    requireRole("admin"),
    async (req, res) => {
      try {
        const { centerId, grade, status, dateFrom, dateTo } = req.query || {};

        const whereClauses = [];

        if (dateFrom) {
          const fromDate = new Date(`${dateFrom}T00:00:00.000Z`);
          if (!Number.isNaN(fromDate.getTime())) {
            whereClauses.push(gte(attendanceRecords.checkInAt, fromDate));
          }
        }

        if (dateTo) {
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

        if (grade) {
          query = query.where(
            and(
              ...(whereClauses.length > 0 ? whereClauses : []),
              eq(students.grade, String(grade))
            )
          );
        }

        const rows = await query.orderBy(desc(attendanceRecords.checkInAt));

        const escapeCsv = (value) => {
          if (value == null) return "";
          const str = String(value);
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
          const dateStr = dt ? dt.toISOString().slice(0, 10) : "";
          const timeStr = dt ? dt.toISOString().slice(11, 19) : "";

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
    }
  );

    /**
   * GET /admin/students/qr-cards
   *
   * Generates a PDF with QR cards for all students.
   * Each card contains:
   *  - Student name
   *  - Center code
   *  - Student ID
   *  - QR code (payload = studentId)
   *
   * Auth:
   *  - x-user-id (admin)
   *  - x-user-password
   */
  router.get(
    "/admin/students/qr-cards",
    simpleAuth,
    requireRole("admin"),
    async (req, res) => {
      try {
        // 1) Fetch all students + user + center
        const rows = await db
          .select({
            studentId: students.id,
            userId: users.id,
            studentName: users.name,
            studentEmail: users.email,
            rollNumber: students.rollNumber,
            grade: students.grade,
            centerId: centers.id,
            centerName: centers.name,
            centerCode: centers.code,
          })
          .from(students)
          .leftJoin(users, eq(students.userId, users.id))
          .leftJoin(centers, eq(students.centerId, centers.id))
          .orderBy(centers.code, users.name);

        if (!rows.length) {
          return res.status(404).json({ error: "no_students_found" });
        }

        // 2) Prepare PDF response headers
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="student_qr_cards.pdf"'
        );

        const doc = new PDFDocument({
          size: "A4",
          margin: 36,
        });

        doc.pipe(res);

        // Layout config (tweak as you like)
        const cardWidth = 260;
        const cardHeight = 150;
        const cols = 2;       // 2 cards per row
        const rowsPerPage = 4; // 4 rows per page → 8 cards / page

        let colIndex = 0;
        let rowIndex = 0;

        for (const s of rows) {
          // New page if filled current one
          if (rowIndex >= rowsPerPage) {
            doc.addPage();
            rowIndex = 0;
            colIndex = 0;
          }

          const x =
            doc.page.margins.left + colIndex * cardWidth;
          const y =
            doc.page.margins.top + rowIndex * cardHeight;

          // Card border
          doc
            .roundedRect(
              x,
              y,
              cardWidth - 10,
              cardHeight - 10,
              10
            )
            .stroke();

          // Header: Center name & code
          doc.fontSize(10).text(
            s.centerName || "",
            x + 12,
            y + 10,
            { width: cardWidth - 120, ellipsis: true }
          );
          doc
            .fontSize(9)
            .fillColor("#555555")
            .text(
              `Center: ${s.centerCode || ""}`,
              x + 12,
              y + 26
            )
            .fillColor("black");

          // Student name
          doc
            .fontSize(12)
            .font("Helvetica-Bold")
            .text(
              s.studentName || "Unnamed Student",
              x + 12,
              y + 48,
              { width: cardWidth - 120, ellipsis: true }
            )
            .font("Helvetica");

          // ID & other info
          doc
            .fontSize(9)
            .text(`Student ID: ${s.studentId}`, x + 12, y + 72)
            .text(`Roll: ${s.rollNumber || "-"}`, x + 12, y + 86)
            .text(`Grade: ${s.grade || "-"}`, x + 12, y + 100);

          // 3) Generate QR for this student (payload = studentId)
          const qrPayload = String(s.studentId);
          const qrBuffer = await QRCode.toBuffer(qrPayload, {
            width: 100,
            margin: 1,
          });

          // Place QR on right side of card
          doc.image(qrBuffer, x + cardWidth - 120, y + 40, {
            width: 90,
            height: 90,
          });

          // Move layout cursor
          colIndex++;
          if (colIndex >= cols) {
            colIndex = 0;
            rowIndex++;
          }
        }

        doc.end();
      } catch (err) {
        console.error("admin_qr_cards_failed:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "admin_qr_cards_failed" });
        }
      }
    }
  );


  return router;
}


