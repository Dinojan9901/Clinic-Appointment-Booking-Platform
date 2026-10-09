/** Durable outbox publisher. Pending events survive broker outages/restarts. */
const amqp = require('amqplib');
const { OutboxEvent } = require('./models');

const EXCHANGE = 'mediconnect.events';
const QUEUES = ['records.appointment-booked', 'notifications.appointment-booked'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connectRabbit(url, name = 'appointment-service') {
  // Keep retrying for the lifetime of the service, including after a broker
  // restart. The HTTP API stays available while events accumulate in Mongo.
  while (true) {
    let connection;
    try {
      connection = await amqp.connect(url);
      const channel = await connection.createConfirmChannel();
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      for (const queue of QUEUES) {
        const result = await channel.assertQueue(queue, { durable: true });
        await channel.bindQueue(result.queue, EXCHANGE, 'appointment.booked');
        await channel.bindQueue(result.queue, EXCHANGE, 'appointment.cancelled');
      }
      console.log(`[${name}] connected to RabbitMQ; draining outbox`);

      let connected = true;
      connection.on('close', () => { connected = false; console.warn(`[${name}] RabbitMQ connection closed`); });
      while (connected) {
        const event = await OutboxEvent.findOne({}).sort({ createdAt: 1 });
        if (!event) {
          await sleep(1000);
          continue;
        }
        await new Promise((resolve, reject) => {
          channel.publish(EXCHANGE, event.routingKey, Buffer.from(JSON.stringify(event.payload)), {
            persistent: true,
            contentType: 'application/json',
            messageId: event.eventId,
          }, (err) => err ? reject(err) : resolve());
        });
        await OutboxEvent.deleteOne({ _id: event._id });
        console.log(`[${name}] delivered ${event.routingKey} ${event.eventId}`);
      }
    } catch (err) {
      console.warn(`[${name}] RabbitMQ unavailable (${err.message}); retrying in 3s`);
    }
    try { await connection?.close(); } catch (_) { /* already disconnected */ }
    await sleep(3000);
  }
}

module.exports = { connectRabbit };
