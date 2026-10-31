/** Business-logic layer: clinic directory (admin-managed). */
const { Clinic, Doctor } = require('./models');
const { invalidate } = require('./cache');
const { identity, requireRole, httpError } = require('../common/service');

function clinicInput(body = {}) {
  const out = {};
  for (const k of ['name', 'address', 'location', 'phone']) {
    if (body[k] !== undefined) {
      if (typeof body[k] !== 'string') throw httpError(400, `${k} must be text`);
      out[k] = body[k].trim();
    }
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') throw httpError(400, 'active must be true or false');
    out.active = body.active;
  }
  return out;
}

// GET /clinics  (public; admins can pass ?all=1 to include inactive clinics)
async function listClinics(req, res, next) {
  try {
    const all = req.query.all === '1' && identity(req).role === 'admin';
    res.json(await Clinic.find(all ? {} : { active: true }).sort({ location: 1, name: 1 }));
  } catch (err) {
    next(err);
  }
}

// GET /clinics/:id
async function getClinic(req, res, next) {
  try {
    const clinic = await Clinic.findById(req.params.id);
    if (!clinic) throw httpError(404, 'clinic not found');
    res.json(clinic);
  } catch (err) {
    next(err);
  }
}

// POST /clinics  (admin)
async function createClinic(req, res, next) {
  try {
    requireRole(req, 'admin');
    const data = clinicInput(req.body);
    if (!data.name || !data.address || !data.location) throw httpError(400, 'name, address and location are required');
    if (await Clinic.exists({ name: data.name })) throw httpError(409, 'a clinic with this name already exists');
    res.status(201).json(await Clinic.create(data));
  } catch (err) {
    next(err);
  }
}

// PUT /clinics/:id  (admin) - also refreshes the clinic details copied onto doctors
async function updateClinic(req, res, next) {
  try {
    requireRole(req, 'admin');
    const data = clinicInput(req.body);
    if (data.name === '' || data.address === '' || data.location === '') throw httpError(400, 'name, address and location cannot be empty');
    const clinic = await Clinic.findByIdAndUpdate(req.params.id, { $set: data }, { new: true, runValidators: true });
    if (!clinic) throw httpError(404, 'clinic not found');
    await Doctor.updateMany(
      { clinicId: clinic._id.toString() },
      { $set: { clinicName: clinic.name, clinicAddress: clinic.address, location: clinic.location } }
    );
    await invalidate('doctors');
    res.json(clinic);
  } catch (err) {
    if (err.code === 11000) return next(httpError(409, 'a clinic with this name already exists'));
    next(err);
  }
}

module.exports = { listClinics, getClinic, createClinic, updateClinic };
