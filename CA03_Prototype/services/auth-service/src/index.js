/**
 * MediConnect - Auth Service (bootstrap)
 * Layered structure: routes (controller) -> controller (business logic) -> model (data).
 * Publishes user/doctor lifecycle events through its outbox.
 */
const { createApp, finish, connectDB } = require('../common/service');
const { EventBus } = require('../common/messaging');
const User = require('./model');
const routes = require('./routes');
const seedAccounts = require('./seed');

const NAME = 'auth-service';
const PORT = process.env.PORT || 4001;
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/auth_db';
const RABBIT_URL = process.env.RABBIT_URL || 'amqp://localhost:5672';

const app = createApp(NAME);
app.use('/', routes);
finish(app, NAME);

async function start() {
  await connectDB(MONGO_URL, NAME);
  await seedAccounts();
  app.listen(PORT, () => console.log(`[${NAME}] listening on port ${PORT}`));
  const bus = new EventBus(RABBIT_URL, NAME);
  bus.useOutbox(User);
  bus.start();
}

start();
