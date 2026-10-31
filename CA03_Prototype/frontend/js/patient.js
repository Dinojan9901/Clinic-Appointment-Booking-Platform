function FindDoctor() {
  const [filters, setFilters] = useState({ speciality: '', location: '', clinicId: '' });
  const [doctors, setDoctors] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [paying, setPaying] = useState(null);
  const [reviewsOf, setReviewsOf] = useState(null);
  const [busySlot, setBusySlot] = useState('');

  async function search(f = filters) {
    try {
      const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v.trim()));
      const data = await api('/doctors?' + q.toString());
      setDoctors(data);
      if (!data.length) toast('No doctors found for those filters.', 'info');
    } catch (e) { toastError(e); }
  }

  useEffect(() => { search(); api('/clinics').then(setClinics).catch(() => {}); }, []);

  async function book(doctor, slot) {
    setBusySlot(doctor._id + slot);
    try {
      const appt = await api('/appointments', { method: 'POST', body: { doctorId: doctor._id, slot } });
      toast(`Slot ${slot} is held for you. Complete the payment to confirm it.`, 'info');
      setPaying(appt);
      await search();
    } catch (e) { toastError(e); await search(); } finally { setBusySlot(''); }
  }

  const f = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });
  return (
    <div className="card">
      <h2>Find a Doctor</h2>
      <form className="row" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <div><label>Speciality</label><input placeholder="e.g. Cardiology" value={filters.speciality} onChange={f('speciality')} /></div>
        <div><label>Location</label><input placeholder="e.g. Kandy" value={filters.location} onChange={f('location')} /></div>
        <div>
          <label>Clinic</label>
          <select value={filters.clinicId} onChange={f('clinicId')}>
            <option value="">Any clinic</option>
            {clinics.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 12 }}><button type="submit">Search</button></div>
      </form>
      {doctors.map((d) => (
        <div className="item" key={d._id}>
          <h3>{d.name} <span className="muted">- {d.speciality}</span></h3>
          <div className="muted">{d.clinicName}, {d.clinicAddress} ({d.location})</div>
          <div className="muted">Fee: {money(d.fee)} &nbsp;|&nbsp; <Stars value={d.rating} /> {d.ratingCount > 0 && <a href="#" onClick={(e) => { e.preventDefault(); setReviewsOf(d); }}>({d.ratingCount} {d.ratingCount === 1 ? 'review' : 'reviews'})</a>}</div>
          {d.availableSlots.length === 0 && <div className="muted" style={{ marginTop: 6 }}>No upcoming slots</div>}
          {groupByDay(d.availableSlots).map(([day, slots]) => (
            <div className="day" key={day}>
              <span className="muted" style={{ display: 'inline-block', width: 100 }}>{dayLabel(day)}</span>
              {slots.map((s) => (
                <button className="slot secondary small" key={s} disabled={busySlot === d._id + s} onClick={() => book(d, s)}>{s.slice(11)}</button>
              ))}
            </div>
          ))}
        </div>
      ))}
      {paying && <PaymentModal appointment={paying} onClose={() => setPaying(null)} />}
      {reviewsOf && <ReviewsModal doctor={reviewsOf} onClose={() => setReviewsOf(null)} />}
    </div>
  );
}

function ReviewsModal({ doctor, onClose }) {
  const [items, setItems] = useState(null);
  useEffect(() => { api(`/doctors/${doctor._id}/reviews`).then(setItems).catch(toastError); }, []);
  return (
    <Modal title={`Reviews - ${doctor.name}`} onClose={onClose}>
      {!items ? <p>Loading...</p> : items.length === 0 ? <Empty>No reviews yet.</Empty> : items.map((r) => (
        <div className="item" key={r._id}><Stars value={r.rating} /> <span className="muted">by {r.patientName}, {when(r.createdAt)}</span>{r.comment && <div>{r.comment}</div>}</div>
      ))}
      <button className="secondary" onClick={onClose}>Close</button>
    </Modal>
  );
}

