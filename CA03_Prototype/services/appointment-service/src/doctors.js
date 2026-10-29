/** Business-logic layer: doctor search, profiles, reviews and doctor-managed availability. */
const { Doctor, Appointment, Review } = require('./models');
const { cached, invalidate } = require('./cache');
const { identity, requireRole, httpError, slotToDate } = require('../common/service');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function futureSlots(slots) {
  const now = Date.now();
  return slots.filter((s) => (slotToDate(s)?.getTime() || 0) > now).sort();
}

function present(doctor) {
  const d = doctor.toJSON ? doctor.toJSON() : doctor;
  return { ...d, availableSlots: futureSlots(d.availableSlots || []) };
}

async function ownProfile(req) {
  const { email } = requireRole(req, 'doctor');
  const doctor = await Doctor.findOne({ email });
  if (!doctor) throw httpError(404, 'no doctor profile is linked to this account yet');
  return doctor;
}

// GET /doctors?speciality=&location=&clinicId=
async function listDoctors(req, res, next) {
  try {
    const text = (v) => (typeof v === 'string' ? v.trim() : '');
    const params = { speciality: text(req.query.speciality), location: text(req.query.location), clinicId: text(req.query.clinicId) };
    const { data, status } = await cached('doctors', params, async () => {
      const filter = { status: 'active' };
      if (params.speciality) filter.speciality = new RegExp(escapeRe(params.speciality), 'i');
      if (params.location) filter.location = new RegExp(escapeRe(params.location), 'i');
      if (params.clinicId) filter.clinicId = params.clinicId;
      const doctors = await Doctor.find(filter).sort({ rating: -1, name: 1 }).lean();
      return doctors.map((d) => ({ ...d, availableSlots: (d.availableSlots || []).slice().sort() }));
    });
    res.set('X-Cache', status);
    res.json(data.map((d) => ({ ...d, availableSlots: futureSlots(d.availableSlots) })));
  } catch (err) {
    next(err);
  }
}

// GET /doctors/all  (admin: every doctor regardless of status)
async function listAllDoctors(req, res, next) {
  try {
    requireRole(req, 'admin');
    res.json((await Doctor.find().sort({ status: 1, name: 1 })).map(present));
  } catch (err) {
    next(err);
  }
}

// GET /doctors/:id
async function getDoctor(req, res, next) {
  try {
    const doctor = await Doctor.findById(req.params.id);
    const who = identity(req);
    if (!doctor || (doctor.status !== 'active' && who.role !== 'admin' && who.email !== doctor.email)) {
      throw httpError(404, 'doctor not found');
    }
    res.json(present(doctor));
  } catch (err) {
    next(err);
  }
}

// GET /doctors/:id/reviews
async function doctorReviews(req, res, next) {
  try {
    const reviews = await Review.find({ doctorId: req.params.id }).sort({ createdAt: -1 }).limit(50);
    res.json(reviews.map((r) => ({ _id: r._id, rating: r.rating, comment: r.comment, patientName: r.patientName.split(' ')[0], createdAt: r.createdAt })));
  } catch (err) {
    next(err);
  }
}

// GET /doctors/me
async function myProfile(req, res, next) {
  try {
    res.json(present(await ownProfile(req)));
  } catch (err) {
    next(err);
  }
}

// POST /doctors/me/slots  { slot: "YYYY-MM-DD HH:mm" }
async function addSlot(req, res, next) {
  try {
    const doctor = await ownProfile(req);
    if (doctor.status !== 'active') throw httpError(403, `your profile is ${doctor.status}; slots cannot be published`);
    const { slot } = req.body || {};
    const at = slotToDate(slot);
    if (!at) throw httpError(400, 'slot must look like 2026-11-20 09:30');
    if (at.getTime() <= Date.now()) throw httpError(400, 'slot must be in the future');
    if (doctor.availableSlots.includes(slot)) throw httpError(409, 'this slot is already published');
    const taken = await Appointment.exists({ doctorId: doctor._id.toString(), slot, status: { $in: ['pending_payment', 'booked'] } });
    if (taken) throw httpError(409, 'this slot already has an appointment');
    const updated = await Doctor.findByIdAndUpdate(doctor._id, { $addToSet: { availableSlots: slot } }, { new: true });
    await invalidate('doctors');
    res.status(201).json(present(updated));
  } catch (err) {
    next(err);
  }
}

// DELETE /doctors/me/slots/:slot  (only free slots can be withdrawn)
async function removeSlot(req, res, next) {
  try {
    const doctor = await ownProfile(req);
    const { slot } = req.params;
    const updated = await Doctor.findOneAndUpdate(
      { _id: doctor._id, availableSlots: slot },
      { $pull: { availableSlots: slot } },
      { new: true }
    );
    if (!updated) throw httpError(409, 'slot is not free (already booked or not published)');
    await invalidate('doctors');
    res.json(present(updated));
  } catch (err) {
    next(err);
  }
}

module.exports = { listDoctors, listAllDoctors, getDoctor, doctorReviews, myProfile, addSlot, removeSlot, futureSlots };
