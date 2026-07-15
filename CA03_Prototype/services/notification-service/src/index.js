/**
 * MediConnect - Notification Service (bootstrap)
 * Consumes "appointment.booked" events and stores confirmation notifications.
 */
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const connectDB = require('./db');
const { connectRabbit } = require('./events');
const routes = require('./routes');

const PORT = process.env.PORT || 4004;
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/notification_db';
const RABBIT_URL = process.env.RABBIT_URL || 'amqp://localhost:5672';

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'notification-service' }));
app.use('/notifications', routes);

app.use((err, _req, res, _next) => {
  console.error('[notification-service] error:', err.message);
  res.status(500).json({ error: 'internal server error' });
});

async function start() {
  await connectDB(MONGO_URL, 'notification-service');
  await connectRabbit(RABBIT_URL, 'notification-service');
  app.listen(PORT, () => console.log(`[notification-service] listening on port ${PORT}`));
}

start();
