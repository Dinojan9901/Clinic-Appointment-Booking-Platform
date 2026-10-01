/**
 * Seeds demo doctor accounts.
 * Doctors cannot self-register (that would let anyone grant themselves
 * clinical access); in a real deployment the clinic/admin onboards them.
 * The emails match the doctor profiles seeded by the Appointment Service -
 * email is the business key that links a login to a doctor profile.
 */
const bcrypt = require('bcryptjs');
const User = require('./model');

const DEMO_DOCTOR_PASSWORD = 'doctor123';
const DEMO_DOCTORS = [
  { name: 'Dr. Anushka Perera', email: 'anushka.perera@mediconnect.lk' },
  { name: 'Dr. Suresh Kumar', email: 'suresh.kumar@mediconnect.lk' },
  { name: 'Dr. Fathima Nazeer', email: 'fathima.nazeer@mediconnect.lk' },
  { name: 'Dr. Rajitha Silva', email: 'rajitha.silva@mediconnect.lk' },
];

async function seedDoctorAccounts() {
  const passwordHash = await bcrypt.hash(DEMO_DOCTOR_PASSWORD, 10);
  for (const d of DEMO_DOCTORS) {
    await User.updateOne(
      { email: d.email },
      { $setOnInsert: { ...d, passwordHash, role: 'doctor' } },
      { upsert: true }
    );
  }
  console.log(`[auth-service] demo doctor accounts ready (password: ${DEMO_DOCTOR_PASSWORD})`);
}

module.exports = seedDoctorAccounts;
