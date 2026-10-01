/** Business-logic layer: doctor search and appointment booking. */
const { Doctor, Appointment } = require('./models');
const { outboxEvent, flushOutbox } = require('./events');

// Identity injected by the API Gateway.
function identity(req) {
  return {
    userId: req.headers['x-user-id'],
    role: req.headers['x-user-role'],
    name: decodeURIComponent(req.headers['x-user-name'] || ''),
    email: req.headers['x-user-email'] || '',
  };
}

// Event payload shared by appointment.booked / appointment.cancelled.
function eventPayload(appt) {
  return {
    appointmentId: appt._id.toString(),
    patientId: appt.patientId,
    patientName: appt.patientName,
    doctorId: appt.doctorId,
    doctorName: appt.doctorName,
    doctorEmail: appt.doctorEmail,
    clinicName: appt.clinicName,
    slot: appt.slot,
  };
}

// GET /doctors?speciality=&location=
async function listDoctors(req, res, next) {
  try {
    const { speciality, location } = req.query;
    const filter = {};
    if (speciality) filter.speciality = new RegExp(speciality, 'i');
    if (location) filter.location = new RegExp(location, 'i');
    const doctors = await Doctor.find(filter).sort({ rating: -1 });
    res.json(doctors);
  } catch (err) {
    next(err);
  }
}

// GET /doctors/:id
async function getDoctor(req, res, next) {
  try {
    const doctor = await Doctor.findById(req.params.id);
    if (!doctor) return res.status(404).json({ error: 'doctor not found' });
    res.json(doctor);
  } catch (err) {
    next(err);
  }
}

// POST /appointments   { doctorId, slot }
async function bookAppointment(req, res, next) {
  try {
    const { userId, name, role } = identity(req);
    if (!userId) return res.status(401).json({ error: 'not authenticated' });
    if (role !== 'patient') {
      return res.status(403).json({ error: 'only patients can book appointments' });
    }

    const { doctorId, slot } = req.body || {};
    // Must be plain strings: they go into a query filter, and an object such
    // as {"$ne": ""} would otherwise be interpreted as a Mongo operator.
    if (typeof doctorId !== 'string' || typeof slot !== 'string' || !doctorId || !slot) {
      return res.status(400).json({ error: 'doctorId and slot are required' });
    }

    // Reserve the slot ATOMICALLY: the match on availableSlots and the $pull
    // happen in one single-document operation, so two concurrent requests
    // for the same slot cannot both succeed (no read-check-write race).
    const doctor = await Doctor.findOneAndUpdate(
      { _id: doctorId, availableSlots: slot },
      { $pull: { availableSlots: slot } },
      { new: true }
    );
    if (!doctor) {
      const exists = await Doctor.exists({ _id: doctorId });
      return exists
        ? res.status(409).json({ error: 'selected slot is no longer available' })
        : res.status(404).json({ error: 'doctor not found' });
    }

    // Simulated payment step (a real gateway integration is out of scope).
    const paymentStatus = 'paid';

    const appointment = new Appointment({
      patientId: userId,
      patientName: name || 'Patient',
      doctorId: doctor._id.toString(),
      doctorName: doctor.name,
      doctorEmail: doctor.email,
      speciality: doctor.speciality,
      clinicName: doctor.clinicName,
      clinicAddress: doctor.clinicAddress,
      slot,
      fee: doctor.fee,
      paymentStatus,
      status: 'booked',
    });
    // Transactional outbox: the domain event is saved in the same atomic
    // write as the appointment, so it can never be lost (see events.js).
    appointment.pendingEvents = [outboxEvent('appointment.booked', eventPayload(appointment))];

    try {
      await appointment.save();
    } catch (err) {
      // Compensate: give the slot back so a failed save doesn't leak it.
      await Doctor.updateOne({ _id: doctor._id }, { $addToSet: { availableSlots: slot } });
      throw err;
    }
    flushOutbox(); // publish now if the broker is up; otherwise the relay retries

    res.status(201).json(appointment);
  } catch (err) {
    next(err);
  }
}

