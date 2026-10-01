/**
 * Messaging layer (consumer): subscribes to appointment lifecycle events.
 *  - appointment.booked    -> create a pending consultation record for the
 *                             doctor to complete after the visit.
 *  - appointment.cancelled -> mark that pending record as cancelled.
 * This demonstrates asynchronous, decoupled inter-service communication.
 *
 * Delivery is at-least-once (the publisher uses a transactional outbox), so
 * both handlers are idempotent: processing the same event twice is harmless.
 *
 * Connection is retried indefinitely and re-established automatically if it
 * drops, so the consumer is resilient to RabbitMQ starting slowly or
 * restarting.
 */
const amqp = require('amqplib');
const Record = require('./model');

const EXCHANGE = 'mediconnect.events';
const QUEUE = 'records.appointment-events';

const handlers = {
  // Upsert keyed on the unique appointmentId -> duplicates are no-ops.
  'appointment.booked': (evt) =>
    Record.updateOne(
      { appointmentId: evt.appointmentId },
      {
        $setOnInsert: {
          appointmentId: evt.appointmentId,
          patientId: evt.patientId,
          patientName: evt.patientName,
          doctorId: evt.doctorId,
          doctorName: evt.doctorName,
          doctorEmail: evt.doctorEmail,
          clinicName: evt.clinicName,
          visitDate: evt.slot,
          status: 'pending',
        },
      },
      { upsert: true }
    ),
  // Only a still-pending record is cancelled; a completed one is kept.
  'appointment.cancelled': (evt) =>
    Record.updateOne(
      { appointmentId: evt.appointmentId, status: 'pending' },
      { $set: { status: 'cancelled' } }
    ),
};

async function connectRabbit(url, name = 'records-service') {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      const conn = await amqp.connect(url);
      const channel = await conn.createChannel();
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      const q = await channel.assertQueue(QUEUE, { durable: true });
      for (const key of Object.keys(handlers)) {
        await channel.bindQueue(q.queue, EXCHANGE, key);
      }

      channel.consume(q.queue, async (msg) => {
        if (!msg) return;
        const key = msg.fields.routingKey;
        try {
          const evt = JSON.parse(msg.content.toString());
          console.log(`[records-service] received ${key}`, evt.appointmentId);
          await handlers[key](evt);
          channel.ack(msg);
        } catch (err) {
          console.error(`[records-service] failed to process ${key}:`, err.message);
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
