/**
 * Messaging layer: publishes domain events to RabbitMQ.
 * This is the asynchronous, event-driven backbone from CA01. When an
 * appointment is booked, an "AppointmentBooked" event is published and
 * consumed independently by the Notification and Records services.
 */
const amqp = require('amqplib');

const EXCHANGE = 'mediconnect.events';
let channel = null;

async function connectRabbit(url, name = 'service') {
  for (let attempt = 1; attempt <= 15; attempt++) {
    try {
      const conn = await amqp.connect(url);
      channel = await conn.createChannel();
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      console.log(`[${name}] connected to RabbitMQ`);
      conn.on('close', () => { channel = null; });
      return;
    } catch (err) {
      console.log(`[${name}] RabbitMQ attempt ${attempt} failed (${err.message}); retrying in 3s`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  console.warn(`[${name}] could not connect to RabbitMQ; events will not be published`);
}

function publish(routingKey, message) {
  if (!channel) {
    console.warn('[events] no RabbitMQ channel; dropping event', routingKey);
    return;
  }
  channel.publish(EXCHANGE, routingKey, Buffer.from(JSON.stringify(message)), {
    persistent: true,
    contentType: 'application/json',
  });
  console.log(`[events] published ${routingKey}`, message);
}

module.exports = { connectRabbit, publish, EXCHANGE };
