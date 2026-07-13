/**
 * Messaging layer (consumer): subscribes to "appointment.booked".
 * When a patient books, this service automatically creates a pending
 * consultation record for the doctor to complete after the visit. This
 * demonstrates asynchronous, decoupled inter-service communication.
 */
const amqp = require('amqplib');
const Record = require('./model');

const EXCHANGE = 'mediconnect.events';
const QUEUE = 'records.appointment-booked';

async function connectRabbit(url, name = 'records-service') {
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
          console.log('[records-service] received appointment.booked', evt.appointmentId);
          await Record.updateOne(
            { appointmentId: evt.appointmentId },
            {
              $setOnInsert: {
                appointmentId: evt.appointmentId,
                patientId: evt.patientId,
                patientName: evt.patientName,
                doctorId: evt.doctorId,
                doctorName: evt.doctorName,
                clinicName: evt.clinicName,
                visitDate: evt.slot,
                status: 'pending',
              },
            },
            { upsert: true }
          );
          channel.ack(msg);
        } catch (err) {
          console.error('[records-service] failed to process event:', err.message);
          channel.nack(msg, false, false); // drop poison message
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
  console.warn(`[${name}] could not connect to RabbitMQ; records will not auto-create`);
}

module.exports = { connectRabbit };
