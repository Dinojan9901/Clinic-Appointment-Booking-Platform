/**
 * Messaging layer: the Appointment Service's side of the booking Saga and
 * the doctor lifecycle.
 *  payment.succeeded  -> pending_payment -> booked (emits appointment.booked);
 *                        if the hold already ended, emits appointment.payment_rejected
 *                        so the Payment Service refunds (compensation).
 *  payment.failed     -> keeps the hold so the patient can retry.
 *  hold timeout       -> expired + slot released (compensation, emits appointment.expired).
 *  doctor.* / user.status_changed -> doctor profile status.
 */
const { Appointment, Doctor, Clinic } = require('./models');
const { invalidate } = require('./cache');
const { outboxEvent } = require('../common/messaging');
const { eventPayload, releaseSlot } = require('./appointments');

const SWEEP_INTERVAL_MS = 15000;

async function onPaymentSucceeded(evt) {
  const appt = await Appointment.findById(evt.appointmentId);
  if (!appt || appt.paymentId === evt.paymentId) return;
  const booked = await Appointment.findOneAndUpdate(
    { _id: appt._id, status: 'pending_payment' },
    {
      $set: { status: 'booked', paymentStatus: 'paid', paymentId: evt.paymentId, receiptNo: evt.receiptNo },
      $unset: { holdExpiresAt: 1 },
      $push: { pendingEvents: outboxEvent('appointment.booked', eventPayload(appt, { receiptNo: evt.receiptNo })) },
    }
  );
  if (booked) return;
  const current = await Appointment.findById(appt._id);
  if (current.paymentId === evt.paymentId) return;
  await Appointment.updateOne(
    { _id: appt._id, rejectedPaymentIds: { $ne: evt.paymentId } },
    {
      $addToSet: { rejectedPaymentIds: evt.paymentId },
      $push: {
        pendingEvents: outboxEvent('appointment.payment_rejected', eventPayload(current, { paymentId: evt.paymentId, reason: `appointment is ${current.status}` })),
      },
    }
  );
}

async function onPaymentFailed(evt) {
  await Appointment.updateOne({ _id: evt.appointmentId, status: 'pending_payment' }, { $set: { paymentStatus: 'failed' } });
}

async function onDoctorRegistered(evt) {
  const clinic = await Clinic.findById(evt.clinicId).catch(() => null);
  await Doctor.updateOne(
    { email: evt.email },
    {
      $setOnInsert: {
        name: evt.name,
        email: evt.email,
        userId: evt.userId,
        licenseNo: evt.licenseNo,
        speciality: evt.speciality,
        clinicId: evt.clinicId,
        clinicName: clinic?.name || 'Unknown clinic',
        clinicAddress: clinic?.address || '-',
        location: clinic?.location || '-',
        fee: evt.fee,
        status: 'pending',
        availableSlots: [],
      },
    },
    { upsert: true }
  );
}

async function setDoctorStatus(email, from, to) {
  const res = await Doctor.updateOne({ email, status: { $in: from } }, { $set: { status: to } });
  if (res.modifiedCount) await invalidate('doctors');
}

const handlers = {
  'payment.succeeded': onPaymentSucceeded,
  'payment.failed': onPaymentFailed,
  'doctor.registered': onDoctorRegistered,
  'doctor.approved': (evt) => setDoctorStatus(evt.email, ['pending'], 'active'),
  'doctor.rejected': (evt) => setDoctorStatus(evt.email, ['pending'], 'rejected'),
  'user.status_changed': (evt) =>
    evt.role === 'doctor'
      ? setDoctorStatus(evt.email, evt.active ? ['suspended'] : ['active'], evt.active ? 'active' : 'suspended')
      : null,
};

async function expireHolds(kick) {
  const due = await Appointment.find({ status: 'pending_payment', holdExpiresAt: { $lt: new Date() } }).limit(50);
  for (const appt of due) {
    const expired = await Appointment.findOneAndUpdate(
      { _id: appt._id, status: 'pending_payment' },
      {
        $set: { status: 'expired' },
        $unset: { holdExpiresAt: 1 },
        $push: { pendingEvents: outboxEvent('appointment.expired', eventPayload(appt)) },
      }
    );
    if (expired) {
      await releaseSlot(appt.doctorId, appt.slot);
      console.log(`[saga] hold expired for appointment ${appt._id}; slot ${appt.slot} released`);
    }
  }
  if (due.length) kick();
}

function registerEvents(bus) {
  bus.useOutbox(Appointment);
  bus.subscribe('appointments.events', Object.keys(handlers), async (evt, key) => {
    if (handlers[key]) await handlers[key](evt);
  });
  setInterval(() => expireHolds(() => bus.flush()).catch((err) => console.warn('[saga] sweep failed:', err.message)), SWEEP_INTERVAL_MS);
}

module.exports = { registerEvents };
