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

// Identity headers are trusted by the services, so only the gateway may set
// them. Strip any client-supplied copies from EVERY request (including the
// public /api/auth routes) before routing, so they cannot be spoofed.
const IDENTITY_HEADERS = ["x-user-id", "x-user-role", "x-user-name", "x-user-email"];
app.use((req, _res, next) => {
  for (const h of IDENTITY_HEADERS) delete req.headers[h];
  next();
});

/**
 * Authentication middleware.
 * Verifies the Bearer token and attaches the identity to the request headers
 * (x-user-id / x-user-role / x-user-name / x-user-email) so downstream
 * services can trust it.
 * Setting the headers on req.headers here (rather than in the proxy's
 * `on.proxyReq` hook) makes them forward reliably for POST/PUT requests that
 * carry a body.
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
    req.headers["x-user-id"] = String(payload.sub);
    req.headers["x-user-role"] = payload.role || "";
    req.headers["x-user-name"] = encodeURIComponent(payload.name || "");
    req.headers["x-user-email"] = payload.email || "";
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Proxy factory with a graceful "upstream unavailable" handler.
function proxyTo(proxyOptions) {
  return createProxyMiddleware({
    changeOrigin: true,
    ...proxyOptions,
    on: {
      error: (err, _req, res) => {
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
  return (path) => (!path || path === "/" ? prefix : `${prefix}${path}`);
}

// -------- Auth Service: register/login are public, /me needs a JWT --------
app.use("/api/auth/me", authenticate);
app.use(
  "/api/auth",
  proxyTo({
    target: TARGETS.auth,
    pathRewrite: { "^/api/auth": "" },
  }),
);

// -------- Everything below requires a valid JWT --------
app.use(authenticate);

app.use(
  "/api/doctors",
  proxyTo({
    target: TARGETS.appointment,
    pathRewrite: prefixPathRewrite("/doctors"),
  }),
);

app.use(
  "/api/appointments",
  proxyTo({
    target: TARGETS.appointment,
    pathRewrite: prefixPathRewrite("/appointments"),
  }),
);

app.use(
  "/api/records",
  proxyTo({
    target: TARGETS.records,
    pathRewrite: prefixPathRewrite("/records"),
  }),
);

app.use(
  "/api/notifications",
  proxyTo({
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