// GET /appointments/mine  (patient's own appointments)
async function myAppointments(req, res, next) {
  try {
    const { userId } = identity(req);
    if (!userId) return res.status(401).json({ error: 'not authenticated' });
    const appts = await Appointment.find({ patientId: userId }).sort({ createdAt: -1 });
    res.json(appts);
  } catch (err) {
    next(err);
  }
}

// GET /appointments/doctor  (the logged-in doctor's own appointments)
async function doctorAppointments(req, res, next) {
  try {
    const { role, email } = identity(req);
    if (role !== 'doctor') return res.status(403).json({ error: 'doctor role required' });
    const appts = await Appointment.find({
      doctorEmail: email,
      status: { $ne: 'cancelled' },
    }).sort({ slot: 1 });
    res.json(appts);
  } catch (err) {
    next(err);
  }
}

// GET /appointments/:id  (used by the Records Service for a synchronous check)
// Only the patient who booked it or the doctor it is booked with may read it.
async function getAppointment(req, res, next) {
  try {
    const { userId, role, email } = identity(req);
    const appt = await Appointment.findById(req.params.id);
    if (!appt) return res.status(404).json({ error: 'appointment not found' });
    const isPatient = appt.patientId === userId;
    const isDoctor = role === 'doctor' && !!email && appt.doctorEmail === email;
    if (!isPatient && !isDoctor) {
      return res.status(403).json({ error: 'not allowed to view this appointment' });
    }
    res.json(appt);
  } catch (err) {
    next(err);
  }
}

// POST /appointments/:id/complete  (called synchronously by the Records
// Service when the assigned doctor completes the consultation record)
async function completeAppointment(req, res, next) {
  try {
    const { role, email } = identity(req);
    if (role !== 'doctor') return res.status(403).json({ error: 'doctor role required' });
    const appt = await Appointment.findById(req.params.id);
    if (!appt) return res.status(404).json({ error: 'appointment not found' });
    if (!email || appt.doctorEmail !== email) {
      return res.status(403).json({ error: 'this appointment belongs to another doctor' });
    }
    // Idempotent: the doctor may edit an already-completed record.
    if (appt.status === 'completed') return res.json(appt);

    // Atomic booked -> completed transition. It races safely with a patient's
    // cancel (which needs status 'booked' too): exactly one of them wins.
    const completed = await Appointment.findOneAndUpdate(
      { _id: appt._id, status: 'booked' },
      { $set: { status: 'completed' } },
      { new: true }
    );
    if (!completed) return res.status(409).json({ error: 'appointment was cancelled' });
    res.json(completed);
  } catch (err) {
    next(err);
  }
}

// POST /appointments/:id/cancel  (only while still 'booked': a completed
// appointment - the visit has happened - can no longer be cancelled)
async function cancelAppointment(req, res, next) {
  try {
    const { userId } = identity(req);
    const appt = await Appointment.findById(req.params.id);
    if (!appt) return res.status(404).json({ error: 'appointment not found' });
    if (appt.patientId !== userId) {
      return res.status(403).json({ error: 'you can only cancel your own appointment' });
    }
    if (appt.status !== 'booked') {
      return res.status(409).json({ error: `appointment is already ${appt.status}` });
    }

    // Conditional update (status must still be 'booked') + outbox event in
    // one atomic write: a double-click can't cancel twice or emit two events.
    const cancelled = await Appointment.findOneAndUpdate(
      { _id: appt._id, patientId: userId, status: 'booked' },
      {
        $set: { status: 'cancelled' },
        $push: { pendingEvents: outboxEvent('appointment.cancelled', eventPayload(appt)) },
      },
      { new: true }
    );
    if (!cancelled) {
      return res.status(409).json({ error: 'appointment can no longer be cancelled' });
    }

    // Return the slot to the doctor's availability.
    await Doctor.findByIdAndUpdate(appt.doctorId, { $addToSet: { availableSlots: appt.slot } });
    flushOutbox();

    res.json(cancelled);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listDoctors,
  getDoctor,
  bookAppointment,
  myAppointments,
  doctorAppointments,
  getAppointment,
  completeAppointment,
  cancelAppointment,
};
