/**
 * Messaging layer (consumer): subscribes to "appointment.booked" and
 * creates a confirmation notification (mock email/SMS). Runs independently
 * of the Records Service consumer on the same event - classic fan-out.
 */
const amqp = require('amqplib');
const Notification = require('./model');

const EXCHANGE = 'mediconnect.events';
const QUEUE = 'notifications.appointment-booked';

async function connectRabbit(url, name = 'notification-service') {
  while (true) {
    let conn;
    try {
      conn = await amqp.connect(url);
      const channel = await conn.createChannel();
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      const q = await channel.assertQueue(QUEUE, { durable: true });
      await channel.bindQueue(q.queue, EXCHANGE, 'appointment.booked');
      await channel.bindQueue(q.queue, EXCHANGE, 'appointment.cancelled');
      await channel.prefetch(1);

      channel.consume(q.queue, async (msg) => {
        if (!msg) return;
        try {
          const evt = JSON.parse(msg.content.toString());
          const cancelled = msg.fields.routingKey === 'appointment.cancelled';
          const message = cancelled
            ? `Your appointment with ${evt.doctorName} at ${evt.clinicName} on ${evt.slot} has been cancelled.`
            : `Your appointment with ${evt.doctorName} at ${evt.clinicName} is confirmed for ${evt.slot}. Please arrive 10 minutes early.`;

          await Notification.updateOne(
            { eventId: evt.eventId },
            { $setOnInsert: { eventId: evt.eventId, userId: evt.patientId, type: cancelled ? 'appointment-cancelled' : 'appointment', message, channel: 'email/sms' } },
            { upsert: true }
          );

          // Mock delivery.
          console.log(`[notification-service] (email/sms) -> patient ${evt.patientId}: ${message}`);
          channel.ack(msg);
        } catch (err) {
          console.error('[notification-service] failed to process event:', err.message);
          channel.nack(msg, false, false);
        }
      });

      console.log(`[${name}] connected to RabbitMQ and consuming ${QUEUE}`);
      await new Promise((resolve) => {
        conn.once('close', resolve);
        conn.once('error', resolve);
      });
      console.warn(`[${name}] RabbitMQ connection closed; reconnecting`);
    } catch (err) {
      console.log(`[${name}] RabbitMQ unavailable (${err.message}); retrying in 3s`);
    }
    try { await conn?.close(); } catch (_) { /* already closed */ }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

module.exports = { connectRabbit };
