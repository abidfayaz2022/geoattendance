// server/storage.js
import "dotenv/config";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import fs from "fs";
import * as schema from "../shared/schema.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is not set in .env");
}

// Parse the connection string
const url = new URL(DATABASE_URL);

const pool = mysql.createPool({
  host: url.hostname,
  port: url.port ? Number(url.port) : 3306,
  user: url.username,
  password: url.password,
  database: url.pathname.replace(/^\//, ""),
  ssl: {
    // Aiven requires SSL; use their CA cert
    ca: fs.readFileSync("certs/aiven-ca.pem", "utf8"),
  },
  connectionLimit: 10,
});

// Drizzle DB instance
export const db = drizzle(pool, {
  schema,
  mode: "default",
});
