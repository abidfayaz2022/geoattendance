// drizzle.config.js
import "dotenv/config";

/** @type {import('drizzle-kit').Config} */
export default {
  schema: "./shared/schema.js",   // your JS schema file
  out: "./drizzle",               // migrations/output folder
  dialect: "mysql",               // 👈 important
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
};
