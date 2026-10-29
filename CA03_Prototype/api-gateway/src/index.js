/**
 * MediConnect - API Gateway
 * -------------------------------------------------------------
 * The single public entry point for the whole system (CA01 architecture).
 *   - Routes client requests to the correct microservice (reverse proxy).
 *   - Verifies the JWT for every non-public route and forwards the identity
 *     to services as trusted x-user-* headers (client copies are stripped).
 *   - Cross-cutting concerns: CORS, logging, rate limiting (shared in Redis so
 *     limits hold across replicas), admin-only guard for /api/admin.
 */
const http = require("http");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");
const { createClient } = require("redis");
const jwt = require("jsonwebtoken");
const { createProxyMiddleware } = require("http-proxy-middleware");

const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || "mediconnect_dev_secret";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const TARGETS = {
  auth: process.env.AUTH_URL || "http://localhost:4001",
  appointment: process.env.APPOINTMENT_URL || "http://localhost:4002",
  records: process.env.RECORDS_URL || "http://localhost:4003",
  notification: process.env.NOTIFICATION_URL || "http://localhost:4004",
  payment: process.env.PAYMENT_URL || "http://localhost:4005",
  admin: process.env.ADMIN_URL || "http://localhost:4006",
};

const PUBLIC_ROUTES = [
  ["POST", /^\/api\/auth\/(register|register-doctor|login)$/],
  ["GET", /^\/api\/clinics(\/[^/]+)?$/],
  ["GET", /^\/api\/prescriptions\/(verify\/[^/]+|public-key)$/],
];
const IDENTITY_HEADERS = ["x-user-id", "x-user-role", "x-user-name", "x-user-email"];
const noKeepAlive = new http.Agent({ keepAlive: false });

async function rateLimitStore() {
  const client = createClient({ url: REDIS_URL, socket: { connectTimeout: 3000, reconnectStrategy: (n) => Math.min(n * 500, 5000) } });
  client.on("error", () => {});
  try {
    await Promise.race([client.connect(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 10000))]);
    console.log("[api-gateway] rate limiting backed by Redis");
    return new RedisStore({ sendCommand: (...args) => client.sendCommand(args) });
  } catch (err) {
    console.warn(`[api-gateway] Redis unavailable (${err.message}); using in-memory rate limiting`);
    client.disconnect().catch(() => {});
    return undefined;
  }
}

function authenticate(req, res, next) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing or invalid Authorization header" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.headers["x-user-id"] = String(payload.sub);
    req.headers["x-user-role"] = payload.role || "";
    req.headers["x-user-name"] = encodeURIComponent(payload.name || "");
    req.headers["x-user-email"] = payload.email || "";
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function proxyTo(target, prefix) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    agent: noKeepAlive,
    pathRewrite: (path) => (!path || path === "/" ? prefix : `${prefix}${path}`),
    on: {
      error: (err, _req, res) => {
        if (res && !res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
        res && res.end(JSON.stringify({ error: "Upstream service unavailable" }));
      },
    },
  });
}

async function start() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(cors());
  app.use(morgan("dev"));
  app.use((req, _res, next) => {
    for (const h of IDENTITY_HEADERS) delete req.headers[h];
    next();
  });
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
      passOnStoreError: true,
      store: await rateLimitStore(),
      message: { error: "Too many requests, please try again later." },
    })
  );

  app.get("/health", (_req, res) => res.json({ status: "ok", service: "api-gateway" }));

  app.use("/api", (req, res, next) => {
    const path = req.originalUrl.split("?")[0];
    const isPublic = PUBLIC_ROUTES.some(([method, re]) => req.method === method && re.test(path));
    return isPublic ? next() : authenticate(req, res, next);
  });
  app.use("/api/admin", (req, res, next) =>
    req.headers["x-user-role"] === "admin" ? next() : res.status(403).json({ error: "admin role required" })
  );

  app.use("/api/auth", proxyTo(TARGETS.auth, ""));
  app.use("/api/clinics", proxyTo(TARGETS.appointment, "/clinics"));
  app.use("/api/doctors", proxyTo(TARGETS.appointment, "/doctors"));
  app.use("/api/appointments", proxyTo(TARGETS.appointment, "/appointments"));
  app.use("/api/records", proxyTo(TARGETS.records, "/records"));
  app.use("/api/prescriptions", proxyTo(TARGETS.records, "/prescriptions"));
  app.use("/api/notifications", proxyTo(TARGETS.notification, "/notifications"));
  app.use("/api/payments", proxyTo(TARGETS.payment, "/payments"));
  app.use("/api/admin", proxyTo(TARGETS.admin, "/admin"));

  app.use((_req, res) => res.status(404).json({ error: "Route not found" }));
  app.use((err, _req, res, _next) => {
    console.error("[gateway] error:", err.message);
    res.status(500).json({ error: "Internal gateway error" });
  });

  app.listen(PORT, () => {
    console.log(`[api-gateway] listening on port ${PORT}`);
    console.log("[api-gateway] routing table:", TARGETS);
  });
}

start();
