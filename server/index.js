// server/index.js
import express from "express";
import cors from "cors";
import morgan from "morgan";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRouter } from "./routes.js";
import { serveStaticAssets } from "./static.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;

// CORS – allow your Vite origin with credentials
app.use(
  cors({
    origin: ["http://localhost:5000", "http://127.0.0.1:5000", 'https://wcrv93pn-5000.inc1.devtunnels.ms','https://geoattendance-delta.vercel.app',"http://localhost:33671"],
    credentials: true,
  })
);

// Middlewares
app.use(express.json());
app.use(morgan("dev"));

// API routes
app.use("/api", createRouter());

// Static client (for production build)
serveStaticAssets(app, {
  distDir: path.join(__dirname, "..", "dist"),
  indexFile: "index.html",
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
