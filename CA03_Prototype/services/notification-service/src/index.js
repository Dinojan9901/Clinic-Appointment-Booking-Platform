/**
 * MediConnect - Notification Service (bootstrap)
 * Consumes appointment, payment, record and doctor events; stores in-app
 * notifications, sends emails (SMTP/Mailpit) and schedules reminders.
 */
const { createApp, finish, connectDB } = require('../common/service');
const { EventBus } = require('../common/messaging');
const { registerEvents } = require('./events');
const routes = require('./routes');

const NAME = 'notification-service';
const PORT = process.env.PORT || 4004;
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/notification_db';
const RABBIT_URL = process.env.RABBIT_URL || 'amqp://localhost:5672';

const app = createApp(NAME);
app.use('/notifications', routes);
finish(app, NAME);

async function start() {
  await connectDB(MONGO_URL, NAME);
  app.listen(PORT, () => console.log(`[${NAME}] listening on port ${PORT}`));
  const bus = new EventBus(RABBIT_URL, NAME);
  registerEvents(bus);
  bus.start();
}

start();
