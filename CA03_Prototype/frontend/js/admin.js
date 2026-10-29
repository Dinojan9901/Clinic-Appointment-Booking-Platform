function AdminDashboard() {
  const { data: s } = useApi('/admin/stats', 8000);
  const { data: health } = useApi('/admin/health', 8000);
  const tile = (k, v) => <div className="tile" key={k}><div className="v">{v}</div><div className="k">{k}</div></div>;
  return (
    <>
      <div className="card">
        <h2>Platform overview</h2>
        {!s ? <p>Loading...</p> : (
          <div className="tiles">
            {tile('Patients registered', s.patientsRegistered)}
            {tile('Doctor sign-ups', s.doctorSignups)}
            {tile('Doctors verified', s.doctorsVerified)}
            {tile('Bookings confirmed', s.bookingsConfirmed)}
            {tile('Cancellations', s.cancellations)}
            {tile('Expired holds', s.expiredHolds)}
            {tile('Reschedules', s.reschedules)}
            {tile('Records completed', s.recordsCompleted)}
            {tile('Reviews', s.reviews)}
            {tile('Payments declined', s.paymentsFailed)}
            {tile('Net revenue', money(s.revenue.net))}
            {tile('Events (24h)', s.eventsLast24h)}
          </div>
        )}
        <p className="muted">Built by the Admin Service from the event stream (every domain event is consumed into an audit log).</p>
      </div>
      <div className="card">
        <h2>Service health</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Service</th><th>Status</th><th>Instance</th><th>Database</th><th>Latency</th></tr></thead>
          <tbody>
            {(health || []).map((h) => (
              <tr key={h.service}><td>{h.service}</td><td><Badge value={h.status} /></td><td className="muted">{h.instance || '-'}</td><td>{h.db ? <Badge value={h.db} /> : '-'}</td><td>{h.latencyMs != null ? `${h.latencyMs} ms` : '-'}</td></tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </>
  );
}

function DoctorApprovals() {
  const [status, setStatus] = useState('pending');
  const { data, reload } = useApi(`/auth/doctors?status=${status}`, 8000);
  async function decide(d, approve) {
    const reason = approve ? '' : prompt(`Reason for rejecting ${d.name}?`, 'Licence could not be verified');
    if (!approve && reason === null) return;
    try {
      await api(`/auth/doctors/${d._id}/${approve ? 'approve' : 'reject'}`, { method: 'POST', body: { reason } });
      toast(`${d.name} ${approve ? 'verified - they can now log in and publish slots' : 'rejected'}.`);
      reload();
    } catch (e) { toastError(e); }
  }
  return (
    <div className="card">
      <h2>Doctor verification</h2>
      <div className="nav">{['pending', 'approved', 'rejected'].map((s) => <button key={s} className={status === s ? 'active' : ''} onClick={() => setStatus(s)}>{s}</button>)}</div>
      {data && data.length === 0 && <Empty>No {status} doctors.</Empty>}
      {(data || []).map((d) => (
        <div className="item" key={d._id}>
          <h3>{d.name} <Badge value={d.doctorStatus} /></h3>
          <div className="muted">{d.email} &nbsp;|&nbsp; Licence <strong>{d.doctorProfile?.licenseNo}</strong> &nbsp;|&nbsp; {d.doctorProfile?.speciality} at {d.doctorProfile?.clinicName} &nbsp;|&nbsp; Fee {money(d.doctorProfile?.fee)}</div>
          <div className="muted">Registered {when(d.createdAt)}{d.rejectionReason && ` - reason: ${d.rejectionReason}`}</div>
          {d.doctorStatus === 'pending' && (
            <div className="actions" style={{ marginTop: 8 }}>
              <button className="small ok" onClick={() => decide(d, true)}>Verify & approve</button>
              <button className="small danger" onClick={() => decide(d, false)}>Reject</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function UsersAdmin() {
  const [role, setRole] = useState('');
  const [q, setQ] = useState('');
  const { data, reload } = useApi(`/auth/users?role=${role}&q=${encodeURIComponent(q)}`, 15000);
  async function toggle(u) {
    if (!confirm(`${u.active ? 'Disable' : 'Enable'} ${u.name}?`)) return;
    try {
      await api(`/auth/users/${u._id}/status`, { method: 'PATCH', body: { active: !u.active } });
      toast(`${u.name} ${u.active ? 'disabled' : 'enabled'}.`);
      reload();
    } catch (e) { toastError(e); }
  }
  return (
    <div className="card">
      <h2>Users</h2>
      <div className="row">
        <div><label>Role</label><select value={role} onChange={(e) => setRole(e.target.value)}><option value="">All</option><option value="patient">Patients</option><option value="doctor">Doctors</option><option value="admin">Admins</option></select></div>
        <div><label>Search</label><input value={q} placeholder="name or email" onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {(data || []).map((u) => (
            <tr key={u._id}>
              <td>{u.name}</td><td>{u.email}</td><td>{u.role}{u.doctorStatus && <> <Badge value={u.doctorStatus} /></>}</td>
              <td><Badge value={u.active ? 'active' : 'disabled'} /></td>
              <td>{u.role !== 'admin' && <button className={'small ' + (u.active ? 'danger' : 'ok')} onClick={() => toggle(u)}>{u.active ? 'Disable' : 'Enable'}</button>}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <p className="muted">Disabling a doctor also hides them from patient search (via the user.status_changed event).</p>
    </div>
  );
}

function ClinicsAdmin() {
  const { data, reload } = useApi('/clinics?all=1', 30000);
  const blank = { name: '', address: '', location: '', phone: '' };
  const [form, setForm] = useState(blank);
  const [editId, setEditId] = useState(null);
  async function save(e) {
    e.preventDefault();
    try {
      if (editId) await api(`/clinics/${editId}`, { method: 'PUT', body: form });
      else await api('/clinics', { method: 'POST', body: form });
      toast(`Clinic ${editId ? 'updated' : 'added'}.`);
      setForm(blank); setEditId(null); reload();
    } catch (err) { toastError(err); }
  }
  async function toggle(c) {
    try { await api(`/clinics/${c._id}`, { method: 'PUT', body: { active: !c.active } }); reload(); } catch (err) { toastError(err); }
  }
  const f = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="card">
      <h2>Clinics</h2>
      <form onSubmit={save}>
        <div className="row">
          <div><label>Name</label><input value={form.name} onChange={f('name')} required /></div>
          <div><label>City / town</label><input value={form.location} onChange={f('location')} required /></div>
        </div>
        <div className="row">
          <div><label>Address</label><input value={form.address} onChange={f('address')} required /></div>
          <div><label>Phone</label><input value={form.phone} onChange={f('phone')} /></div>
        </div>
        <div className="actions"><button type="submit">{editId ? 'Save changes' : 'Add clinic'}</button>{editId && <button type="button" className="secondary" onClick={() => { setEditId(null); setForm(blank); }}>Cancel</button>}</div>
      </form>
      <div className="table-wrap" style={{ marginTop: 12 }}><table>
        <thead><tr><th>Clinic</th><th>Location</th><th>Phone</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {(data || []).map((c) => (
            <tr key={c._id}>
              <td>{c.name}<div className="muted">{c.address}</div></td><td>{c.location}</td><td>{c.phone}</td>
              <td><Badge value={c.active ? 'active' : 'disabled'} /></td>
              <td className="actions"><button className="small secondary" onClick={() => { setEditId(c._id); setForm({ name: c.name, address: c.address, location: c.location, phone: c.phone || '' }); }}>Edit</button>
                <button className="small secondary" onClick={() => toggle(c)}>{c.active ? 'Deactivate' : 'Activate'}</button></td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

function PaymentsAdmin() {
  const { data } = useApi('/payments', 10000);
  return (
    <div className="card">
      <h2>Payments</h2>
      {data && (
        <div className="tiles">
          <div className="tile"><div className="v">{money(data.totals.collected)}</div><div className="k">Collected</div></div>
          <div className="tile"><div className="v">{money(data.totals.refunded)}</div><div className="k">Refunded</div></div>
          <div className="tile"><div className="v">{money(data.totals.net)}</div><div className="k">Net</div></div>
          <div className="tile"><div className="v">{data.totals.failed}</div><div className="k">Declined attempts</div></div>
        </div>
      )}
      <div className="table-wrap"><table>
        <thead><tr><th>Date</th><th>Patient</th><th>Doctor / slot</th><th>Amount</th><th>Status</th><th>Receipt</th></tr></thead>
        <tbody>
          {(data?.payments || []).map((p) => (
            <tr key={p._id}>
              <td>{when(p.createdAt)}</td><td>{p.patientName}</td><td>{p.doctorName}<div className="muted">{p.slot}</div></td>
              <td>{money(p.amount, p.currency)}</td><td><Badge value={p.status} />{p.refundReason && <div className="muted">{p.refundReason}</div>}</td>
              <td>{p.receiptNo && ['succeeded', 'refunded'].includes(p.status) ? <a href="#" onClick={(e) => { e.preventDefault(); download(`/payments/${p._id}/receipt`, `${p.receiptNo}.pdf`).catch(toastError); }}>{p.receiptNo}</a> : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

function ActivityAdmin() {
  const [type, setType] = useState('');
  const { data } = useApi(`/admin/activity?limit=150&type=${type}`, 5000);
  const types = ['', 'appointment', 'payment', 'doctor', 'user', 'record', 'ehr', 'review'];
  return (
    <div className="card">
      <h2>Activity & audit log</h2>
      <div className="nav">{types.map((t) => <button key={t} className={type === t ? 'active' : ''} onClick={() => setType(t)}>{t || 'all'}</button>)}</div>
      <div className="table-wrap"><table>
        <thead><tr><th>When</th><th>Event</th><th>What happened</th><th>By</th></tr></thead>
        <tbody>
          {(data || []).map((a) => (
            <tr key={a._id}><td className="muted">{when(a.occurredAt)}</td><td><code>{a.type}</code></td><td>{a.summary}</td><td className="muted">{a.actor}</td></tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}
