/**
 * Messaging layer (publisher) - Transactional Outbox relay.
 * This is the asynchronous, event-driven backbone from CA01. Business logic
 * never talks to RabbitMQ directly: it stores events in the appointment's
 * `pendingEvents` outbox in the same atomic write as the state change. This
 * relay then publishes them on a *confirm channel* and deletes each event
 * only after the broker has acknowledged it.
 *
 * Result: if RabbitMQ is down or slow, events wait in MongoDB and are
 * delivered once it is back - none are lost. Delivery is at-least-once, so
 * every event carries an eventId and the consumers are idempotent.
 *
 * Connection is retried indefinitely in the background and re-established
 * automatically if it drops.
 */
const crypto = require('crypto');
const amqp = require('amqplib');
const { Appointment } = require('./models');

const EXCHANGE = 'mediconnect.events';
const RELAY_INTERVAL_MS = 2000;
let channel = null;
let flushing = false;
let flushAgain = false;
let reconnectTimer = null;

function scheduleReconnect(url, name) {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectRabbit(url, name);
  }, 3000);
}

async function connectRabbit(url, name = 'service') {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      const conn = await amqp.connect(url);
      channel = await conn.createConfirmChannel();
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      console.log(`[${name}] connected to RabbitMQ`);
      conn.on('close', () => {
        channel = null;
        console.warn(`[${name}] RabbitMQ connection closed; reconnecting...`);
        scheduleReconnect(url, name);
      });
      conn.on('error', (err) => {
        channel = null;
        console.warn(`[${name}] RabbitMQ connection error: ${err.message}`);
        scheduleReconnect(url, name);
      });
      flushOutbox(); // deliver anything that queued up while disconnected
      return;
    } catch (err) {
      console.log(`[${name}] RabbitMQ attempt ${attempt} failed (${err.message}); retrying in 3s`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

/** Builds an outbox entry to be saved together with the appointment. */
function outboxEvent(routingKey, payload) {
  return { eventId: crypto.randomUUID(), routingKey, payload, createdAt: new Date() };
}

// Publish one event and resolve only once RabbitMQ confirms it.
function publishConfirmed(evt) {
  const body = { ...evt.payload, eventId: evt.eventId, type: evt.routingKey };
  return new Promise((resolve, reject) => {
    channel.publish(
      EXCHANGE,
      evt.routingKey,
      Buffer.from(JSON.stringify(body)),
      { persistent: true, contentType: 'application/json', messageId: evt.eventId },
      (err) => (err ? reject(err) : resolve())
    );
  });
}

/** Publishes all pending outbox events (in order, per appointment). */
async function flushOutbox() {
  if (!channel) return;
  if (flushing) {
    flushAgain = true;
    return;
  }
  flushing = true;
  try {
    do {
      flushAgain = false;
      const appts = await Appointment.find({ 'pendingEvents.0': { $exists: true } })
        .select('pendingEvents')
        .limit(100);
      for (const appt of appts) {
        for (const evt of appt.pendingEvents) {
          if (!channel) return;
          await publishConfirmed(evt);
          await Appointment.updateOne(
            { _id: appt._id },
            { $pull: { pendingEvents: { eventId: evt.eventId } } }
          );
          console.log(`[outbox] published ${evt.routingKey} (${evt.eventId})`);
        }
      }
    } while (flushAgain);
  } catch (err) {
    // Events stay in the outbox and are retried on the next tick.
    console.warn('[outbox] relay error, will retry:', err.message);
  } finally {
    flushing = false;
  }
}

function startOutboxRelay() {
  setInterval(flushOutbox, RELAY_INTERVAL_MS);
}

module.exports = { connectRabbit, outboxEvent, flushOutbox, startOutboxRelay };
