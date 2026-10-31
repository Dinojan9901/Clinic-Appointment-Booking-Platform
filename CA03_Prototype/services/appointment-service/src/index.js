/**
 * MediConnect - Appointment Service (bootstrap)
 * Owns clinics, doctor profiles/availability, appointments and reviews.
 * Takes part in the booking Saga with the Payment Service via RabbitMQ.
 */
const { createApp, finish, connectDB } = require('../common/service');
const { EventBus } = require('../common/messaging');
const { connectCache } = require('./cache');
const { registerEvents } = require('./events');
const { onEventsQueued } = require('./appointments');
const seedDoctors = require('./seed');
const { clinicRoutes, doctorRoutes, appointmentRoutes } = require('./routes');

const NAME = 'appointment-service';
const PORT = process.env.PORT || 4002;
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/appointment_db';
const RABBIT_URL = process.env.RABBIT_URL || 'amqp://localhost:5672';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const app = createApp(NAME);
app.use('/clinics', clinicRoutes);
app.use('/doctors', doctorRoutes);
app.use('/appointments', appointmentRoutes);
finish(app, NAME);

async function start() {
  await connectDB(MONGO_URL, NAME);
  connectCache(REDIS_URL);
  await seedDoctors();
  app.listen(PORT, () => console.log(`[${NAME}] listening on port ${PORT}`));
  const bus = new EventBus(RABBIT_URL, NAME);
  registerEvents(bus);
  onEventsQueued(() => bus.flush());
  bus.start();
}

start();
