/**
 * MediConnect - Payment Service (bootstrap)
 * Owns payment_db. Charges the simulated provider, publishes payment.* events
 * and refunds when an appointment is cancelled or its hold had already ended
 * (Saga compensation).
 */
const { createApp, finish, connectDB } = require('../common/service');
const { EventBus } = require('../common/messaging');
const Payment = require('./model');
const routes = require('./routes');
const { onEventsQueued, refund, failStuckPayments } = require('./controller');

const NAME = 'payment-service';
const PORT = process.env.PORT || 4005;
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/payment_db';
const RABBIT_URL = process.env.RABBIT_URL || 'amqp://localhost:5672';

const app = createApp(NAME);
app.use('/payments', routes);
finish(app, NAME);

const handlers = {
  'appointment.cancelled': (evt) => (evt.wasPaid ? refund({ appointmentId: evt.appointmentId }, 'appointment cancelled by patient') : null),
  'appointment.payment_rejected': (evt) => refund({ _id: evt.paymentId }, `payment arrived after hold ended (${evt.reason})`),
};

async function start() {
  await connectDB(MONGO_URL, NAME);
  await Payment.init();
  app.listen(PORT, () => console.log(`[${NAME}] listening on port ${PORT}`));
  const bus = new EventBus(RABBIT_URL, NAME);
  bus.useOutbox(Payment);
  bus.subscribe('payments.events', Object.keys(handlers), async (evt, key) => {
    if (handlers[key] && (await handlers[key](evt))) bus.flush();
  });
  onEventsQueued(() => bus.flush());
  bus.start();
  setInterval(() => failStuckPayments().catch(() => {}), 60000);
}

start();
