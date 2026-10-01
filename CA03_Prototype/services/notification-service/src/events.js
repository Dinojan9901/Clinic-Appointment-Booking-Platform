/**
 * Messaging layer (consumer): subscribes to appointment lifecycle events and
 * creates the matching patient notification (mock email/SMS):
 *  - appointment.booked    -> booking confirmation
 *  - appointment.cancelled -> cancellation notice
 * Runs independently of the Records Service consumer on the same events -
 * classic fan-out.
 *
 * Delivery is at-least-once (the publisher uses a transactional outbox), so
 * each notification stores the source eventId under a unique index; a
 * redelivered event is detected and acknowledged without notifying twice.
 *
 * Connection is retried indefinitely and re-established automatically if it
 * drops, so the consumer is resilient to RabbitMQ starting slowly or
 * restarting.
 */
const amqp = require('amqplib');
const Notification = require('./model');

const EXCHANGE = 'mediconnect.events';
const QUEUE = 'notifications.appointment-events';

const MESSAGES = {
  'appointment.booked': (evt) =>
    `Your appointment with ${evt.doctorName} at ${evt.clinicName} ` +
    `is confirmed for ${evt.slot}. Please arrive 10 minutes early.`,
  'appointment.cancelled': (evt) =>
    `Your appointment with ${evt.doctorName} at ${evt.clinicName} ` +
    `on ${evt.slot} has been cancelled.`,
};

async function connectRabbit(url, name = 'notification-service') {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      const conn = await amqp.connect(url);
      const channel = await conn.createChannel();
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      const q = await channel.assertQueue(QUEUE, { durable: true });
      for (const key of Object.keys(MESSAGES)) {
        await channel.bindQueue(q.queue, EXCHANGE, key);
      }

      channel.consume(q.queue, async (msg) => {
        if (!msg) return;
        const key = msg.fields.routingKey;
        try {
          const evt = JSON.parse(msg.content.toString());
          const message = MESSAGES[key](evt);

          await Notification.create({
            userId: evt.patientId,
            eventId: evt.eventId,
            type: 'appointment',
            message,
            channel: 'email/sms',
          });

          // Mock delivery.
          console.log(`[notification-service] (email/sms) -> patient ${evt.patientId}: ${message}`);
          channel.ack(msg);
        } catch (err) {
          if (err.code === 11000) {
            // Duplicate eventId: already notified for this event.
            console.log(`[notification-service] duplicate ${key} ignored`);
            return channel.ack(msg);
          }
          console.error(`[notification-service] failed to process ${key}:`, err.message);
          // Retry once (e.g. a transient DB error); drop it if it fails again.
          channel.nack(msg, false, !msg.fields.redelivered);
        }
      });

      console.log(`[${name}] connected to RabbitMQ and consuming ${QUEUE}`);
      conn.on('close', () => {
        console.warn(`[${name}] RabbitMQ connection closed; reconnecting...`);
        setTimeout(() => connectRabbit(url, name), 3000);
      });
      conn.on('error', () => {}); // handled by close
      return;
    } catch (err) {
      console.log(`[${name}] RabbitMQ attempt ${attempt} failed (${err.message}); retrying in 3s`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

module.exports = { connectRabbit };
