/** Business-logic layer: booking (with payment hold), cancel, reschedule, complete and review. */
const { Doctor, Appointment, Review } = require('./models');
const { invalidate } = require('./cache');
const { outboxEvent } = require('../common/messaging');
const { identity, requireRole, httpError, slotToDate } = require('../common/service');

const HOLD_MINUTES = Number(process.env.HOLD_MINUTES || 10);
let kick = () => {};
const onEventsQueued = (fn) => (kick = fn);

function eventPayload(appt, extra = {}) {
  return {
    appointmentId: appt._id.toString(),
    patientId: appt.patientId,
    patientName: appt.patientName,
    patientEmail: appt.patientEmail,
    doctorId: appt.doctorId,
    doctorName: appt.doctorName,
    doctorEmail: appt.doctorEmail,
    clinicName: appt.clinicName,
    slot: appt.slot,
    fee: appt.fee,
    ...extra,
  };
}

function assertFutureSlot(slot) {
  const at = slotToDate(slot);
  if (!at) throw httpError(400, 'slot must look like 2026-11-20 09:30');
  if (at.getTime() <= Date.now()) throw httpError(409, 'this slot is in the past');
}

async function reserveSlot(doctorId, slot) {
  return Doctor.findOneAndUpdate(
    { _id: doctorId, status: 'active', availableSlots: slot },
    { $pull: { availableSlots: slot } },
    { new: true }
  );
}

async function releaseSlot(doctorId, slot) {
  const at = slotToDate(slot);
  if (at && at.getTime() > Date.now()) {
    await Doctor.updateOne({ _id: doctorId }, { $addToSet: { availableSlots: slot } });
  }
  await invalidate('doctors');
}

// POST /appointments  { doctorId, slot }  -> holds the slot until payment (Saga step 1)
async function bookAppointment(req, res, next) {
  try {
    const { userId, name, email } = requireRole(req, 'patient');
    const { doctorId, slot } = req.body || {};
    if (typeof doctorId !== 'string' || typeof slot !== 'string' || !doctorId || !slot) {
      throw httpError(400, 'doctorId and slot are required');
    }
    assertFutureSlot(slot);

    const doctor = await reserveSlot(doctorId, slot);
    if (!doctor) {
      const exists = await Doctor.exists({ _id: doctorId, status: 'active' });
      throw exists ? httpError(409, 'selected slot is no longer available') : httpError(404, 'doctor not found');
    }

    const appointment = new Appointment({
      patientId: userId,
      patientName: name || 'Patient',
      patientEmail: email,
      doctorId: doctor._id.toString(),
      doctorName: doctor.name,
      doctorEmail: doctor.email,
      speciality: doctor.speciality,
      clinicName: doctor.clinicName,
      clinicAddress: doctor.clinicAddress,
      slot,
      fee: doctor.fee,
      status: 'pending_payment',
      paymentStatus: 'pending',
      holdExpiresAt: new Date(Date.now() + HOLD_MINUTES * 60000),
    });
    appointment.pendingEvents = [
      outboxEvent('appointment.created', eventPayload(appointment, { holdExpiresAt: appointment.holdExpiresAt })),
    ];
    try {
      await appointment.save();
    } catch (err) {
      await releaseSlot(doctor._id, slot);
      throw err;
    }
    await invalidate('doctors');
    kick();
    res.status(201).json(appointment);
  } catch (err) {
    next(err);
  }
}

// GET /appointments/mine
async function myAppointments(req, res, next) {
  try {
    const { userId } = requireRole(req);
    res.json(await Appointment.find({ patientId: userId }).sort({ createdAt: -1 }));
  } catch (err) {
    next(err);
  }
}

// GET /appointments/doctor  (the logged-in doctor's confirmed visits)
async function doctorAppointments(req, res, next) {
  try {
    const { email } = requireRole(req, 'doctor');
    res.json(await Appointment.find({ doctorEmail: email, status: 'booked' }).sort({ slot: 1 }));
  } catch (err) {
    next(err);
  }
}

// GET /appointments/all?status=  (admin overview)
async function allAppointments(req, res, next) {
  try {
    requireRole(req, 'admin');
    const filter = {};
    if (typeof req.query.status === 'string' && req.query.status) filter.status = req.query.status;
    res.json(await Appointment.find(filter).sort({ createdAt: -1 }).limit(200));
  } catch (err) {
    next(err);
  }
}

// GET /appointments/:id  (owning patient, assigned doctor, or admin)
async function getAppointment(req, res, next) {
  try {
    const { userId, role, email } = identity(req);
    const appt = await Appointment.findById(req.params.id);
    if (!appt) throw httpError(404, 'appointment not found');
    const allowed =
      appt.patientId === userId || role === 'admin' || (role === 'doctor' && !!email && appt.doctorEmail === email);
    if (!allowed) throw httpError(403, 'not allowed to view this appointment');
    res.json(appt);
  } catch (err) {
    next(err);
  }
}

