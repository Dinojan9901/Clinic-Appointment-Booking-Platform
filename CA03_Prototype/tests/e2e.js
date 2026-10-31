/**
 * End-to-end test of the running stack, through the API gateway only.
 *   node tests/e2e.js                      (stack on localhost, gateway :8090)
 *   GW=http://host:8090/api node tests/e2e.js
 *   EXPIRY_TEST=1 (with HOLD_MINUTES=1 on the stack) also checks hold expiry.
 * Requires Node 18+ (built-in fetch).
 */
const GW = process.env.GW || 'http://localhost:8090/api';
const MAILPIT = process.env.MAILPIT || 'http://localhost:8025';
const RUN = Date.now().toString(36);

let failures = 0;
let passes = 0;
function check(name, cond, got) {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : `  -> ${JSON.stringify(got).slice(0, 400)}`}`);
}

async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(GW + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
  return { status: res.status, data, headers: res.headers };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await sleep(1000);
  }
  return null;
}

async function login(email, password) {
  return (await call('POST', '/auth/login', { body: { email, password } })).data.token;
}

async function patient(tag) {
  const email = `${tag}.${RUN}@test.lk`;
  await call('POST', '/auth/register', { body: { name: `Patient ${tag.toUpperCase()}`, email, password: 'secret1' } });
  return { email, token: await login(email, 'secret1') };
}

const lkSlot = (daysAhead, time) => {
  const d = new Date(Date.now() + 330 * 60000 + daysAhead * 86400000).toISOString().slice(0, 10);
  return `${d} ${time}`;
};
const CARD_OK = { cardNumber: '4242 4242 4242 4242', expMonth: '12', expYear: '30', cvc: '123' };
const CARD_DECLINED = { ...CARD_OK, cardNumber: '4000 0000 0000 0002' };

async function bookAndPay(p, doctorId, slot) {
  const b = await call('POST', '/appointments', { token: p.token, body: { doctorId, slot } });
  const pay = await call('POST', '/payments', { token: p.token, body: { appointmentId: b.data._id, ...CARD_OK } });
  const booked = await waitFor(async () => {
    const a = (await call('GET', `/appointments/${b.data._id}`, { token: p.token })).data;
    return a.status === 'booked' && a;
  });
  return { appt: b.data, pay: pay.data, booked };
}

async function mailCount(to) {
  try {
    const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    return (await r.json()).messages_count;
  } catch {
    return null;
  }
}

async function main() {
  console.log(`Gateway ${GW} - run ${RUN}\n`);
  const admin = await login('admin@mediconnect.lk', 'admin123');
  check('admin can log in', !!admin);

  // ---------- Security ----------
  const hacker = await call('POST', '/auth/register', { body: { name: 'H', email: `h.${RUN}@test.lk`, password: 'secret1', role: 'admin' } });
  check('self-registration ignores role -> patient', hacker.status === 201 && hacker.data.role === 'patient', hacker);
  check('spoofed identity header without token -> 401', (await call('GET', '/auth/me', { headers: { 'x-user-id': 'x', 'x-user-role': 'admin' } })).status === 401);
  const pa = await patient('a');
  const pb = await patient('b');
  check('patient blocked from admin API (gateway) -> 403', (await call('GET', '/admin/stats', { token: pa.token })).status === 403);
  check('patient blocked from user list (service) -> 403', (await call('GET', '/auth/users', { token: pa.token })).status === 403);
  check('patient cannot create clinics -> 403', (await call('POST', '/clinics', { token: pa.token, body: { name: 'X', address: 'X', location: 'X' } })).status === 403);

  // ---------- Admin: clinics ----------
  const clinic = await call('POST', '/clinics', { token: admin, body: { name: `Test Clinic ${RUN}`, address: '1 Test Road, Galle', location: 'Galle', phone: '091 000 0000' } });
  check('admin creates a clinic', clinic.status === 201, clinic);
  check('public clinic list includes it', (await call('GET', '/clinics')).data.some((c) => c._id === clinic.data._id));

  // ---------- Doctor onboarding ----------
  const docEmail = `dr.${RUN}@test.lk`;
  const reg = await call('POST', '/auth/register-doctor', {
    body: { name: `Dr. Test ${RUN}`, email: docEmail, password: 'secret1', licenseNo: `SLMC-${RUN}`, speciality: 'Neurology', clinicId: clinic.data._id, fee: 2000 },
  });
  check('doctor self-registers (pending)', reg.status === 201 && reg.data.doctorStatus === 'pending', reg);
  const pendingLogin = await call('POST', '/auth/login', { body: { email: docEmail, password: 'secret1' } });
  check('pending doctor cannot log in -> 403', pendingLogin.status === 403, pendingLogin);
  const pending = (await call('GET', '/auth/doctors?status=pending', { token: admin })).data.find((d) => d.email === docEmail);
  check('admin sees doctor in verification queue', !!pending);
  check('admin approves doctor', (await call('POST', `/auth/doctors/${pending._id}/approve`, { token: admin })).status === 200);
  const dr = await waitFor(() => login(docEmail, 'secret1'));
  check('approved doctor can log in', !!dr);
  const profile = await waitFor(async () => {
    const p = (await call('GET', '/doctors/me', { token: dr })).data;
    return p.status === 'active' && p;
  });
  check('doctor profile activated via doctor.approved event', !!profile, profile);

  const slots = [lkSlot(2, '09:00'), lkSlot(2, '09:30'), lkSlot(2, '10:00'), lkSlot(2, '10:30'), lkSlot(3, '09:00'), lkSlot(3, '09:30')];
  for (const s of slots) await call('POST', '/doctors/me/slots', { token: dr, body: { slot: s } });
  check('doctor cannot publish a past slot', (await call('POST', '/doctors/me/slots', { token: dr, body: { slot: '2020-01-01 09:00' } })).status === 400);
  const search1 = await call('GET', '/doctors?speciality=Neurology&location=Galle', { token: pa.token });
  const listed = search1.data.find((d) => d._id === profile._id);
  check('published slots visible in search (cache invalidated)', listed && slots.every((s) => listed.availableSlots.includes(s)), search1.data);
  const search2 = await call('GET', '/doctors?speciality=Neurology&location=Galle', { token: pa.token });
  check('repeat search served from Redis cache (X-Cache: HIT)', search2.headers.get('x-cache') === 'HIT', search2.headers.get('x-cache'));

  // ---------- Booking Saga ----------
  const [x, y] = await Promise.all([
    call('POST', '/appointments', { token: pa.token, body: { doctorId: profile._id, slot: slots[0] } }),
    call('POST', '/appointments', { token: pb.token, body: { doctorId: profile._id, slot: slots[0] } }),
  ]);
  check('concurrent booking of one slot -> one 201 + one 409', [x.status, y.status].sort().join() === '201,409', [x.status, y.status]);
  const winner = x.status === 201 ? { p: pa, a: x.data } : { p: pb, a: y.data };
  check('new booking is a payment hold', winner.a.status === 'pending_payment' && !!winner.a.holdExpiresAt, winner.a);
  check('holds are hidden from the doctor until paid', !(await call('GET', '/appointments/doctor', { token: dr })).data.some((a) => a._id === winner.a._id));

  const declined = await call('POST', '/payments', { token: winner.p.token, body: { appointmentId: winner.a._id, ...CARD_DECLINED } });
  check('declined card -> 402', declined.status === 402, declined.data);
  const afterDecline = await waitFor(async () => {
    const a = (await call('GET', `/appointments/${winner.a._id}`, { token: winner.p.token })).data;
    return a.paymentStatus === 'failed' && a;
  });
  check('hold kept after decline (payment.failed event)', afterDecline && afterDecline.status === 'pending_payment', afterDecline);
  check('invalid card number rejected -> 400', (await call('POST', '/payments', { token: winner.p.token, body: { appointmentId: winner.a._id, ...CARD_OK, cardNumber: '4242 4242 4242 4241' } })).status === 400);
  const other = winner.p === pa ? pb : pa;
  check("cannot pay someone else's appointment -> 403", (await call('POST', '/payments', { token: other.token, body: { appointmentId: winner.a._id, ...CARD_OK } })).status === 403);

  const key = `idem-${RUN}`;
  const paid = await call('POST', '/payments', { token: winner.p.token, headers: { 'Idempotency-Key': key }, body: { appointmentId: winner.a._id, ...CARD_OK } });
  check('payment approved -> 201 with receipt', paid.status === 201 && /^RCPT-/.test(paid.data.receiptNo), paid.data);
  const replay = await call('POST', '/payments', { token: winner.p.token, headers: { 'Idempotency-Key': key }, body: { appointmentId: winner.a._id, ...CARD_OK } });
  check('same Idempotency-Key replays the same payment (no double charge)', replay.status === 200 && replay.data._id === paid.data._id, replay.data);
  check('second payment for a paid appointment -> 409', (await call('POST', '/payments', { token: winner.p.token, body: { appointmentId: winner.a._id, ...CARD_OK } })).status === 409);
  const confirmed = await waitFor(async () => {
    const a = (await call('GET', `/appointments/${winner.a._id}`, { token: winner.p.token })).data;
    return a.status === 'booked' && a;
  });
  check('payment.succeeded -> appointment booked + paid (Saga)', confirmed && confirmed.paymentStatus === 'paid' && confirmed.receiptNo === paid.data.receiptNo, confirmed);
  const receipt = await call('GET', `/payments/${paid.data._id}/receipt`, { token: winner.p.token });
  check('receipt PDF downloads', receipt.status === 200 && receipt.headers.get('content-type') === 'application/pdf');
  check("other patient cannot download the receipt", (await call('GET', `/payments/${paid.data._id}/receipt`, { token: other.token })).status === 404);
  const confirmNote = await waitFor(async () => (await call('GET', '/notifications/mine', { token: winner.p.token })).data.find((n) => n.message.includes('confirmed')));
  check('confirmation notification', !!confirmNote);
  check('doctor notified of the new booking', !!(await waitFor(async () => (await call('GET', '/notifications/mine', { token: dr })).data.find((n) => n.message.includes('New appointment')))));
  const mails = await waitFor(async () => ((await mailCount(winner.p.email)) || 0) >= 2 && (await mailCount(winner.p.email)), 20000);
  if (mails !== null) check('emails delivered to the Mailpit inbox', mails >= 2, mails);

  // ---------- Records, signed prescription, EHR ----------
  const record = await waitFor(async () => (await call('GET', '/records/doctor', { token: dr })).data.find((r) => r.appointmentId === winner.a._id));
  check('record auto-created for the doctor', !!record);
  const anushka = await login('anushka.perera@mediconnect.lk', 'doctor123');
  check('other doctor cannot complete it -> 403', (await call('PUT', `/records/${record._id}`, { token: anushka, body: { notes: 'x' } })).status === 403);
  check('notes are required -> 400', (await call('PUT', `/records/${record._id}`, { token: dr, body: { notes: '  ' } })).status === 400);
  check('review before the visit -> 409', (await call('POST', `/appointments/${winner.a._id}/review`, { token: winner.p.token, body: { rating: 5 } })).status === 409);
  const done = await call('PUT', `/records/${record._id}`, {
    token: dr,
    body: { notes: 'Migraine. Rest and hydration.', prescription: [{ medication: 'Paracetamol 500mg', dosage: '1 tab 3x daily' }, { medication: 'Sumatriptan 50mg', dosage: 'when needed' }] },
  });
  check('doctor completes and signs the record', done.status === 200 && done.data.status === 'completed' && /^RX-/.test(done.data.prescriptionCode) && !!done.data.signature, done.data);
  const verify = await call('GET', `/prescriptions/verify/${done.data.prescriptionCode}`);
  check('public verification: signature valid (Ed25519)', verify.status === 200 && verify.data.valid === true && verify.data.medications.length === 2, verify.data);
  check('unknown prescription code -> 404', (await call('GET', '/prescriptions/verify/RX-00000000')).status === 404);
  const pdf = await call('GET', `/records/${record._id}/prescription`, { token: winner.p.token });
  check('patient downloads prescription PDF', pdf.status === 200 && pdf.headers.get('content-type') === 'application/pdf');
  check('appointment moved to completed', (await call('GET', `/appointments/${winner.a._id}`, { token: winner.p.token })).data.status === 'completed');
  check('completed appointment cannot be cancelled -> 409', (await call('POST', `/appointments/${winner.a._id}/cancel`, { token: winner.p.token })).status === 409);
  const history = await call('GET', `/records/patient/${winner.a.patientId}`, { token: dr });
  check('treating doctor views patient history', history.status === 200 && history.data.records.length >= 1, history.data);
  check('unrelated doctor cannot view history -> 403', (await call('GET', `/records/patient/${winner.a.patientId}`, { token: anushka })).status === 403);

  // ---------- Reviews ----------
  check('patient reviews the completed visit', (await call('POST', `/appointments/${winner.a._id}/review`, { token: winner.p.token, body: { rating: 4, comment: 'Very clear explanation' } })).status === 201);
  check('second review -> 409', (await call('POST', `/appointments/${winner.a._id}/review`, { token: winner.p.token, body: { rating: 1 } })).status === 409);
  const rated = (await call('GET', `/doctors/${profile._id}`, { token: pa.token })).data;
  check('doctor rating updated', rated.rating === 4 && rated.ratingCount === 1, rated);

  // ---------- Reschedule ----------
  const r1 = await bookAndPay(pa, profile._id, slots[1]);
  check('second booking confirmed', !!r1.booked, r1);
  const moved = await call('POST', `/appointments/${r1.appt._id}/reschedule`, { token: pa.token, body: { slot: slots[4] } });
  check('reschedule to a free slot', moved.status === 200 && moved.data.slot === slots[4], moved.data);
  const freed = (await call('GET', `/doctors/${profile._id}`, { token: pa.token })).data.availableSlots;
  check('old slot released, new slot taken', freed.includes(slots[1]) && !freed.includes(slots[4]), freed);
  check('record visit date follows (appointment.rescheduled)', !!(await waitFor(async () => (await call('GET', '/records/doctor', { token: dr })).data.find((r) => r.appointmentId === r1.appt._id && r.visitDate === slots[4]))));
  check('reschedule into a taken slot -> 409', (await call('POST', `/appointments/${r1.appt._id}/reschedule`, { token: pa.token, body: { slot: slots[0] } })).status === 409);

  // ---------- Cancel + refund (compensation) ----------
  check('cancel a paid booking', (await call('POST', `/appointments/${r1.appt._id}/cancel`, { token: pa.token })).status === 200);
  const refunded = await waitFor(async () => (await call('GET', '/payments/mine', { token: pa.token })).data.find((p) => p.appointmentId === r1.appt._id && p.status === 'refunded'));
  check('payment refunded via appointment.cancelled', !!refunded);
  check('refund notification', !!(await waitFor(async () => (await call('GET', '/notifications/mine', { token: pa.token })).data.find((n) => n.message.includes('refund of')))));
  check('cancelled record hidden from doctor', !!(await waitFor(async () => !(await call('GET', '/records/doctor', { token: dr })).data.some((r) => r.appointmentId === r1.appt._id))));

  // ---------- Unpaid hold cancelled by patient ----------
  const hold = await call('POST', '/appointments', { token: pb.token, body: { doctorId: profile._id, slot: slots[2] } });
  check('cancel an unpaid hold', (await call('POST', `/appointments/${hold.data._id}/cancel`, { token: pb.token })).status === 200);
  check('paying a cancelled hold -> 409', (await call('POST', '/payments', { token: pb.token, body: { appointmentId: hold.data._id, ...CARD_OK } })).status === 409);

  // ---------- Hold expiry (optional: needs HOLD_MINUTES=1) ----------
  if (process.env.EXPIRY_TEST === '1') {
    const h = await call('POST', '/appointments', { token: pb.token, body: { doctorId: profile._id, slot: slots[3] } });
    const expired = await waitFor(async () => {
      const a = (await call('GET', `/appointments/${h.data._id}`, { token: pb.token })).data;
      return a.status === 'expired' && a;
    }, 150000);
    check('unpaid hold expires and releases the slot (Saga compensation)', !!expired && (await call('GET', `/doctors/${profile._id}`, { token: pa.token })).data.availableSlots.includes(slots[3]), expired);
    check('late payment after expiry -> 409', (await call('POST', '/payments', { token: pb.token, body: { appointmentId: h.data._id, ...CARD_OK } })).status === 409);
  }

  // ---------- Admin: users, monitoring ----------
  const users = (await call('GET', `/auth/users?q=${encodeURIComponent(docEmail)}`, { token: admin })).data;
  check('admin disables the doctor', (await call('PATCH', `/auth/users/${users[0]._id}/status`, { token: admin, body: { active: false } })).status === 200);
  check('disabled doctor cannot log in', (await call('POST', '/auth/login', { body: { email: docEmail, password: 'secret1' } })).status === 403);
  check('disabled doctor hidden from search', !!(await waitFor(async () => !(await call('GET', '/doctors?location=Galle', { token: pa.token })).data.some((d) => d._id === profile._id))));
  check('admin re-enables the doctor', (await call('PATCH', `/auth/users/${users[0]._id}/status`, { token: admin, body: { active: true } })).status === 200);
  const stats = (await call('GET', '/admin/stats', { token: admin })).data;
  check('admin stats built from events', stats.bookingsConfirmed >= 2 && stats.revenue.collected > 0, stats);
  const activity = (await call('GET', '/admin/activity?limit=500', { token: admin })).data;
  check('audit log records EHR access', activity.some((a) => a.type === 'ehr.accessed'), activity.length);
  const health = (await call('GET', '/admin/health', { token: admin })).data;
  check('all services report healthy', health.every((h) => h.status === 'up'), health);
  const payments = (await call('GET', '/payments', { token: admin })).data;
  check('admin payment totals', payments.totals.refunded >= 2000 && payments.totals.net >= 2000, payments.totals);

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error('Test run crashed:', err);
  process.exit(1);
});
