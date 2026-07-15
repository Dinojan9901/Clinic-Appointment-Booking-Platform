/** Business-logic layer: doctor search and appointment booking. */
const { Doctor, Appointment } = require('./models');
const { publish } = require('./events');

// Identity injected by the API Gateway.
function identity(req) {
  return {
    userId: req.headers['x-user-id'],
    role: req.headers['x-user-role'],
    name: decodeURIComponent(req.headers['x-user-name'] || ''),
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

    // Publish the domain event (asynchronous, event-driven backbone).
    publish('appointment.booked', {
      appointmentId: appointment._id.toString(),
      patientId: appointment.patientId,
      patientName: appointment.patientName,
      doctorId: appointment.doctorId,
      doctorName: appointment.doctorName,
      clinicName: appointment.clinicName,
      slot: appointment.slot,
    });

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
    const appts = await Appointment.find({ status: { $ne: 'cancelled' } }).sort({ slot: 1 });
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
    appt.status = 'cancelled';
    await appt.save();

    // Return the slot to the doctor's availability.
    await Doctor.findByIdAndUpdate(appt.doctorId, { $addToSet: { availableSlots: appt.slot } });

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
  cancelAppointment,
};
