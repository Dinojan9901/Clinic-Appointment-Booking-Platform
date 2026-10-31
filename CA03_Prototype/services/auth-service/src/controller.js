/** Business-logic layer: registration, login, doctor verification and user administration. */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('./model');
const { outboxEvent } = require('../common/messaging');
const { identity, requireRole, httpError } = require('../common/service');

const JWT_SECRET = process.env.JWT_SECRET || 'mediconnect_dev_secret';
const APPOINTMENT_URL = process.env.APPOINTMENT_URL || 'http://localhost:4002';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateCredentials({ name, email, password }) {
  if (!name || !email || !password) throw httpError(400, 'name, email and password are required');
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) throw httpError(400, 'a valid email is required');
  if (typeof password !== 'string' || password.length < 6) throw httpError(400, 'password must be at least 6 characters');
}

async function ensureEmailFree(email) {
  if (await User.exists({ email: email.toLowerCase() })) throw httpError(409, 'email already registered');
}

function publicUser(user) {
  return { id: user._id, name: user.name, email: user.email, role: user.role };
}

// POST /register  (public: patients only)
async function register(req, res, next) {
  try {
    const { name, email, password } = req.body || {};
    validateCredentials({ name, email, password });
    await ensureEmailFree(email);
    const user = new User({ name, email, passwordHash: await bcrypt.hash(password, 10), role: 'patient' });
    user.pendingEvents = [outboxEvent('user.registered', { userId: user._id.toString(), name: user.name, email: user.email, role: 'patient' })];
    await user.save();
    res.status(201).json(publicUser(user));
  } catch (err) {
    next(err);
  }
}

// POST /register-doctor  (public: creates a doctor account awaiting admin verification)
async function registerDoctor(req, res, next) {
  try {
    const { name, email, password, licenseNo, speciality, clinicId } = req.body || {};
    const fee = Number(req.body?.fee);
    validateCredentials({ name, email, password });
    if (!licenseNo || !speciality || !clinicId) throw httpError(400, 'licenseNo, speciality and clinicId are required');
    if (!Number.isFinite(fee) || fee <= 0) throw httpError(400, 'fee must be a positive number');
    await ensureEmailFree(email);

    let clinic;
    try {
      const resp = await fetch(`${APPOINTMENT_URL}/clinics/${encodeURIComponent(clinicId)}`, { signal: AbortSignal.timeout(3000) });
      if (resp.status === 404 || resp.status === 400) throw httpError(400, 'selected clinic does not exist');
      if (!resp.ok) throw httpError(503, 'clinic directory unavailable, please try again');
      clinic = await resp.json();
    } catch (err) {
      if (err.status) throw err;
      throw httpError(503, 'clinic directory unavailable, please try again');
    }

    const user = new User({
      name,
      email,
      passwordHash: await bcrypt.hash(password, 10),
      role: 'doctor',
      doctorStatus: 'pending',
      doctorProfile: { licenseNo, speciality, clinicId: clinic._id, clinicName: clinic.name, fee },
    });
    user.pendingEvents = [
      outboxEvent('doctor.registered', {
        userId: user._id.toString(),
        name: user.name,
        email: user.email,
        licenseNo,
        speciality,
        clinicId: clinic._id,
        fee,
      }),
    ];
    await user.save();
    res.status(201).json({ ...publicUser(user), doctorStatus: 'pending' });
  } catch (err) {
    next(err);
  }
}

// POST /login
async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'email and password are required' });
    }
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'invalid credentials' });
    }
    if (!user.active) return res.status(403).json({ error: 'this account has been disabled by an administrator' });
    if (user.role === 'doctor' && user.doctorStatus === 'pending') {
      return res.status(403).json({ error: 'your doctor account is awaiting admin verification' });
    }
    if (user.role === 'doctor' && user.doctorStatus === 'rejected') {
      return res.status(403).json({ error: `your doctor registration was rejected${user.rejectionReason ? `: ${user.rejectionReason}` : ''}` });
    }
    const token = jwt.sign(
      { sub: user._id.toString(), role: user.role, name: user.name, email: user.email },
      JWT_SECRET,
      { expiresIn: '2h' }
    );
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    next(err);
  }
}

// GET /me
async function me(req, res, next) {
  try {
    const { userId } = identity(req);
    if (!userId) return res.status(401).json({ error: 'not authenticated' });
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'user not found' });
    res.json(user);
  } catch (err) {
    next(err);
  }
}

// GET /users?role=&q=  (admin)
async function listUsers(req, res, next) {
  try {
    requireRole(req, 'admin');
    const filter = {};
    if (['patient', 'doctor', 'admin'].includes(req.query.role)) filter.role = req.query.role;
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
      const q = new RegExp(req.query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: q }, { email: q }];
    }
    res.json(await User.find(filter).sort({ createdAt: -1 }).limit(200));
  } catch (err) {
    next(err);
  }
}

// PATCH /users/:id/status  { active }  (admin)
async function setUserStatus(req, res, next) {
  try {
    const admin = requireRole(req, 'admin');
    if (typeof req.body?.active !== 'boolean') throw httpError(400, 'active must be true or false');
    if (req.params.id === admin.userId) throw httpError(400, 'you cannot change your own account status');
    const target = await User.findById(req.params.id);
    if (!target) throw httpError(404, 'user not found');
    if (target.role === 'admin') throw httpError(403, 'admin accounts cannot be disabled here');
    const { active } = req.body;
    const user = await User.findOneAndUpdate(
      { _id: target._id, active: !active },
      {
        $set: { active },
        $push: { pendingEvents: outboxEvent('user.status_changed', { userId: target._id.toString(), name: target.name, email: target.email, role: target.role, active, by: admin.email }) },
      },
      { new: true }
    );
    res.json(user || target);
  } catch (err) {
    next(err);
  }
}

// GET /doctors?status=pending  (admin)
async function listDoctors(req, res, next) {
  try {
    requireRole(req, 'admin');
    const filter = { role: 'doctor' };
    if (['pending', 'approved', 'rejected'].includes(req.query.status)) filter.doctorStatus = req.query.status;
    res.json(await User.find(filter).sort({ createdAt: -1 }));
  } catch (err) {
    next(err);
  }
}

async function decide(req, res, next, approve) {
  try {
    const admin = requireRole(req, 'admin');
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
    const doctor = await User.findOne({ _id: req.params.id, role: 'doctor' });
    if (!doctor) throw httpError(404, 'doctor not found');
    const status = approve ? 'approved' : 'rejected';
    const updated = await User.findOneAndUpdate(
      { _id: doctor._id, doctorStatus: 'pending' },
      {
        $set: approve ? { doctorStatus: status } : { doctorStatus: status, rejectionReason: reason },
        $push: {
          pendingEvents: outboxEvent(approve ? 'doctor.approved' : 'doctor.rejected', {
            userId: doctor._id.toString(),
            name: doctor.name,
            email: doctor.email,
            reason,
            by: admin.email,
          }),
        },
      },
      { new: true }
    );
    if (!updated) throw httpError(409, `doctor is already ${doctor.doctorStatus}`);
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

const approveDoctor = (req, res, next) => decide(req, res, next, true);
const rejectDoctor = (req, res, next) => decide(req, res, next, false);

module.exports = { register, registerDoctor, login, me, listUsers, setUserStatus, listDoctors, approveDoctor, rejectDoctor };
