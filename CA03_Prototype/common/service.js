const os = require('os');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const mongoose = require('mongoose');

const INSTANCE = os.hostname();

function createApp(name) {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(morgan('dev'));
  app.use((_req, res, next) => {
    res.set('X-Served-By', `${name}@${INSTANCE}`);
    next();
  });
  app.get('/health', (_req, res) =>
    res.json({ status: 'ok', service: name, instance: INSTANCE, db: mongoose.connection.readyState === 1 ? 'up' : 'down' })
  );
  return app;
}

function finish(app, name) {
  app.use((_req, res) => res.status(404).json({ error: 'route not found' }));
  app.use((err, _req, res, _next) => {
    if (err.name === 'CastError') return res.status(400).json({ error: 'invalid id' });
    if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(`[${name}] error:`, err.message);
    res.status(500).json({ error: 'internal server error' });
  });
}

async function connectDB(uri, name) {
  for (let attempt = 1; ; attempt++) {
    try {
      await mongoose.connect(uri);
      console.log(`[${name}] connected to MongoDB`);
      return;
    } catch (err) {
      console.log(`[${name}] MongoDB attempt ${attempt} failed (${err.message}); retrying in 3s`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

function identity(req) {
  return {
    userId: req.headers['x-user-id'] || '',
    role: req.headers['x-user-role'] || '',
    name: decodeURIComponent(req.headers['x-user-name'] || ''),
    email: req.headers['x-user-email'] || '',
  };
}

function identityHeaders(req) {
  const h = {};
  for (const k of ['x-user-id', 'x-user-role', 'x-user-name', 'x-user-email']) h[k] = req.headers[k] || '';
  return h;
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function requireRole(req, ...roles) {
  const who = identity(req);
  if (!who.userId) throw httpError(401, 'not authenticated');
  if (roles.length && !roles.includes(who.role)) throw httpError(403, `${roles.join(' or ')} role required`);
  return who;
}

const SLOT_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

// Slots are clinic-local times in Sri Lanka (UTC+05:30).
function slotToDate(slot) {
  if (typeof slot !== 'string' || !SLOT_RE.test(slot)) return null;
  const d = new Date(`${slot.replace(' ', 'T')}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateToSlot(date) {
  const local = new Date(date.getTime() + 330 * 60000);
  return local.toISOString().slice(0, 16).replace('T', ' ');
}

module.exports = {
  INSTANCE,
  createApp,
  finish,
  connectDB,
  identity,
  identityHeaders,
  httpError,
  requireRole,
  slotToDate,
  dateToSlot,
};
