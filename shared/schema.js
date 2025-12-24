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

export const centers = mysqlTable("centers", {
  id: int("id").primaryKey().autoincrement(),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  lat: double("lat").notNull(),
  lng: double("lng").notNull(),
  radiusMeters: double("radius_meters").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const users = mysqlTable("users", {
  id: int("id").primaryKey().autoincrement(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  role: varchar("role", { length: 16 }).notNull(), // 'admin' | 'student'
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const students = mysqlTable("students", {
  id: int("id").primaryKey().autoincrement(),

  userId: int("user_id")
    .notNull()
    .references(() => users.id),

  // ✅ default centerId = 1
  centerId: int("center_id")
    .notNull()
    .default(1)
    .references(() => centers.id),

  grade: varchar("grade", { length: 64 }),
  rollNumber: varchar("roll_number", { length: 64 }),

  // ✅ NEW: phone fields
  phoneNumber: varchar("phone_number", { length: 32 }),          // student phone
  parentPhoneNumber: varchar("parent_phone_number", { length: 32 }), // parent phone
});

export const attendanceRecords = mysqlTable("attendance_records", {
  id: int("id").primaryKey().autoincrement(),

  studentId: int("student_id")
    .notNull()
    .references(() => students.id),

  centerId: int("center_id")
    .notNull()
    .references(() => centers.id),

  checkInAt: datetime("check_in_at").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("present"),

  checkInLat: double("check_in_lat"),
  checkInLng: double("check_in_lng"),
  checkInAccuracy: double("check_in_accuracy"),
  distanceFromCenterMeters: double("distance_from_center_meters"),

  checkOutAt: datetime("check_out_at"),
  checkOutLat: double("check_out_lat"),
  checkOutLng: double("check_out_lng"),
  checkOutAccuracy: double("check_out_accuracy"),
  distanceFromCenterCheckoutMeters: double("distance_from_center_checkout_meters"),

  deviceId: varchar("device_id", { length: 255 }),
  ipAddress: varchar("ip_address", { length: 255 }),
  userAgent: text("user_agent"),
});