const TEST_CARDS = [
  ['4242 4242 4242 4242', 'approved'],
  ['4000 0000 0000 0002', 'declined'],
  ['4000 0000 0000 9995', 'insufficient funds'],
];

function PaymentModal({ appointment, onClose }) {
  const [card, setCard] = useState({ cardNumber: '', exp: '12/30', cvc: '123', name: '' });
  const [state, setState] = useState({ busy: false, msg: null, done: false });

  async function waitForConfirmation() {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const a = await api(`/appointments/${appointment._id}`).catch(() => null);
      if (a && a.status === 'booked') return true;
    }
    return false;
  }

  async function pay(e) {
    e.preventDefault();
    const [expMonth, expYear] = card.exp.split('/').map((s) => s.trim());
    setState({ busy: true, msg: null });
    try {
      const p = await api('/payments', {
        method: 'POST',
        headers: { 'Idempotency-Key': createRequestId() },
        body: { appointmentId: appointment._id, cardNumber: card.cardNumber, expMonth, expYear, cvc: card.cvc },
      });
      setState({ busy: true, msg: { type: 'info', text: `Payment approved (${p.receiptNo}). Confirming your booking...` } });
      const ok = await waitForConfirmation();
      toast(ok ? `Appointment confirmed for ${appointment.slot}. Receipt ${p.receiptNo}.` : 'Payment received - your confirmation will appear shortly.');
      setState({ busy: false, done: true, msg: { type: 'ok', text: ok ? 'Your appointment is confirmed.' : 'Payment received. Confirmation is on its way.' } });
    } catch (err) {
      setState({ busy: false, msg: { type: 'err', text: err.message } });
    }
  }

  const s = (k) => (e) => setCard({ ...card, [k]: e.target.value });
  return (
    <Modal title="Checkout" onClose={onClose}>
      <p className="muted">{appointment.doctorName} - {appointment.clinicName}<br />{appointment.slot} &nbsp;|&nbsp; <strong>{money(appointment.fee)}</strong>
        {appointment.holdExpiresAt && <><br /><Countdown until={appointment.holdExpiresAt} /></>}</p>
      {state.msg && <div className={'msg ' + state.msg.type}>{state.msg.text}</div>}
      {state.done ? <button onClick={onClose}>Done</button> : (
        <form onSubmit={pay}>
          <label>Card number</label>
          <input inputMode="numeric" value={card.cardNumber} onChange={s('cardNumber')} placeholder="4242 4242 4242 4242" required />
          <div className="row">
            <div><label>Expiry (MM/YY)</label><input value={card.exp} onChange={s('exp')} required /></div>
            <div><label>CVC</label><input value={card.cvc} onChange={s('cvc')} required /></div>
          </div>
          <div className="msg info" style={{ fontSize: 13 }}>
            Simulated payment - no real money. Test cards:{' '}
            {TEST_CARDS.map(([n, label]) => <a key={n} href="#" style={{ marginRight: 8 }} onClick={(e) => { e.preventDefault(); setCard({ ...card, cardNumber: n }); }}>{label}</a>)}
          </div>
          <div className="actions">
            <button type="submit" disabled={state.busy}>{state.busy ? 'Processing...' : `Pay ${money(appointment.fee)}`}</button>
            <button type="button" className="secondary" onClick={onClose}>Pay later</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function MyAppointments() {
  const { data, reload } = useApi('/appointments/mine');
  const [modal, setModal] = useState(null);

  async function cancel(a) {
    if (!confirm(`Cancel your appointment on ${a.slot}?${a.status === 'booked' ? ' The fee will be refunded.' : ''}`)) return;
    try {
      await api(`/appointments/${a._id}/cancel`, { method: 'POST' });
      toast(a.status === 'booked' ? 'Appointment has been cancelled. A refund is being processed.' : 'Appointment has been cancelled.');
      reload();
    } catch (e) { toastError(e); }
  }

  const close = () => { setModal(null); reload(); };
  return (
    <div className="card">
      <h2>My Appointments</h2>
      {data && data.length === 0 && <Empty>No appointments yet.</Empty>}
      {(data || []).map((a) => (
        <div className="item" key={a._id}>
          <h3>{a.doctorName} <span className="muted">- {a.speciality}</span></h3>
          <div className="muted">{a.clinicName}, {a.clinicAddress}</div>
          <div className="muted">Slot: <strong>{a.slot}</strong> &nbsp;|&nbsp; Fee: {money(a.fee)}{a.receiptNo && <> &nbsp;|&nbsp; Receipt {a.receiptNo}</>}</div>
          {a.rescheduleHistory?.length > 0 && <div className="muted">Rescheduled from {a.rescheduleHistory.map((h) => h.from).join(', ')}</div>}
          <div className="actions" style={{ marginTop: 8 }}>
            <Badge value={a.status} /> <Badge value={a.paymentStatus} />
            {a.status === 'pending_payment' && <><span className="muted"><Countdown until={a.holdExpiresAt} /></span><button className="small" onClick={() => setModal({ type: 'pay', a })}>Pay now</button></>}
            {a.status === 'booked' && <button className="small secondary" onClick={() => setModal({ type: 'move', a })}>Reschedule</button>}
            {['pending_payment', 'booked'].includes(a.status) && <button className="small danger" onClick={() => cancel(a)}>Cancel</button>}
            {a.status === 'completed' && !a.reviewed && <button className="small ok" onClick={() => setModal({ type: 'rate', a })}>Rate your visit</button>}
            {a.reviewed && <span className="muted">Reviewed - thank you</span>}
          </div>
        </div>
      ))}
      {modal?.type === 'pay' && <PaymentModal appointment={modal.a} onClose={close} />}
      {modal?.type === 'move' && <RescheduleModal appointment={modal.a} onClose={close} />}
      {modal?.type === 'rate' && <RateModal appointment={modal.a} onClose={close} />}
    </div>
  );
}

function RescheduleModal({ appointment, onClose }) {
  const [slots, setSlots] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api(`/doctors/${appointment.doctorId}`).then((d) => setSlots(d.availableSlots)).catch((e) => { toastError(e); setSlots([]); }); }, []);
  async function move(slot) {
    setBusy(true);
    try {
      await api(`/appointments/${appointment._id}/reschedule`, { method: 'POST', body: { slot } });
      toast(`Appointment moved to ${slot}.`);
      onClose();
    } catch (e) { toastError(e); setBusy(false); }
  }
  return (
    <Modal title="Reschedule" onClose={onClose}>
      <p className="muted">{appointment.doctorName} - currently {appointment.slot}. Pick a new free slot (no extra charge):</p>
      {!slots ? <p>Loading...</p> : slots.length === 0 ? <Empty>No other free slots right now.</Empty> : groupByDay(slots).map(([day, list]) => (
        <div className="day" key={day}><span className="muted" style={{ display: 'inline-block', width: 100 }}>{dayLabel(day)}</span>
          {list.map((s) => <button key={s} className="slot secondary small" disabled={busy} onClick={() => move(s)}>{s.slice(11)}</button>)}
        </div>
      ))}
      <div style={{ marginTop: 12 }}><button className="secondary" onClick={onClose}>Close</button></div>
    </Modal>
  );
}

function RateModal({ appointment, onClose }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  async function submit() {
    try {
      await api(`/appointments/${appointment._id}/review`, { method: 'POST', body: { rating, comment } });
      toast('Thanks for your feedback!');
      onClose();
    } catch (e) { toastError(e); }
  }
  return (
    <Modal title={`Rate ${appointment.doctorName}`} onClose={onClose}>
      <div className="stars">{[1, 2, 3, 4, 5].map((n) => <button key={n} className={n <= rating ? 'on' : ''} onClick={() => setRating(n)} aria-label={`${n} stars`}>★</button>)}</div>
      <label>Comment (optional)</label>
      <textarea rows="3" maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} />
      <div className="actions"><button onClick={submit}>Submit review</button><button className="secondary" onClick={onClose}>Cancel</button></div>
    </Modal>
  );
}

