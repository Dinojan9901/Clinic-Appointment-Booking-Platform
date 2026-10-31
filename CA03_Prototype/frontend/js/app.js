const TABS = {
  patient: [
    ['find', 'Find a Doctor', FindDoctor],
    ['appts', 'My Appointments', MyAppointments],
    ['records', 'My Records', MyRecords],
    ['payments', 'Payments', MyPayments],
    ['notif', 'Notifications', Notifications],
  ],
  doctor: [
    ['appts', 'Appointments', DoctorAppointments],
    ['records', 'Consultation Records', DoctorRecords],
    ['schedule', 'My Schedule', DoctorSchedule],
    ['notif', 'Notifications', Notifications],
  ],
  admin: [
    ['dash', 'Dashboard', AdminDashboard],
    ['doctors', 'Doctor Verification', DoctorApprovals],
    ['users', 'Users', UsersAdmin],
    ['clinics', 'Clinics', ClinicsAdmin],
    ['payments', 'Payments', PaymentsAdmin],
    ['activity', 'Activity Log', ActivityAdmin],
  ],
};

function UnreadDot({ refreshKey }) {
  const [n, setN] = useState(0);
  usePoll(() => api('/notifications/mine').then((list) => setN(list.filter((x) => !x.read).length)).catch(() => {}), 8000, [refreshKey]);
  return n > 0 ? <span className="dot">{n}</span> : null;
}

function App() {
  const [user, setUser] = useState(session.token ? session.user : null);
  const [tab, setTab] = useState(null);
  const [readKey, setReadKey] = useState(0);

  useEffect(() => {
    const onLogout = (e) => { session.clear(); setUser(null); if (e.detail) toast(e.detail, 'err'); };
    bus.addEventListener('logout', onLogout);
    return () => bus.removeEventListener('logout', onLogout);
  }, []);

  const verify = window.location.pathname.match(/^\/verify\/([^/]+)$/);
  if (verify) return <><Toaster /><VerifyPrescription code={decodeURIComponent(verify[1])} /></>;

  if (!user) {
    return <><Toaster /><AuthView onLogin={(t, u) => { session.save(t, u); setUser(u); setTab(null); }} /></>;
  }

  const tabs = TABS[user.role] || TABS.patient;
  const current = tabs.find(([k]) => k === tab) || tabs[0];
  const View = current[2];
  return (
    <div>
      <Toaster />
      <header>
        <h1>MediConnect</h1>
        <div className="who">
          <span>{user.name} <span style={{ color: '#cdd8ea' }}>({user.role})</span></span>
          <button className="secondary small" onClick={() => emit('logout')}>Logout</button>
        </div>
      </header>
      <div className="container">
        <div className="nav">
          {tabs.map(([k, label]) => (
            <button key={k} className={current[0] === k ? 'active' : ''} onClick={() => setTab(k)}>
              {label} {k === 'notif' && <UnreadDot refreshKey={readKey} />}
            </button>
          ))}
        </div>
        <View key={current[0]} onRead={() => setReadKey((n) => n + 1)} />
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
