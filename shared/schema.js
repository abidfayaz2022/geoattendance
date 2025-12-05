// shared/schema.js
import {
  mysqlTable,
  int,
  varchar,
  datetime,
  timestamp,
  double,
  text,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

//
// 1) CENTERS  (only 2 rows in your case)
//    e.g. "Main Campus", "Branch Campus"
//

export const centers = mysqlTable("centers", {
  id: int("id").primaryKey().autoincrement(),
  name: varchar("name", { length: 255 }).notNull(),          // e.g. "Srinagar Center"
  code: varchar("code", { length: 64 }).notNull().unique(),  // e.g. "SRINAGAR"
  lat: double("lat").notNull(),                              // center latitude
  lng: double("lng").notNull(),                              // center longitude
  radiusMeters: double("radius_meters").notNull(),           // allowed radius for check-in
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

//
// 2) USERS  (only 'admin' and 'student')
//    Every student is a user; admins are users too
//

export const users = mysqlTable("users", {
  id: int("id").primaryKey().autoincrement(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  role: varchar("role", { length: 16 }).notNull(), // 'admin' | 'student'
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

//
// 3) STUDENT PROFILE
//    Extra fields + which centre they belong to
//

export const students = mysqlTable("students", {
  id: int("id").primaryKey().autoincrement(),
  userId: int("user_id")
    .notNull()
    .references(() => users.id),
  centerId: int("center_id")
    .notNull()
    .references(() => centers.id),
  grade: varchar("grade", { length: 64 }),          // optional
  rollNumber: varchar("roll_number", { length: 64 })// optional
});

//
// 4) ATTENDANCE RECORDS
//    Each check-in at a centre by a student
//

// shared/schema.js
export const attendanceRecords = mysqlTable("attendance_records", {
  id: int("id").primaryKey().autoincrement(),

  // who + where
  studentId: int("student_id")
    .notNull()
    .references(() => students.id),
  centerId: int("center_id")
    .notNull()
    .references(() => centers.id),

  // when + status
  checkInAt: datetime("check_in_at").notNull(),
  status: varchar("status", { length: 32 })
    .notNull()
    .default("present"), // can later be 'late', 'absent', etc.

  // geo telemetry (check-in)
  checkInLat: double("check_in_lat"),
  checkInLng: double("check_in_lng"),
  checkInAccuracy: double("check_in_accuracy"),
  distanceFromCenterMeters: double("distance_from_center_meters"),

  // CHECK-OUT FIELDS (new)
  checkOutAt: datetime("check_out_at"),              // nullable if never checked out
  checkOutLat: double("check_out_lat"),
  checkOutLng: double("check_out_lng"),
  checkOutAccuracy: double("check_out_accuracy"),
  distanceFromCenterCheckoutMeters: double(
    "distance_from_center_checkout_meters"
  ),

  // device / audit
  deviceId: varchar("device_id", { length: 255 }),
  ipAddress: varchar("ip_address", { length: 255 }),
  userAgent: text("user_agent"),
});