function PrescriptionActions({ record }) {
  if (record.status !== 'completed' || !record.prescriptionCode) return null;
  return (
    <div className="actions" style={{ marginTop: 8 }}>
      <button className="small" onClick={() => download(`/records/${record._id}/prescription`, `${record.prescriptionCode}.pdf`).catch(toastError)}>Download prescription (PDF)</button>
      <a className="muted" href={`/verify/${record.prescriptionCode}`} target="_blank" rel="noreferrer">Verify {record.prescriptionCode}</a>
    </div>
  );
}

function RecordBody({ r }) {
  return (
    <>
      <div className="muted">Visit: {r.visitDate} at {r.clinicName}</div>
      <div style={{ marginTop: 6 }}><strong>Notes:</strong> {r.notes || <span className="muted">pending</span>}</div>
      <div style={{ marginTop: 6 }}><strong>Prescription:</strong>
        {r.prescription && r.prescription.length ? <ul style={{ margin: '4px 0' }}>{r.prescription.map((p, i) => <li key={i}>{p.medication}{p.dosage && ' - ' + p.dosage}</li>)}</ul> : <span className="muted"> none</span>}
      </div>
    </>
  );
}

function MyRecords() {
  const { data } = useApi('/records/mine');
  return (
    <div className="card">
      <h2>My Health Records</h2>
      {data && data.length === 0 && <Empty>No records yet. A record is created when your booking is confirmed and completed by the doctor after your visit.</Empty>}
      {(data || []).map((r) => (
        <div className="item" key={r._id}>
          <h3>{r.doctorName} <Badge value={r.status} /></h3>
          <RecordBody r={r} />
          <PrescriptionActions record={r} />
        </div>
      ))}
    </div>
  );
}

