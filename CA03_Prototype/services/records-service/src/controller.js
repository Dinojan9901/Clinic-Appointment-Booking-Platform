/** Business-logic layer: viewing and completing consultation records. */
const Record = require('./model');

const APPOINTMENT_URL = process.env.APPOINTMENT_URL || 'http://localhost:4002';

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

function belongsToDoctor(doctorName, userName) {
  const doctor = normalizedName(doctorName);
  const user = normalizedName(userName);
  if (!doctor || !user) return false;
  return doctor === user || doctor.split(' ')[0] === user.split(' ')[0];
}

// GET /records/mine  (patient's own records)
async function myRecords(req, res, next) {
  try {
    const { userId } = identity(req);
    if (!userId) return res.status(401).json({ error: 'not authenticated' });
    const records = await Record.find({ patientId: userId }).sort({ createdAt: -1 });
    res.json(records);
  } catch (err) {
    next(err);
  }
}

// GET /records/doctor  (all records - doctor view, demo)
async function doctorRecords(req, res, next) {
  try {
    const { role, name } = identity(req);
    if (role !== 'doctor') return res.status(403).json({ error: 'doctor role required' });
    const records = await Record.find({ status: { $ne: 'cancelled' } }).sort({ status: 1, createdAt: -1 });
    const ownRecords = records.filter((record) => belongsToDoctor(record.doctorName, name));
    res.json(ownRecords);
  } catch (err) {
    next(err);
  }
}

// PUT /records/:id   { notes, prescription:[{medication,dosage}] }
async function completeRecord(req, res, next) {
  try {
    const { role, name } = identity(req);
    if (role !== 'doctor') {
      return res.status(403).json({ error: 'only doctors can complete records' });
    }
    const record = await Record.findById(req.params.id);
    if (!record) return res.status(404).json({ error: 'record not found' });
    if (!belongsToDoctor(record.doctorName, name)) {
      return res.status(403).json({ error: 'you can only complete your own patients\' records' });
    }
    if (record.status === 'cancelled') return res.status(409).json({ error: 'appointment was cancelled' });

    const { notes, prescription } = req.body || {};
    if (typeof notes !== 'string' || !notes.trim()) {
      return res.status(400).json({ error: 'consultation notes are required before completing a record' });
    }

    // --- Synchronous inter-service call (REST) ---
    // Verify and complete the appointment before writing the clinical record.
    // If Appointment Service is unavailable, the record remains pending.
    try {
      const resp = await fetch(`${APPOINTMENT_URL}/appointments/${record.appointmentId}/complete`, {
        method: 'POST',
        headers: {
          'x-user-id': identity(req).userId || '',
          'x-user-role': identity(req).role || '',
          'x-user-name': encodeURIComponent(name || ''),
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) {
        if (resp.status === 409 || resp.status === 403) return res.status(resp.status).json(await resp.json());
        if (resp.status >= 500) return res.status(503).json({ error: 'cannot verify the appointment right now (Appointment Service unavailable)' });
        if (resp.status === 404) return res.status(409).json({ error: 'appointment could not be found' });
        return res.status(503).json({ error: 'cannot verify the appointment right now (Appointment Service unavailable)' });
      }
    } catch (e) {
      console.warn('[records-service] could not verify appointment:', e.message);
      return res.status(503).json({ error: 'cannot verify the appointment right now (Appointment Service unavailable)' });
    }

    record.notes = notes.trim();
    if (Array.isArray(prescription)) {
      record.prescription = prescription
        .filter((p) => p && p.medication)
        .map((p) => ({ medication: p.medication, dosage: p.dosage || '' }));
    }
    record.status = 'completed';
    await record.save();

    res.json(record);
  } catch (err) {
    next(err);
  }
}

module.exports = { myRecords, doctorRecords, completeRecord };
