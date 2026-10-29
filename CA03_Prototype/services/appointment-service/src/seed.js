/**
 * Seeds demo clinics and doctors. Seeded doctors are topped up with slots for
 * the next few days on every start, so the demo always has bookable times.
 * Emails match the doctor login accounts seeded by the Auth Service.
 */
const { Clinic, Doctor, Appointment } = require('./models');
const { dateToSlot, slotToDate } = require('../common/service');

const CLINICS = [
  { name: 'HeartCare Clinic', address: '12 Galle Road, Colombo 03', location: 'Colombo', phone: '011 234 5678' },
  { name: 'SkinHealth Center', address: '45 Temple Road, Jaffna', location: 'Jaffna', phone: '021 222 3344' },
  { name: 'LittleOnes Clinic', address: '8 Main Street, Kandy', location: 'Kandy', phone: '081 223 4455' },
  { name: 'City Heart Institute', address: '90 Lake Road, Kandy', location: 'Kandy', phone: '081 220 9988' },
];

const DOCTORS = [
  { name: 'Dr. Anushka Perera', email: 'anushka.perera@mediconnect.lk', licenseNo: 'SLMC-10231', speciality: 'Cardiology', clinic: 'HeartCare Clinic', fee: 3500, times: ['09:00', '09:30', '10:00'] },
  { name: 'Dr. Suresh Kumar', email: 'suresh.kumar@mediconnect.lk', licenseNo: 'SLMC-11874', speciality: 'Dermatology', clinic: 'SkinHealth Center', fee: 2500, times: ['14:00', '14:30', '15:00'] },
  { name: 'Dr. Fathima Nazeer', email: 'fathima.nazeer@mediconnect.lk', licenseNo: 'SLMC-12509', speciality: 'Pediatrics', clinic: 'LittleOnes Clinic', fee: 3000, times: ['11:00', '11:30'] },
  { name: 'Dr. Rajitha Silva', email: 'rajitha.silva@mediconnect.lk', licenseNo: 'SLMC-13066', speciality: 'Cardiology', clinic: 'City Heart Institute', fee: 4000, times: ['08:30', '09:00', '09:30'] },
];

const DAYS_AHEAD = 5;

function upcomingSlots(times) {
  const today = dateToSlot(new Date()).slice(0, 10);
  const slots = [];
  for (let d = 1; d <= DAYS_AHEAD; d++) {
    const day = new Date(`${today}T00:00:00+05:30`);
    day.setUTCDate(day.getUTCDate() + d);
    const date = dateToSlot(day).slice(0, 10);
    for (const t of times) slots.push(`${date} ${t}`);
  }
  return slots;
}

async function quietly(op) {
  try {
    await op();
  } catch (err) {
    if (err.code !== 11000) throw err;
  }
}

async function seedDoctors() {
  await Promise.all([Clinic.init(), Doctor.init()]);
  for (const c of CLINICS) await quietly(() => Clinic.updateOne({ name: c.name }, { $setOnInsert: c }, { upsert: true }));
  const clinics = Object.fromEntries((await Clinic.find()).map((c) => [c.name, c]));

  for (const { clinic: clinicName, times, ...d } of DOCTORS) {
    const clinic = clinics[clinicName];
    await quietly(() =>
      Doctor.updateOne(
        { email: d.email },
        {
          $set: { clinicId: clinic._id.toString() },
          $setOnInsert: {
            name: d.name,
            licenseNo: d.licenseNo,
            speciality: d.speciality,
            fee: d.fee,
            clinicName: clinic.name,
            clinicAddress: clinic.address,
            location: clinic.location,
            status: 'active',
            availableSlots: [],
          },
        },
        { upsert: true }
      )
    );
    const doctor = await Doctor.findOne({ email: d.email });
    const now = Date.now();
    if (doctor.availableSlots.some((s) => (slotToDate(s)?.getTime() || 0) > now)) continue;
    const taken = await Appointment.distinct('slot', { doctorId: doctor._id.toString(), status: { $in: ['pending_payment', 'booked', 'completed'] } });
    const fresh = upcomingSlots(times).filter((s) => !taken.includes(s));
    await Doctor.updateOne({ _id: doctor._id }, { $addToSet: { availableSlots: { $each: fresh } } });
  }
  console.log(`[appointment-service] ${CLINICS.length} clinics and ${DOCTORS.length} demo doctors ready`);
}

module.exports = seedDoctors;
