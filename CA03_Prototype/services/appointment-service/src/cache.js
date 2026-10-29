/**
 * Redis cache-aside for doctor search (CA01 performance tactic).
 * Invalidation bumps a version number that is part of every key, so all
 * replicas stop using stale entries at once. If Redis is down the service
 * simply reads from MongoDB.
 */
const { createClient } = require('redis');

const TTL_SECONDS = 60;
let client = null;
let ready = false;

function connectCache(url) {
  client = createClient({ url, socket: { reconnectStrategy: (n) => Math.min(n * 500, 5000) } });
  client.on('ready', () => {
    ready = true;
    console.log('[cache] connected to Redis');
  });
  client.on('end', () => (ready = false));
  client.on('error', () => (ready = false));
  client.connect().catch(() => {});
}

async function cached(prefix, params, loader) {
  if (!ready) return { data: await loader(), status: 'BYPASS' };
  try {
    const version = (await client.get(`${prefix}:v`)) || '0';
    const key = `${prefix}:${version}:${JSON.stringify(params)}`;
    const hit = await client.get(key);
    if (hit) return { data: JSON.parse(hit), status: 'HIT' };
    const data = await loader();
    await client.set(key, JSON.stringify(data), { EX: TTL_SECONDS });
    return { data, status: 'MISS' };
  } catch {
    return { data: await loader(), status: 'BYPASS' };
  }
}

async function invalidate(prefix) {
  if (!ready) return;
  try {
    await client.incr(`${prefix}:v`);
  } catch {
    /* entries expire via TTL */
  }
}

module.exports = { connectCache, cached, invalidate };
