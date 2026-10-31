const { useState, useEffect, useRef, useCallback } = React;

const session = {
  get token() { return localStorage.getItem('mc_token') || ''; },
  get user() { try { return JSON.parse(localStorage.getItem('mc_user') || 'null'); } catch { return null; } },
  save(token, user) { localStorage.setItem('mc_token', token); localStorage.setItem('mc_user', JSON.stringify(user)); },
  clear() { localStorage.removeItem('mc_token'); localStorage.removeItem('mc_user'); },
};

const bus = new EventTarget();
const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

function createRequestId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return [...bytes].map((b, i) => `${b.toString(16).padStart(2, '0')}${[3, 5, 7, 9].includes(i) ? '-' : ''}`).join('');
  }
  throw new Error('Secure random number generation is unavailable in this browser.');
}

async function api(path, { method = 'GET', body, headers = {}, auth = true } = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (auth && session.token) h.Authorization = 'Bearer ' + session.token;
  let res;
  try {
    res = await fetch('/api' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  } catch {
    throw new Error('Cannot reach the server. Please check that the system is running.');
  }
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: 'Service is temporarily unavailable. Please try again.' }; }
  if (res.status === 401 && auth && session.token) emit('logout', 'Your session has expired. Please log in again.');
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function download(path, filename) {
  const res = await fetch('/api' + path, { headers: { Authorization: 'Bearer ' + session.token } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Download failed (${res.status})`);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const toast = (text, type = 'ok') => emit('toast', { id: Math.random(), text, type });
const toastError = (e) => toast(e.message || String(e), 'err');

function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const onToast = (e) => {
      const t = e.detail;
      setItems((list) => [...list, t]);
      setTimeout(() => setItems((list) => list.filter((x) => x.id !== t.id)), t.type === 'err' ? 7000 : 5000);
    };
    bus.addEventListener('toast', onToast);
    return () => bus.removeEventListener('toast', onToast);
  }, []);
  return (
    <div className="toasts" role="status">
      {items.map((t) => <div key={t.id} className={'msg ' + t.type}>{t.text}</div>)}
    </div>
  );
}

function usePoll(load, ms = 5000, deps = []) {
  const saved = useRef(load);
  saved.current = load;
  useEffect(() => {
    let active = true;
    const run = () => active && saved.current();
    run();
    const timer = setInterval(run, ms);
    return () => { active = false; clearInterval(timer); };
  }, deps);
}

function useApi(path, ms = 5000) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api(path).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message)), [path]);
  usePoll(load, ms, [path]);
  return { data, error, reload: load };
}

function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

const Badge = ({ value, label }) => <span className={'badge ' + value}>{label || String(value).replace('_', ' ')}</span>;
const money = (n, cur = 'LKR') => `${cur} ${Number(n || 0).toLocaleString('en-LK', { minimumFractionDigits: 2 })}`;
const when = (d) => (d ? new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '-');
const Stars = ({ value }) => (value ? <span title={`${value} / 5`}>{'★'.repeat(Math.round(value))}{'☆'.repeat(5 - Math.round(value))} {value}</span> : <span className="muted">No reviews yet</span>);
const Empty = ({ children }) => <p className="muted">{children}</p>;

function groupByDay(slots) {
  const days = {};
  for (const s of slots) (days[s.slice(0, 10)] = days[s.slice(0, 10)] || []).push(s);
  return Object.entries(days);
}

const dayLabel = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

function Countdown({ until }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const ms = new Date(until).getTime() - Date.now();
  if (ms <= 0) return <span className="muted">hold ending...</span>;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return <span>{m}:{String(s).padStart(2, '0')} left to pay</span>;
}
