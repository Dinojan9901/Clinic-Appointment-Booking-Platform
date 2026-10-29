/**
 * Seeds the platform administrator and four verified demo doctors.
 * Doctor emails match the profiles seeded by the Appointment Service.
 */
const bcrypt = require('bcryptjs');
const User = require('./model');

const ADMIN = { name: 'Platform Admin', email: 'admin@mediconnect.lk', password: 'admin123' };
const DEMO_DOCTOR_PASSWORD = 'doctor123';
const DEMO_DOCTORS = [
  { name: 'Dr. Anushka Perera', email: 'anushka.perera@mediconnect.lk', licenseNo: 'SLMC-10231', speciality: 'Cardiology', clinicName: 'HeartCare Clinic', fee: 3500 },
  { name: 'Dr. Suresh Kumar', email: 'suresh.kumar@mediconnect.lk', licenseNo: 'SLMC-11874', speciality: 'Dermatology', clinicName: 'SkinHealth Center', fee: 2500 },
  { name: 'Dr. Fathima Nazeer', email: 'fathima.nazeer@mediconnect.lk', licenseNo: 'SLMC-12509', speciality: 'Pediatrics', clinicName: 'LittleOnes Clinic', fee: 3000 },
  { name: 'Dr. Rajitha Silva', email: 'rajitha.silva@mediconnect.lk', licenseNo: 'SLMC-13066', speciality: 'Cardiology', clinicName: 'City Heart Institute', fee: 4000 },
];

async function upsert(filter, doc) {
  try {
    await User.updateOne(filter, { $setOnInsert: doc }, { upsert: true });
  } catch (err) {
    if (err.code !== 11000) throw err;
  }
}

async function seedAccounts() {
  await User.init();
  await upsert(
    { email: ADMIN.email },
    { name: ADMIN.name, email: ADMIN.email, role: 'admin', active: true, passwordHash: await bcrypt.hash(ADMIN.password, 10) }
  );
  const passwordHash = await bcrypt.hash(DEMO_DOCTOR_PASSWORD, 10);
  for (const { name, email, ...profile } of DEMO_DOCTORS) {
    await upsert(
      { email },
      { name, email, passwordHash, role: 'doctor', active: true, doctorStatus: 'approved', doctorProfile: profile }
    );
  }
  console.log(`[auth-service] admin (${ADMIN.email} / ${ADMIN.password}) and demo doctors (password: ${DEMO_DOCTOR_PASSWORD}) ready`);
}

module.exports = seedAccounts;
