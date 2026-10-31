function DoctorAppointments() {
  const { data } = useApi('/appointments/doctor');
  return (
    <div className="card">
      <h2>Upcoming Appointments</h2>
      <p className="muted">Confirmed (paid) bookings with you. Unpaid holds and cancelled bookings are not shown.</p>
      {data && data.length === 0 && <Empty>No confirmed appointments yet.</Empty>}
      <div className="table-wrap">
        <table>
          {data && data.length > 0 && <thead><tr><th>Slot</th><th>Patient</th><th>Clinic</th><th>Status</th></tr></thead>}
          <tbody>
            {(data || []).map((a) => (
              <tr key={a._id}><td>{a.slot}</td><td>{a.patientName}</td><td>{a.clinicName}</td><td><Badge value={a.status} /> <Badge value={a.paymentStatus} /></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecordEditor({ record, onSaved }) {
  const [notes, setNotes] = useState(record.notes || '');
  const [meds, setMeds] = useState(record.prescription?.length ? record.prescription : [{ medication: '', dosage: '' }]);
  const [busy, setBusy] = useState(false);
  const setMed = (i, k, v) => setMeds(meds.map((m, j) => (j === i ? { ...m, [k]: v } : m)));

  async function save() {
    if (!notes.trim()) return toast('Enter consultation notes before completing this record.', 'err');
    setBusy(true);
    try {
      await api(`/records/${record._id}`, { method: 'PUT', body: { notes, prescription: meds.filter((m) => m.medication.trim()) } });
      toast('Record completed and prescription digitally signed.');
      onSaved();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <label>Consultation notes</label>
      <textarea rows="3" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <label>Prescription</label>
      {meds.map((m, i) => (
        <div className="row" key={i}>
          <div><input placeholder="Medication" value={m.medication} onChange={(e) => setMed(i, 'medication', e.target.value)} /></div>
          <div><input placeholder="Dosage e.g. 1 tab twice daily" value={m.dosage} onChange={(e) => setMed(i, 'dosage', e.target.value)} /></div>
          {meds.length > 1 && <div style={{ flex: '0 0 auto', minWidth: 0 }}><button type="button" className="small secondary" style={{ marginTop: 8 }} onClick={() => setMeds(meds.filter((_, j) => j !== i))}>Remove</button></div>}
        </div>
      ))}
      <div className="actions">
        <button type="button" className="small secondary" onClick={() => setMeds([...meds, { medication: '', dosage: '' }])}>+ Add medication</button>
        <button type="button" disabled={busy} onClick={save}>{busy ? 'Saving...' : record.status === 'completed' ? 'Update & re-sign' : 'Complete & sign record'}</button>
      </div>
    </div>
  );
}

function HistoryModal({ record, onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => { api(`/records/patient/${record.patientId}`).then(setData).catch((e) => { toastError(e); onClose(); }); }, []);
  return (
    <Modal title={`Medical history - ${record.patientName}`} onClose={onClose}>
      <p className="muted">Completed visits across all doctors. This access is recorded in the audit log.</p>
      {!data ? <p>Loading...</p> : data.records.length === 0 ? <Empty>No completed visits yet.</Empty> : data.records.map((r) => (
        <div className="item" key={r._id}><strong>{r.doctorName}</strong> <RecordBody r={r} /></div>
      ))}
      <button className="secondary" onClick={onClose}>Close</button>
    </Modal>
  );
}

function DoctorRecords() {
  const { data, reload } = useApi('/records/doctor', 8000);
  const [editing, setEditing] = useState(null);
  const [history, setHistory] = useState(null);
  return (
    <div className="card">
      <h2>Consultation Records</h2>
      <p className="muted">A record is created automatically (via events) when a patient's booking is confirmed. Complete it after the in-clinic visit - the prescription is digitally signed.</p>
      {data && data.length === 0 && <Empty>No records yet.</Empty>}
      {(data || []).map((r) => (
        <div className="item" key={r._id}>
          <h3>{r.patientName} <Badge value={r.status} /></h3>
          {r.status === 'completed' && editing !== r._id ? <RecordBody r={r} /> : <div className="muted">Visit: {r.visitDate} at {r.clinicName}</div>}
          {(r.status === 'pending' || editing === r._id) && <RecordEditor record={r} onSaved={() => { setEditing(null); reload(); }} />}
          <div className="actions" style={{ marginTop: 8 }}>
            <button className="small secondary" onClick={() => setHistory(r)}>Patient history</button>
            {r.status === 'completed' && editing !== r._id && <button className="small secondary" onClick={() => setEditing(r._id)}>Edit</button>}
            <PrescriptionActions record={r} />
          </div>
        </div>
      ))}
      {history && <HistoryModal record={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

function DoctorSchedule() {
  const { data: profile, error, reload } = useApi('/doctors/me', 15000);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const [form, setForm] = useState({ date: tomorrow, time: '09:00' });

  async function add(e) {
    e.preventDefault();
    try {
      await api('/doctors/me/slots', { method: 'POST', body: { slot: `${form.date} ${form.time}` } });
      toast(`Slot ${form.date} ${form.time} published.`);
      reload();
    } catch (err) { toastError(err); }
  }

  async function remove(slot) {
    try {
      await api(`/doctors/me/slots/${encodeURIComponent(slot)}`, { method: 'DELETE' });
      toast(`Slot ${slot} withdrawn.`);
      reload();
    } catch (err) { toastError(err); }
  }

  if (error) return <div className="card"><h2>My Schedule</h2><div className="msg err">{error}</div></div>;
  if (!profile) return <div className="card"><h2>My Schedule</h2><p>Loading...</p></div>;
  return (
    <div className="card">
      <h2>My Schedule</h2>
      <p className="muted">{profile.speciality} at {profile.clinicName} ({profile.location}) &nbsp;|&nbsp; Fee {money(profile.fee)} &nbsp;|&nbsp; <Stars value={profile.rating} /> &nbsp; <Badge value={profile.status} /></p>
      <form className="row" onSubmit={add}>
        <div><label>Date</label><input type="date" min={tomorrow} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required /></div>
        <div><label>Time</label><input type="time" step="1800" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} required /></div>
        <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 12 }}><button type="submit" disabled={profile.status !== 'active'}>Publish slot</button></div>
      </form>
      <h3 style={{ color: 'var(--navy)' }}>Free slots patients can book</h3>
      {profile.availableSlots.length === 0 && <Empty>No free upcoming slots. Publish some above.</Empty>}
      {groupByDay(profile.availableSlots).map(([day, slots]) => (
        <div className="day" key={day}><span className="muted" style={{ display: 'inline-block', width: 100 }}>{dayLabel(day)}</span>
          {slots.map((s) => <button key={s} className="slot secondary small" title="Withdraw this slot" onClick={() => remove(s)}>{s.slice(11)} ✕</button>)}
        </div>
      ))}
    </div>
  );
}
