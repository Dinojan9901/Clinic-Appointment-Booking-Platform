/** Business-logic layer: doctor search and appointment booking. */
const { Doctor, Appointment, OutboxEvent } = require('./models');

// Identity injected by the API Gateway.
function identity(req) {
  return {
    userId: req.headers['x-user-id'],
    role: req.headers['x-user-role'],
    name: decodeURIComponent(req.headers['x-user-name'] || ''),
  };
}

function normalizedName(value) {
  return String(value || '').toLowerCase().replace(/^\s*dr\.?\s*/, '').replace(/[^a-z0-9 ]/g, ' ').trim().replace(/\s+/g, ' ');
}

async function doctorProfile(req) {
  const wanted = normalizedName(identity(req).name);
  if (!wanted) return null;
  const matches = await Doctor.find({}).select('_id name').lean();
  const matched = matches.filter((doctor) => normalizedName(doctor.name) === wanted || normalizedName(doctor.name).split(' ')[0] === wanted.split(' ')[0]);
  return matched.length === 1 ? matched[0] : null;
}

// GET /doctors?speciality=&location=
async function listDoctors(req, res, next) {
  try {
    const { speciality, location } = req.query;
    const filter = {};
    const cleanSpeciality = String(speciality || '').trim();
    const cleanLocation = String(location || '').trim();
    if (cleanSpeciality) filter.speciality = new RegExp(cleanSpeciality.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (cleanLocation) filter.location = new RegExp(cleanLocation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const doctors = await Doctor.find(filter).sort({ rating: -1 });
    res.set('Cache-Control', 'no-store');
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
    if (!doctorId || !slot) {
      return res.status(400).json({ error: 'doctorId and slot are required' });
    }

    const doctor = await Doctor.findById(doctorId);
    if (!doctor) return res.status(404).json({ error: 'doctor not found' });
    if (!doctor.availableSlots.includes(slot)) {
      return res.status(409).json({ error: 'selected slot is no longer available' });
    }

    // Reserve the slot (remove it from the doctor's availability).
    doctor.availableSlots = doctor.availableSlots.filter((s) => s !== slot);
    await doctor.save();

    // Simulated payment step (a real gateway integration is out of scope).
    const paymentStatus = 'paid';

    const appointment = await Appointment.create({
      patientId: userId,
      patientName: name || 'Patient',
      doctorId: doctor._id.toString(),
      doctorName: doctor.name,
      speciality: doctor.speciality,
      clinicName: doctor.clinicName,
      clinicAddress: doctor.clinicAddress,
      slot,
      fee: doctor.fee,
      paymentStatus,
      status: 'booked',
    });

    // Persist the event before acknowledging the booking. The outbox worker
    // publishes it when RabbitMQ is available, so outages cannot lose it.
    const event = {
      eventId: `appointment.booked:${appointment._id}`,
      appointmentId: appointment._id.toString(),
      patientId: appointment.patientId,
      patientName: appointment.patientName,
      doctorId: appointment.doctorId,
      doctorName: appointment.doctorName,
      clinicName: appointment.clinicName,
      slot: appointment.slot,
    };
    try {
      await OutboxEvent.create({ eventId: event.eventId, routingKey: 'appointment.booked', payload: event });
    } catch (err) {
      await Appointment.deleteOne({ _id: appointment._id });
      doctor.availableSlots.push(slot);
      await doctor.save();
      throw err;
    }

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

// GET /appointments/doctor  (all booked appointments - doctor view, demo)
async function doctorAppointments(req, res, next) {
  try {
    const { role } = identity(req);
    if (role !== 'doctor') return res.status(403).json({ error: 'doctor role required' });
    const doctor = await doctorProfile(req);
    if (!doctor) return res.json([]);
    const appts = await Appointment.find({ doctorId: doctor._id.toString(), status: 'booked' }).sort({ slot: 1 });
    res.json(appts);
  } catch (err) {
    next(err);
  }
}

// GET /appointments/:id  (used by the Records Service for a synchronous check)
async function getAppointment(req, res, next) {
  try {
    const appt = await Appointment.findById(req.params.id);
    if (!appt) return res.status(404).json({ error: 'appointment not found' });
    res.json(appt);
  } catch (err) {
    next(err);
  }
}

// POST /appointments/:id/complete (doctor-only lifecycle update)
async function completeAppointment(req, res, next) {
  try {
    if (identity(req).role !== 'doctor') return res.status(403).json({ error: 'doctor role required' });
    const doctor = await doctorProfile(req);
    const appt = await Appointment.findById(req.params.id);
    if (!appt) return res.status(404).json({ error: 'appointment not found' });
    if (!doctor || appt.doctorId !== doctor._id.toString()) {
      return res.status(403).json({ error: 'you can only complete your own appointments' });
    }
    if (appt.status === 'cancelled') return res.status(409).json({ error: 'appointment was cancelled' });
    if (appt.status === 'completed') return res.json(appt);
    if (appt.status !== 'booked') return res.status(409).json({ error: 'appointment is not active' });
    appt.status = 'completed';
    await appt.save();
    res.json(appt);
  } catch (err) {
    next(err);
  }
}

// POST /appointments/:id/cancel
async function cancelAppointment(req, res, next) {
  try {
    const { userId } = identity(req);
    const appt = await Appointment.findById(req.params.id);
    if (!appt) return res.status(404).json({ error: 'appointment not found' });
    if (appt.patientId !== userId) {
      return res.status(403).json({ error: 'you can only cancel your own appointment' });
    }
    if (appt.status === 'cancelled') {
      return res.status(409).json({ error: 'appointment already cancelled' });
    }
    if (appt.status !== 'booked') return res.status(409).json({ error: 'only booked appointments can be cancelled' });
    appt.status = 'cancelled';
    await appt.save();

    // Return the slot to the doctor's availability.
    await Doctor.findByIdAndUpdate(appt.doctorId, { $addToSet: { availableSlots: appt.slot } });

    await OutboxEvent.create({
      eventId: `appointment.cancelled:${appt._id}`,
      routingKey: 'appointment.cancelled',
      payload: {
        eventId: `appointment.cancelled:${appt._id}`,
        appointmentId: appt._id.toString(),
        patientId: appt.patientId,
        patientName: appt.patientName,
        doctorId: appt.doctorId,
        doctorName: appt.doctorName,
        clinicName: appt.clinicName,
        slot: appt.slot,
      },
    });

    res.json(appt);
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
