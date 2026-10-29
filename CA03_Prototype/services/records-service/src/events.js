/**
 * Messaging layer: keeps consultation records in step with the appointment
 * lifecycle. All handlers are idempotent (delivery is at-least-once).
 */
const { Record, AccessLog } = require('./model');

const handlers = {
  'appointment.booked': (evt) =>
    Record.updateOne(
      { appointmentId: evt.appointmentId },
      {
        $set: {
          patientId: evt.patientId,
          patientName: evt.patientName,
          patientEmail: evt.patientEmail,
          doctorId: evt.doctorId,
          doctorName: evt.doctorName,
          doctorEmail: evt.doctorEmail,
          clinicName: evt.clinicName,
        },
        $setOnInsert: { appointmentId: evt.appointmentId, visitDate: evt.slot, status: 'pending' },
      },
      { upsert: true }
    ),
  'appointment.rescheduled': (evt) =>
    Record.updateOne({ appointmentId: evt.appointmentId, status: 'pending' }, { $set: { visitDate: evt.slot } }),
  'appointment.cancelled': (evt) =>
    Record.updateOne({ appointmentId: evt.appointmentId, status: 'pending' }, { $set: { status: 'cancelled' } }),
};

function registerEvents(bus) {
  bus.useOutbox(Record);
  bus.useOutbox(AccessLog);
  bus.subscribe('records.appointment-events', Object.keys(handlers), async (evt, key) => {
    if (handlers[key]) await handlers[key](evt);
  });
}

module.exports = { registerEvents };
