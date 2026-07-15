/** Seeds demo doctors/clinics so the search returns results on first run. */
const { Doctor } = require('./models');

const SAMPLE = [
  {
    name: 'Dr. Anushka Perera',
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
  const count = await Doctor.countDocuments();
  if (count > 0) {
    console.log(`[appointment-service] doctors already seeded (${count})`);
    return;
  }
  await Doctor.insertMany(SAMPLE);
  console.log(`[appointment-service] seeded ${SAMPLE.length} demo doctors`);
}

module.exports = seedDoctors;
