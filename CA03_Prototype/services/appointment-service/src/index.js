/**
 * MediConnect - Appointment Service (bootstrap)
 * Owns doctor/clinic data and appointments; publishes "appointment.booked".
 */
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const connectDB = require('./db');
const { connectRabbit } = require('./events');
const seedDoctors = require('./seed');
const { doctors, appointments } = require('./routes');

const PORT = process.env.PORT || 4002;
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/appointment_db';
const RABBIT_URL = process.env.RABBIT_URL || 'amqp://localhost:5672';

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'appointment-service' }));
app.use('/doctors', doctors);
app.use('/appointments', appointments);

app.use((err, _req, res, _next) => {
  console.error('[appointment-service] error:', err.message);
  res.status(500).json({ error: 'internal server error' });
});

async function start() {
  await connectDB(MONGO_URL, 'appointment-service');
  await seedDoctors();
  connectRabbit(RABBIT_URL, 'appointment-service');
  app.listen(PORT, () => console.log(`[appointment-service] listening on port ${PORT}`));
}

start();
