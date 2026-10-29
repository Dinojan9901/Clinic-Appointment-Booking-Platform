/**
 * Shared messaging layer used by every service.
 *  - Transactional outbox: events are stored inside the aggregate document
 *    (`pendingEvents`) in the same atomic write as the state change, then
 *    relayed to RabbitMQ on a confirm channel and removed only after the ack.
 *  - Consumers: per-queue retry queue (TTL + dead-letter back to the SAME
 *    queue), capped attempts, then a `.dead` parking queue.
 */
const crypto = require('crypto');
const amqp = require('amqplib');
const mongoose = require('mongoose');

const EXCHANGE = 'mediconnect.events';
const RELAY_INTERVAL_MS = 2000;
const RETRY_DELAY_MS = 5000;
const MAX_ATTEMPTS = 5;

const outboxSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true },
    routingKey: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

function outboxEvent(routingKey, payload) {
  return { eventId: crypto.randomUUID(), routingKey, payload, createdAt: new Date() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class EventBus {
  constructor(url, name) {
    this.url = url;
    this.name = name;
    this.conn = null;
    this.channel = null;
    this.subscriptions = [];
    this.outboxModels = [];
    this.flushing = false;
    this.flushAgain = false;
  }

  subscribe(queue, bindings, handler) {
    this.subscriptions.push({ queue, bindings, handler });
  }

  useOutbox(Model) {
    this.outboxModels.push(Model);
  }

  start() {
    this.connect();
    setInterval(() => this.flush(), RELAY_INTERVAL_MS);
  }

  async connect() {
    for (let attempt = 1; ; attempt++) {
      let conn;
      try {
        conn = await amqp.connect(this.url);
        conn.on('error', () => {});
        const channel = await conn.createConfirmChannel();
        await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
        await channel.prefetch(20);
        for (const sub of this.subscriptions) await this.consume(channel, sub);
        conn.on('close', () => {
          if (this.conn !== conn) return;
          this.conn = null;
          this.channel = null;
          console.warn(`[${this.name}] RabbitMQ connection closed; reconnecting...`);
          setTimeout(() => this.connect(), 3000);
        });
        this.conn = conn;
        this.channel = channel;
        console.log(`[${this.name}] connected to RabbitMQ`);
        this.flush();
        return;
      } catch (err) {
        if (conn) conn.close().catch(() => {});
        console.log(`[${this.name}] RabbitMQ attempt ${attempt} failed (${err.message}); retrying in 3s`);
        await sleep(3000);
      }
    }
  }

  async consume(channel, sub) {
    const { queue, bindings } = sub;
    await channel.assertQueue(queue, { durable: true });
    await channel.assertQueue(`${queue}.retry`, {
      durable: true,
      arguments: {
        'x-message-ttl': RETRY_DELAY_MS,
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': queue,
      },
    });
    await channel.assertQueue(`${queue}.dead`, { durable: true });
    for (const key of bindings) await channel.bindQueue(queue, EXCHANGE, key);
    await channel.consume(queue, (msg) => {
      this.handle(channel, sub, msg).catch((err) =>
        console.error(`[${this.name}] consumer error: ${err.message}`)
      );
    });
    console.log(`[${this.name}] consuming ${queue} (${bindings.join(', ')})`);
  }

  async handle(channel, { queue, handler }, msg) {
    if (!msg) return;
    const headers = msg.properties.headers || {};
    const routingKey = headers['x-routing-key'] || msg.fields.routingKey;
    const attempt = Number(headers['x-attempt'] || 0);
    try {
      const event = JSON.parse(msg.content.toString());
      await handler(event, routingKey);
      channel.ack(msg);
    } catch (err) {
      const target = attempt + 1 < MAX_ATTEMPTS ? `${queue}.retry` : `${queue}.dead`;
      console.error(`[${this.name}] ${routingKey} failed (attempt ${attempt + 1}/${MAX_ATTEMPTS}): ${err.message} -> ${target}`);
      channel.sendToQueue(target, msg.content, {
        persistent: true,
        contentType: 'application/json',
        messageId: msg.properties.messageId,
        headers: { ...headers, 'x-routing-key': routingKey, 'x-attempt': attempt + 1, 'x-error': err.message },
      });
      await channel.waitForConfirms();
      channel.ack(msg);
    }
  }

  publishConfirmed(evt) {
    const body = { ...evt.payload, eventId: evt.eventId, type: evt.routingKey, occurredAt: evt.createdAt };
    return new Promise((resolve, reject) => {
      this.channel.publish(
        EXCHANGE,
        evt.routingKey,
        Buffer.from(JSON.stringify(body)),
        { persistent: true, contentType: 'application/json', messageId: evt.eventId },
        (err) => (err ? reject(err) : resolve())
      );
    });
  }

  async flush() {
    if (!this.channel) return;
    if (this.flushing) {
      this.flushAgain = true;
      return;
    }
    this.flushing = true;
    try {
      do {
        this.flushAgain = false;
        for (const Model of this.outboxModels) {
          const docs = await Model.find({ 'pendingEvents.0': { $exists: true } })
            .select('pendingEvents')
            .limit(100);
          for (const doc of docs) {
            for (const evt of doc.pendingEvents) {
              if (!this.channel) return;
              await this.publishConfirmed(evt);
              await Model.updateOne({ _id: doc._id }, { $pull: { pendingEvents: { eventId: evt.eventId } } });
              console.log(`[outbox] published ${evt.routingKey} (${evt.eventId})`);
            }
          }
        }
      } while (this.flushAgain);
    } catch (err) {
      console.warn(`[outbox] relay error, will retry: ${err.message}`);
    } finally {
      this.flushing = false;
    }
  }
}

module.exports = { EventBus, outboxEvent, outboxSchema, EXCHANGE };