// POST /appointments/:id/complete  (assigned doctor; called synchronously by the Records Service)
async function completeAppointment(req, res, next) {
  try {
    const { email } = requireRole(req, 'doctor');
    const appt = await Appointment.findById(req.params.id);
    if (!appt) throw httpError(404, 'appointment not found');
    if (!email || appt.doctorEmail !== email) throw httpError(403, 'this appointment belongs to another doctor');
    if (appt.status === 'completed') return res.json(appt);
    const completed = await Appointment.findOneAndUpdate(
      { _id: appt._id, status: 'booked' },
      { $set: { status: 'completed' } },
      { new: true }
    );
    if (!completed) throw httpError(409, `appointment is ${appt.status}`);
    res.json(completed);
  } catch (err) {
    next(err);
  }
}

// POST /appointments/:id/cancel  (owning patient; a paid booking is refunded by the Payment Service)
async function cancelAppointment(req, res, next) {
  try {
    const { userId } = requireRole(req, 'patient');
    const appt = await Appointment.findById(req.params.id);
    if (!appt) throw httpError(404, 'appointment not found');
    if (appt.patientId !== userId) throw httpError(403, 'you can only cancel your own appointment');
    if (!['pending_payment', 'booked'].includes(appt.status)) throw httpError(409, `appointment is already ${appt.status}`);

    const cancelled = await Appointment.findOneAndUpdate(
      { _id: appt._id, patientId: userId, status: appt.status },
      {
        $set: { status: 'cancelled' },
        $unset: { holdExpiresAt: 1 },
        $push: { pendingEvents: outboxEvent('appointment.cancelled', eventPayload(appt, { wasPaid: appt.paymentStatus === 'paid', paymentId: appt.paymentId })) },
      },
      { new: true }
    );
    if (!cancelled) throw httpError(409, 'appointment can no longer be cancelled');
    await releaseSlot(appt.doctorId, appt.slot);
    kick();
    res.json(cancelled);
  } catch (err) {
    next(err);
  }
}

// POST /appointments/:id/reschedule  { slot }  (owning patient, confirmed bookings only, same doctor)
async function rescheduleAppointment(req, res, next) {
  try {
    const { userId } = requireRole(req, 'patient');
    const { slot } = req.body || {};
    if (typeof slot !== 'string' || !slot) throw httpError(400, 'slot is required');
    assertFutureSlot(slot);
    const appt = await Appointment.findById(req.params.id);
    if (!appt) throw httpError(404, 'appointment not found');
    if (appt.patientId !== userId) throw httpError(403, 'you can only reschedule your own appointment');
    if (appt.status !== 'booked') throw httpError(409, 'only confirmed (paid) appointments can be rescheduled');
    if (appt.slot === slot) throw httpError(400, 'choose a different slot');

    if (!(await reserveSlot(appt.doctorId, slot))) throw httpError(409, 'selected slot is no longer available');
    const oldSlot = appt.slot;
    const moved = await Appointment.findOneAndUpdate(
      { _id: appt._id, status: 'booked', slot: oldSlot },
      {
        $set: { slot },
        $push: {
          rescheduleHistory: { from: oldSlot, to: slot, at: new Date() },
          pendingEvents: outboxEvent('appointment.rescheduled', eventPayload(appt, { slot, oldSlot })),
        },
      },
      { new: true }
    );
    if (!moved) {
      await releaseSlot(appt.doctorId, slot);
      throw httpError(409, 'appointment changed meanwhile; please try again');
    }
    await releaseSlot(appt.doctorId, oldSlot);
    kick();
    res.json(moved);
  } catch (err) {
    next(err);
  }
}

// POST /appointments/:id/review  { rating 1-5, comment }  (owning patient, completed visits, once)
async function reviewAppointment(req, res, next) {
  try {
    const { userId } = requireRole(req, 'patient');
    const rating = Number(req.body?.rating);
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim().slice(0, 500) : '';
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw httpError(400, 'rating must be a whole number from 1 to 5');
    const appt = await Appointment.findById(req.params.id);
    if (!appt) throw httpError(404, 'appointment not found');
    if (appt.patientId !== userId) throw httpError(403, 'you can only review your own visit');
    if (appt.status !== 'completed') throw httpError(409, 'you can review a doctor only after a completed visit');

    const marked = await Appointment.findOneAndUpdate(
      { _id: appt._id, status: 'completed', reviewed: { $ne: true } },
      {
        $set: { reviewed: true },
        $push: { pendingEvents: outboxEvent('review.submitted', eventPayload(appt, { rating, comment })) },
      },
      { new: true }
    );
    if (!marked) throw httpError(409, 'you have already reviewed this visit');
    const review = await Review.create({
      appointmentId: appt._id.toString(),
      doctorId: appt.doctorId,
      patientId: userId,
      patientName: appt.patientName,
      rating,
      comment,
    });
    await Doctor.updateOne({ _id: appt.doctorId }, [
      { $set: { ratingSum: { $add: ['$ratingSum', rating] }, ratingCount: { $add: ['$ratingCount', 1] } } },
      { $set: { rating: { $round: [{ $divide: ['$ratingSum', '$ratingCount'] }, 1] } } },
    ]);
    await invalidate('doctors');
    kick();
    res.status(201).json(review);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  onEventsQueued,
  eventPayload,
  releaseSlot,
  bookAppointment,
  myAppointments,
  doctorAppointments,
  allAppointments,
  getAppointment,
  completeAppointment,
  cancelAppointment,
  rescheduleAppointment,
  reviewAppointment,
};
