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
  for (let attempt = 1; attempt <= 15; attempt++) {
    try {
      const conn = await amqp.connect(url);
      const channel = await conn.createChannel();
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      const q = await channel.assertQueue(QUEUE, { durable: true });
      await channel.bindQueue(q.queue, EXCHANGE, 'appointment.booked');

      channel.consume(q.queue, async (msg) => {
        if (!msg) return;
        try {
          const evt = JSON.parse(msg.content.toString());
          const message =
            `Your appointment with ${evt.doctorName} at ${evt.clinicName} ` +
            `is confirmed for ${evt.slot}. Please arrive 10 minutes early.`;

          await Notification.create({
            userId: evt.patientId,
            type: 'appointment',
            message,
            channel: 'email/sms',
          });

          // Mock delivery.
          console.log(`[notification-service] (email/sms) -> patient ${evt.patientId}: ${message}`);
          channel.ack(msg);
        } catch (err) {
          console.error('[notification-service] failed to process event:', err.message);
          channel.nack(msg, false, false);
        }
      });

      console.log(`[${name}] connected to RabbitMQ and consuming ${QUEUE}`);
      conn.on('close', () => console.warn(`[${name}] RabbitMQ connection closed`));
      return;
    } catch (err) {
      console.log(`[${name}] RabbitMQ attempt ${attempt} failed (${err.message}); retrying in 3s`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  console.warn(`[${name}] could not connect to RabbitMQ; notifications will not be created`);
}

module.exports = { connectRabbit };
