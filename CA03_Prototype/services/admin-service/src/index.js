/**
 * MediConnect - Admin Service (bootstrap)
 * Platform monitoring for administrators: subscribes to every domain event
 * ("#") to build an audit/activity log, derives statistics from it, and
 * reports the live health of every service.
 */
const express = require('express');
const { createApp, finish, connectDB, requireRole } = require('../common/service');
const { EventBus } = require('../common/messaging');
const Activity = require('./model');
const { record, stats } = require('./activity');

const NAME = 'admin-service';
const PORT = process.env.PORT || 4006;
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/admin_db';
const RABBIT_URL = process.env.RABBIT_URL || 'amqp://localhost:5672';
const SERVICES = {
  'auth-service': process.env.AUTH_URL || 'http://localhost:4001',
  'appointment-service': process.env.APPOINTMENT_URL || 'http://localhost:4002',
  'records-service': process.env.RECORDS_URL || 'http://localhost:4003',
  'notification-service': process.env.NOTIFICATION_URL || 'http://localhost:4004',
  'payment-service': process.env.PAYMENT_URL || 'http://localhost:4005',
};

const bus = new EventBus(RABBIT_URL, NAME);
const app = createApp(NAME);
const router = express.Router();

router.get('/activity', async (req, res, next) => {
  try {
    requireRole(req, 'admin');
    const filter = {};
    if (typeof req.query.type === 'string' && req.query.type) filter.type = new RegExp(`^${req.query.type.replace(/[^a-z._]/gi, '')}`);
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    res.json(await Activity.find(filter).sort({ occurredAt: -1 }).limit(limit));
  } catch (err) {
    next(err);
  }
});

router.get('/stats', async (req, res, next) => {
  try {
    requireRole(req, 'admin');
    res.json(await stats());
  } catch (err) {
    next(err);
  }
});

router.get('/health', async (req, res, next) => {
  try {
    requireRole(req, 'admin');
    const checks = await Promise.all(
      Object.entries(SERVICES).map(async ([service, url]) => {
        const started = Date.now();
        try {
          const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
          const body = await r.json();
          return { service, status: r.ok ? 'up' : 'down', instance: body.instance, db: body.db, latencyMs: Date.now() - started };
        } catch {
          return { service, status: 'down', latencyMs: Date.now() - started };
        }
      })
    );
    checks.push({ service: 'rabbitmq', status: bus.channel ? 'up' : 'down' });
    res.json(checks);
  } catch (err) {
    next(err);
  }
});

app.use('/admin', router);
finish(app, NAME);

async function start() {
  await connectDB(MONGO_URL, NAME);
  app.listen(PORT, () => console.log(`[${NAME}] listening on port ${PORT}`));
  bus.subscribe('admin.activity', ['#'], record);
  bus.start();
}

start();
