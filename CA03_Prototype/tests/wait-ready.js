/** Waits until the gateway, every service and RabbitMQ report healthy (default timeout 6 min). */
const GW = process.env.GW || 'http://localhost:8090/api';
const TIMEOUT_MS = Number(process.env.READY_TIMEOUT_MS || 360000);

async function status() {
  const login = await fetch(`${GW}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@mediconnect.lk', password: 'admin123' }),
  });
  if (!login.ok) return `login ${login.status}`;
  const { token } = await login.json();
  const res = await fetch(`${GW}/admin/health`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return `health ${res.status}`;
  const down = (await res.json()).filter((h) => h.status !== 'up').map((h) => h.service);
  return down.length ? `waiting for ${down.join(', ')}` : 'ready';
}

(async () => {
  const end = Date.now() + TIMEOUT_MS;
  let last = '';
  while (Date.now() < end) {
    const s = await status().catch((e) => `gateway not reachable (${e.cause?.code || e.message})`);
    if (s === 'ready') {
      console.log('MediConnect is ready.');
      process.exit(0);
    }
    if (s !== last) console.log(s);
    last = s;
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.error('Timed out waiting for the stack to become ready.');
  process.exit(1);
})();
