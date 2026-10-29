/** Builds the audit log (a read model of all events) and the platform statistics from it. */
const Activity = require('./model');

const SUMMARIES = {
  'user.registered': (e) => [`Patient ${e.name} registered`, e.email],
  'user.status_changed': (e) => [`${e.role} ${e.name} was ${e.active ? 'enabled' : 'disabled'}`, e.by],
  'doctor.registered': (e) => [`Dr sign-up: ${e.name} (${e.speciality}, licence ${e.licenseNo}) awaiting verification`, e.email],
  'doctor.approved': (e) => [`Doctor ${e.name} verified`, e.by],
  'doctor.rejected': (e) => [`Doctor ${e.name} rejected${e.reason ? `: ${e.reason}` : ''}`, e.by],
  'appointment.created': (e) => [`${e.patientName} placed a hold with ${e.doctorName} for ${e.slot}`, e.patientEmail],
  'appointment.booked': (e) => [`Booking confirmed: ${e.patientName} with ${e.doctorName} on ${e.slot}`, e.patientEmail],
  'appointment.cancelled': (e) => [`${e.patientName} cancelled ${e.slot} with ${e.doctorName}`, e.patientEmail],
  'appointment.expired': (e) => [`Hold expired (unpaid): ${e.patientName}, ${e.slot}`, 'system'],
  'appointment.rescheduled': (e) => [`${e.patientName} rescheduled ${e.oldSlot} -> ${e.slot}`, e.patientEmail],
  'appointment.payment_rejected': (e) => [`Late payment rejected for ${e.patientName} (${e.reason}) - refund requested`, 'system'],
  'payment.succeeded': (e) => [`Payment received ${e.currency} ${e.amount} (${e.receiptNo})`, e.patientEmail],
  'payment.failed': (e) => [`Payment declined for ${e.patientName}: ${e.reason}`, e.patientEmail],
  'payment.refunded': (e) => [`Refund ${e.currency} ${e.amount} (${e.receiptNo}): ${e.reason}`, 'system'],
  'record.completed': (e) => [`${e.doctorName} completed a record for ${e.patientName} (${e.prescriptionCode})`, e.doctorEmail],
  'ehr.accessed': (e) => [`${e.doctorName} viewed the medical history of ${e.patientName || e.patientId} (${e.recordsViewed} records)`, e.doctorEmail],
  'review.submitted': (e) => [`${e.patientName} rated ${e.doctorName} ${e.rating}/5`, e.patientEmail],
};

async function record(evt, type) {
  const [summary, actor] = (SUMMARIES[type] || (() => [type, '']))(evt);
  try {
    await Activity.create({
      eventId: evt.eventId,
      type,
      summary,
      actor,
      amount: typeof evt.amount === 'number' ? evt.amount : undefined,
      data: { appointmentId: evt.appointmentId, patientId: evt.patientId, doctorEmail: evt.doctorEmail, paymentId: evt.paymentId },
      occurredAt: evt.occurredAt ? new Date(evt.occurredAt) : new Date(),
    });
  } catch (err) {
    if (err.code !== 11000) throw err;
  }
}

async function stats() {
  const byType = Object.fromEntries(
    (await Activity.aggregate([{ $group: { _id: '$type', n: { $sum: 1 } } }])).map((r) => [r._id, r.n])
  );
  const sum = async (type) =>
    (await Activity.aggregate([{ $match: { type } }, { $group: { _id: null, t: { $sum: '$amount' } } }]))[0]?.t || 0;
  const collected = await sum('payment.succeeded');
  const refunded = await sum('payment.refunded');
  const since = new Date(Date.now() - 24 * 3600000);
  return {
    patientsRegistered: byType['user.registered'] || 0,
    doctorSignups: byType['doctor.registered'] || 0,
    doctorsVerified: byType['doctor.approved'] || 0,
    holdsPlaced: byType['appointment.created'] || 0,
    bookingsConfirmed: byType['appointment.booked'] || 0,
    cancellations: byType['appointment.cancelled'] || 0,
    expiredHolds: byType['appointment.expired'] || 0,
    reschedules: byType['appointment.rescheduled'] || 0,
    recordsCompleted: byType['record.completed'] || 0,
    reviews: byType['review.submitted'] || 0,
    paymentsFailed: byType['payment.failed'] || 0,
    revenue: { collected, refunded, net: collected - refunded, currency: 'LKR' },
    eventsLast24h: await Activity.countDocuments({ occurredAt: { $gte: since } }),
  };
}

module.exports = { record, stats };
