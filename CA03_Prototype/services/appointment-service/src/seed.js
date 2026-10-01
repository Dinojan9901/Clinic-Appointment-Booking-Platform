/**
 * Seeds demo doctors/clinics so the search returns results on first run.
 * Emails match the doctor login accounts seeded by the Auth Service.
 */
const { Doctor } = require('./models');

const SAMPLE = [
  {
    name: 'Dr. Anushka Perera',
    email: 'anushka.perera@mediconnect.lk',
    speciality: 'Cardiology',
    clinicName: 'HeartCare Clinic',
    clinicAddress: '12 Galle Road, Colombo 03',
    location: 'Colombo',
    fee: 3500,
    rating: 4.7,
    availableSlots: ['2026-07-20 09:00', '2026-07-20 09:30', '2026-07-20 10:00'],
  },
  {
    name: 'Dr. Suresh Kumar',
    email: 'suresh.kumar@mediconnect.lk',
    speciality: 'Dermatology',
    clinicName: 'SkinHealth Center',
    clinicAddress: '45 Temple Road, Jaffna',
    location: 'Jaffna',
    fee: 2500,
    rating: 4.5,
    availableSlots: ['2026-07-21 14:00', '2026-07-21 14:30', '2026-07-21 15:00'],
  },
  {
    name: 'Dr. Fathima Nazeer',
    email: 'fathima.nazeer@mediconnect.lk',
    speciality: 'Pediatrics',
    clinicName: 'LittleOnes Clinic',
    clinicAddress: '8 Main Street, Kandy',
    location: 'Kandy',
    fee: 3000,
    rating: 4.8,
    availableSlots: ['2026-07-22 11:00', '2026-07-22 11:30'],
  },
  {
    name: 'Dr. Rajitha Silva',
    email: 'rajitha.silva@mediconnect.lk',
    speciality: 'Cardiology',
    clinicName: 'City Heart Institute',
    clinicAddress: '90 Lake Road, Kandy',
    location: 'Kandy',
    fee: 4000,
    rating: 4.6,
    availableSlots: ['2026-07-23 08:30', '2026-07-23 09:00', '2026-07-23 09:30'],
  },
];

async function seedDoctors() {
  // Upsert by name so existing databases also get the doctor email (the key
  // that links a profile to the doctor's login) without re-seeding slots.
  for (const { email, ...profile } of SAMPLE) {
    await Doctor.updateOne(
      { name: profile.name },
      { $set: { email }, $setOnInsert: profile },
      { upsert: true }
    );
  }
  console.log(`[appointment-service] ${SAMPLE.length} demo doctors ready`);
}

module.exports = seedDoctors;
