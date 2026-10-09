/**
 * MediConnect - API Gateway
 * -------------------------------------------------------------
 * The single public entry point for the whole system (CA01 architecture).
 * Responsibilities:
 *   - Route client requests to the correct microservice (reverse proxy).
 *   - Enforce authentication (verify JWT) for protected routes.
 *   - Pass the authenticated identity to services via trusted headers.
 *   - Apply cross-cutting concerns: CORS, rate limiting, request logging.
 *
 * The individual services are NOT exposed to the host; every request
 * reaches them only through this gateway.
 */
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const { createProxyMiddleware } = require("http-proxy-middleware");

const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || "mediconnect_dev_secret";

const TARGETS = {
  auth: process.env.AUTH_URL || "http://localhost:4001",
  appointment: process.env.APPOINTMENT_URL || "http://localhost:4002",
  records: process.env.RECORDS_URL || "http://localhost:4003",
  notification: process.env.NOTIFICATION_URL || "http://localhost:4004",
};

const app = express();
app.use(cors());
app.use(morgan("dev"));
app.use((req, _res, next) => {
  // Strip identity claims supplied by clients before any proxy middleware sees them.
  delete req.headers["x-user-id"];
  delete req.headers["x-user-role"];
  delete req.headers["x-user-name"];
  next();
});

// Basic rate limiting (cross-cutting security concern).
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." },
  }),
);

app.get("/health", (_req, res) =>
  res.json({ status: "ok", service: "api-gateway" }),
);

/**
 * Authentication middleware.
 * Verifies the Bearer token and forwards the identity to downstream
 * services as trusted headers (x-user-id / x-user-role / x-user-name).
 */
function authenticate(req, res, next) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res
      .status(401)
      .json({ error: "Missing or invalid Authorization header" });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.auth = payload; // { sub, role, name }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Inject the authenticated identity into the proxied request.
function withIdentity(proxyOptions) {
  return createProxyMiddleware({
    changeOrigin: true,
    ...proxyOptions,
    on: {
      proxyReq: (proxyReq, req) => {
        if (req.auth) {
          proxyReq.setHeader("x-user-id", String(req.auth.sub));
          proxyReq.setHeader("x-user-role", req.auth.role || "");
          proxyReq.setHeader(
            "x-user-name",
            encodeURIComponent(req.auth.name || ""),
          );
        }
      },
      error: (err, _req, res) => {
        // Handle a service being unreachable gracefully.
        if (res && !res.headersSent) {
          res.writeHead(502, { "Content-Type": "application/json" });
        }
        res &&
          res.end(JSON.stringify({ error: "Upstream service unavailable" }));
      },
    },
  });
}

function prefixPathRewrite(prefix) {
  return (path) => {
    if (!path || path === "/") {
      return prefix;
    }
    return `${prefix}${path}`;
  };
}

// -------- Public routes (no auth): Auth Service --------
app.use(
  "/api/auth",
  withIdentity({
    target: TARGETS.auth,
    pathRewrite: { "^/api/auth": "" },
  }),
);

// -------- Everything below requires a valid JWT --------
app.use(authenticate);
app.use((req, _res, next) => {
  // The gateway is the only source of downstream identity headers. Populate
  // the incoming request after JWT verification so every proxy method gets them.
  req.headers["x-user-id"] = String(req.auth.sub);
  req.headers["x-user-role"] = req.auth.role || "";
  req.headers["x-user-name"] = encodeURIComponent(req.auth.name || "");
  next();
});

app.use(
  "/api/doctors",
  withIdentity({
    target: TARGETS.appointment,
    pathRewrite: prefixPathRewrite("/doctors"),
  }),
);

app.use(
  "/api/appointments",
  withIdentity({
    target: TARGETS.appointment,
    pathRewrite: prefixPathRewrite("/appointments"),
  }),
);

app.use(
  "/api/records",
  withIdentity({
    target: TARGETS.records,
    pathRewrite: prefixPathRewrite("/records"),
  }),
);

app.use(
  "/api/notifications",
  withIdentity({
    target: TARGETS.notification,
    pathRewrite: prefixPathRewrite("/notifications"),
  }),
);

// Fallback 404 + central error handler.
app.use((_req, res) => res.status(404).json({ error: "Route not found" }));
app.use((err, _req, res, _next) => {
  console.error("[gateway] error:", err.message);
  res.status(500).json({ error: "Internal gateway error" });
});

app.listen(PORT, () => {
  console.log(`[api-gateway] listening on port ${PORT}`);
  console.log("[api-gateway] routing table:", TARGETS);
});