function MyPayments() {
  const { data } = useApi('/payments/mine', 10000);
  return (
    <div className="card">
      <h2>Payments & Receipts</h2>
      {data && data.length === 0 && <Empty>No payments yet.</Empty>}
      <div className="table-wrap">
        <table>
          {data && data.length > 0 && <thead><tr><th>Date</th><th>Appointment</th><th>Amount</th><th>Card</th><th>Status</th><th></th></tr></thead>}
          <tbody>
            {(data || []).map((p) => (
              <tr key={p._id}>
                <td>{when(p.createdAt)}</td>
                <td>{p.doctorName}<div className="muted">{p.slot}</div></td>
                <td>{money(p.amount, p.currency)}</td>
                <td>{p.cardBrand} ****{p.cardLast4}</td>
                <td><Badge value={p.status} />{p.failureReason && <div className="muted">{p.failureReason.replace('_', ' ')}</div>}</td>
                <td>{['succeeded', 'refunded'].includes(p.status) && <button className="small secondary" onClick={() => download(`/payments/${p._id}/receipt`, `${p.receiptNo}.pdf`).catch(toastError)}>Receipt</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Notifications({ onRead }) {
  const { data, reload } = useApi('/notifications/mine');
  async function markRead() {
    await api('/notifications/mine/read', { method: 'POST' }).catch(toastError);
    reload();
    onRead && onRead();
  }
  const unread = (data || []).filter((n) => !n.read).length;
  return (
    <div className="card">
      <div className="actions" style={{ justifyContent: 'space-between' }}>
        <h2>Notifications</h2>
        {unread > 0 && <button className="small secondary" onClick={markRead}>Mark all as read</button>}
      </div>
      {data && data.length === 0 && <Empty>No notifications yet.</Empty>}
      <table><tbody>
        {(data || []).map((n) => (
          <tr key={n._id} style={n.read ? {} : { background: '#f3f7ff' }}>
            <td>{!n.read && <strong>• </strong>}{n.message}<div className="muted">{n.type} via {n.emailStatus === 'sent' ? 'in-app + email' : 'in-app'} - {when(n.createdAt)}</div></td>
          </tr>
        ))}
      </tbody></table>
    </div>
  );
}
