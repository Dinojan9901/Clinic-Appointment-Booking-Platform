/**
 * MediConnect - Records Service (bootstrap)
 * Consultation records, signed e-prescriptions and patient history (EHR).
 * Consumes appointment events (async) and calls the Appointment Service (sync)
 * when a doctor completes a consultation record.
 */
const { createApp, finish, connectDB } = require('../common/service');
const { EventBus } = require('../common/messaging');
const { loadKeys } = require('./signing');
const { registerEvents } = require('./events');
const { onEventsQueued } = require('./controller');
const { records, prescriptions } = require('./routes');

const NAME = 'records-service';
const PORT = process.env.PORT || 4003;
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/records_db';
const RABBIT_URL = process.env.RABBIT_URL || 'amqp://localhost:5672';

const app = createApp(NAME);
app.use('/records', records);
app.use('/prescriptions', prescriptions);
finish(app, NAME);

async function start() {
  await connectDB(MONGO_URL, NAME);
  await loadKeys();
  app.listen(PORT, () => console.log(`[${NAME}] listening on port ${PORT}`));
  const bus = new EventBus(RABBIT_URL, NAME);
  registerEvents(bus);
  onEventsQueued(() => bus.flush());
  bus.start();
}

start();
