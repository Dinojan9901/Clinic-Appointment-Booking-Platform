/**
 * Messaging layer: publishes domain events to RabbitMQ.
 * This is the asynchronous, event-driven backbone from CA01. When an
 * appointment is booked, an "AppointmentBooked" event is published and
 * consumed independently by the Notification and Records services.
 *
 * Connection is retried indefinitely in the background and re-established
 * automatically if it drops, so the service is resilient to RabbitMQ being
 * slow to start or restarting.
 */
const amqp = require('amqplib');

const EXCHANGE = 'mediconnect.events';
let channel = null;

async function connectRabbit(url, name = 'service') {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      const conn = await amqp.connect(url);
      channel = await conn.createChannel();
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      console.log(`[${name}] connected to RabbitMQ`);
      conn.on('close', () => {
        channel = null;
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

function publish(routingKey, message) {
  if (!channel) {
    console.warn('[events] no RabbitMQ channel yet; dropping event', routingKey);
    return;
  }
  channel.publish(EXCHANGE, routingKey, Buffer.from(JSON.stringify(message)), {
    persistent: true,
    contentType: 'application/json',
  });
  console.log(`[events] published ${routingKey}`, message);
}

module.exports = { connectRabbit, publish, EXCHANGE };
