function AuthView({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '', licenseNo: '', speciality: '', clinicId: '', fee: '' });
  const [clinics, setClinics] = useState([]);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  useEffect(() => {
    if (mode === 'doctor' && !clinics.length) api('/clinics', { auth: false }).then(setClinics).catch(() => setMsg({ type: 'err', text: 'Could not load clinics.' }));
  }, [mode]);

  async function submit(e) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      if (mode === 'doctor') {
        await api('/auth/register-doctor', { method: 'POST', auth: false, body: { ...form, fee: Number(form.fee) } });
        setMsg({ type: 'ok', text: 'Registration received. An administrator will verify your licence - you can log in once you are approved (check the email inbox).' });
        setMode('login');
        return;
      }
      if (mode === 'register') {
        await api('/auth/register', { method: 'POST', auth: false, body: { name: form.name, email: form.email, password: form.password } });
      }
      const data = await api('/auth/login', { method: 'POST', auth: false, body: { email: form.email, password: form.password } });
      onLogin(data.token, data.user);
    } catch (err) {
      setMsg({ type: 'err', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const tab = (k, label) => <button type="button" className={mode === k ? 'active' : ''} onClick={() => { setMode(k); setMsg(null); }}>{label}</button>;

  return (
    <div className="container" style={{ maxWidth: 460 }}>
      <div className="title">
        <h1>MediConnect</h1>
        <p className="muted">Clinic Appointment Booking Platform</p>
      </div>
      <div className="card">
        <div className="nav">{tab('login', 'Login')}{tab('register', 'Register as patient')}{tab('doctor', 'Join as doctor')}</div>
        {msg && <div className={'msg ' + msg.type}>{msg.text}</div>}
        <form onSubmit={submit}>
          {mode !== 'login' && (<><label>Full name</label><input value={form.name} onChange={set('name')} required /></>)}
          <label>Email</label>
          <input type="email" value={form.email} onChange={set('email')} required />
          <label>Password</label>
          <input type="password" value={form.password} onChange={set('password')} minLength={mode === 'login' ? undefined : 6} required />
          {mode === 'doctor' && (
            <>
              <div className="row">
                <div><label>SLMC licence no.</label><input value={form.licenseNo} onChange={set('licenseNo')} placeholder="SLMC-12345" required /></div>
                <div><label>Speciality</label><input value={form.speciality} onChange={set('speciality')} placeholder="e.g. Neurology" required /></div>
              </div>
              <div className="row">
                <div>
                  <label>Clinic</label>
                  <select value={form.clinicId} onChange={set('clinicId')} required>
                    <option value="">Select a clinic</option>
                    {clinics.map((c) => <option key={c._id} value={c._id}>{c.name} ({c.location})</option>)}
                  </select>
                </div>
                <div><label>Consultation fee (LKR)</label><input type="number" min="1" value={form.fee} onChange={set('fee')} required /></div>
              </div>
              <p className="muted" style={{ marginTop: 0 }}>Doctor accounts are activated after an administrator verifies the licence.</p>
            </>
          )}
          <button type="submit" disabled={busy}>{busy ? 'Please wait...' : mode === 'login' ? 'Login' : mode === 'doctor' ? 'Submit for verification' : 'Create account'}</button>
        </form>
      </div>
      {mode === 'login' && (
        <div className="card muted">
          <strong>Demo accounts</strong><br />
          Admin: <code>admin@mediconnect.lk</code> / <code>admin123</code><br />
          Doctors (password <code>doctor123</code>): anushka.perera@, suresh.kumar@, fathima.nazeer@, rajitha.silva@ <code>mediconnect.lk</code><br />
          Patients: register a new account.
        </div>
      )}
    </div>
  );
}

function VerifyPrescription({ code }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    api(`/prescriptions/verify/${encodeURIComponent(code)}`, { auth: false })
      .then((d) => setState({ data: d }))
      .catch((e) => setState({ error: e.message }));
  }, [code]);
  const d = state.data;
  return (
    <div className="container" style={{ maxWidth: 560 }}>
      <div className="title"><h1>MediConnect</h1><p className="muted">Prescription verification (for pharmacies)</p></div>
      <div className="card">
        {state.loading && <p>Checking signature...</p>}
        {state.error && <div className="msg err">Prescription {code} was not found.</div>}
        {d && (
          <>
            <div className={'msg ' + (d.valid ? 'ok' : 'err')}>
              {d.valid ? `Valid prescription - digital signature verified (${d.algorithm}).` : 'INVALID - the signature does not match. Do not dispense.'}
            </div>
            <p><strong>{d.code}</strong> issued {when(d.issuedAt)}</p>
            <p>Doctor: {d.doctorName} - {d.clinicName}<br />Patient: {d.patient} &nbsp; Visit: {d.visitDate}</p>
            <strong>Medication</strong>
            {d.medications.length ? <ul>{d.medications.map((m, i) => <li key={i}>{m.medication}{m.dosage && ` - ${m.dosage}`}</li>)}</ul> : <p className="muted">None</p>}
          </>
        )}
        <a href="/">Back to MediConnect</a>
      </div>
    </div>
  );
}
