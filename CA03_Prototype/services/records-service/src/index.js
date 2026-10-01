/**
 * MediConnect - Records Service (bootstrap)
 * Consumes "appointment.booked" (async) and calls the Appointment Service
 * (sync) when a doctor completes a consultation record.
 */
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const connectDB = require('./db');
const { connectRabbit } = require('./events');
const routes = require('./routes');

const PORT = process.env.PORT || 4003;
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/records_db';
const RABBIT_URL = process.env.RABBIT_URL || 'amqp://localhost:5672';

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'records-service' }));
app.use('/records', routes);

app.use((err, _req, res, _next) => {
  console.error('[records-service] error:', err.message);
  res.status(500).json({ error: 'internal server error' });
});

async function start() {
  await connectDB(MONGO_URL, 'records-service');
  // Serve HTTP immediately; connect + consume from RabbitMQ in the background
  // (retries until available).
  app.listen(PORT, () => console.log(`[records-service] listening on port ${PORT}`));
  connectRabbit(RABBIT_URL, 'records-service');
}

start();
