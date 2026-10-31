/**
 * Messaging layer (consumer): turns domain events into patient/doctor
 * notifications and maintains appointment reminders. Each notification key is
 * derived from the event id, so redelivered events never notify twice.
 */
const { Reminder } = require('./model');
const { notify } = require('./notify');
const { slotToDate } = require('../common/service');

const REMINDER_LEAD_HOURS = Number(process.env.REMINDER_LEAD_HOURS || 24);
const REMINDER_INTERVAL_MS = 30000;

const money = (evt) => `${evt.currency || 'LKR'} ${Number(evt.amount ?? evt.fee ?? 0).toFixed(2)}`;
const at = (evt) => `${evt.doctorName} at ${evt.clinicName} on ${evt.slot}`;
const time = (d) => new Date(d).toLocaleTimeString('en-GB', { timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit' });

const toPatient = (evt, subject, message, type = 'appointment') =>
  notify({ key: `${evt.eventId}:patient`, userId: evt.patientId, email: evt.patientEmail, type, subject, message });
const toDoctor = (evt, subject, message) =>
  notify({ key: `${evt.eventId}:doctor`, email: evt.doctorEmail, type: 'appointment', subject, message });

async function upsertReminder(evt) {
  const slotAt = slotToDate(evt.slot);
  if (!slotAt) return;
  await Reminder.updateOne(
    { appointmentId: evt.appointmentId },
    {
      $set: {
        patientId: evt.patientId,
        patientEmail: evt.patientEmail,
        doctorName: evt.doctorName,
        clinicName: evt.clinicName,
        slot: evt.slot,
        sendAt: new Date(slotAt.getTime() - REMINDER_LEAD_HOURS * 3600000),
        sent: false,
      },
    },
    { upsert: true }
  );
}

const handlers = {
  'appointment.created': (evt) =>
    toPatient(evt, 'Complete your payment', `Your slot with ${at(evt)} is on hold. Please complete the payment of ${money(evt)} before ${time(evt.holdExpiresAt)} to confirm it.`, 'payment'),
  'payment.failed': (evt) =>
    toPatient(evt, 'Payment declined', `Your payment of ${money(evt)} was declined (${String(evt.reason).replace('_', ' ')}). Your slot is still on hold - you can try another card.`, 'payment'),
  'appointment.booked': async (evt) => {
    await toPatient(evt, 'Appointment confirmed', `Your appointment with ${at(evt)} is confirmed (receipt ${evt.receiptNo || '-'}). Please arrive 10 minutes early.`);
    await toDoctor(evt, 'New booking', `New appointment: ${evt.patientName} on ${evt.slot}.`);
    await upsertReminder(evt);
  },
  'appointment.rescheduled': async (evt) => {
    await toPatient(evt, 'Appointment rescheduled', `Your appointment with ${evt.doctorName} has moved from ${evt.oldSlot} to ${evt.slot}.`);
    await toDoctor(evt, 'Appointment rescheduled', `${evt.patientName} moved their appointment from ${evt.oldSlot} to ${evt.slot}.`);
    await upsertReminder(evt);
  },
  'appointment.cancelled': async (evt) => {
    await toPatient(evt, 'Appointment cancelled', `Your appointment with ${at(evt)} has been cancelled.${evt.wasPaid ? ' A full refund will be issued.' : ''}`);
    if (evt.wasPaid) await toDoctor(evt, 'Appointment cancelled', `${evt.patientName} cancelled the appointment on ${evt.slot}.`);
    await Reminder.deleteOne({ appointmentId: evt.appointmentId });
  },
  'appointment.expired': (evt) =>
    toPatient(evt, 'Slot hold expired', `Your hold for ${at(evt)} expired because payment was not completed. The slot has been released.`),
  'payment.refunded': (evt) =>
    toPatient(evt, 'Refund processed', `A refund of ${money(evt)} for receipt ${evt.receiptNo} has been processed.`, 'payment'),
  'record.completed': (evt) =>
    toPatient(evt, 'Prescription ready', `${evt.doctorName} has completed your consultation record. Prescription ${evt.prescriptionCode} is ready to download in My Records.`, 'record'),
  'doctor.registered': (evt) =>
    notify({ key: `${evt.eventId}:doctor`, userId: evt.userId, email: evt.email, type: 'account', subject: 'Registration received', message: `Hi ${evt.name}, your doctor registration (licence ${evt.licenseNo}) was received and is awaiting admin verification.` }),
  'doctor.approved': (evt) =>
    notify({ key: `${evt.eventId}:doctor`, userId: evt.userId, email: evt.email, type: 'account', subject: 'Account verified', message: `Hi ${evt.name}, your doctor account has been verified. You can now log in and publish your available slots.` }),
  'doctor.rejected': (evt) =>
    notify({ key: `${evt.eventId}:doctor`, userId: evt.userId, email: evt.email, type: 'account', subject: 'Registration not approved', message: `Hi ${evt.name}, your doctor registration was not approved${evt.reason ? `: ${evt.reason}` : '.'}` }),
};

async function sendDueReminders() {
  for (;;) {
    const reminder = await Reminder.findOneAndUpdate({ sent: false, sendAt: { $lte: new Date() } }, { $set: { sent: true } }, { new: true });
    if (!reminder) return;
    if ((slotToDate(reminder.slot)?.getTime() || 0) <= Date.now()) continue;
    await notify({
      key: `reminder:${reminder.appointmentId}:${reminder.slot}`,
      userId: reminder.patientId,
      email: reminder.patientEmail,
      type: 'reminder',
      subject: 'Appointment reminder',
      message: `Reminder: your appointment with ${reminder.doctorName} at ${reminder.clinicName} is on ${reminder.slot}.`,
    });
  }
}

function registerEvents(bus) {
  bus.subscribe('notifications.events', Object.keys(handlers), async (evt, key) => {
    if (handlers[key]) await handlers[key](evt);
  });
  setInterval(() => sendDueReminders().catch((err) => console.warn('[reminders] failed:', err.message)), REMINDER_INTERVAL_MS);
}

module.exports = { registerEvents };
