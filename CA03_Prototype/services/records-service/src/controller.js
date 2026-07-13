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
    const { role } = identity(req);
    if (role !== 'doctor') return res.status(403).json({ error: 'doctor role required' });
    const records = await Record.find().sort({ status: 1, createdAt: -1 });
    res.json(records);
  } catch (err) {
    next(err);
  }
}

// PUT /records/:id   { notes, prescription:[{medication,dosage}] }
async function completeRecord(req, res, next) {
  try {
    const { role } = identity(req);
    if (role !== 'doctor') {
      return res.status(403).json({ error: 'only doctors can complete records' });
    }
    const record = await Record.findById(req.params.id);
    if (!record) return res.status(404).json({ error: 'record not found' });

    // --- Synchronous inter-service call (REST) ---
    // Confirm with the Appointment Service that the appointment is valid
    // before writing the clinical record. This shows synchronous
    // service-to-service communication alongside the async event flow.
    try {
      const resp = await fetch(`${APPOINTMENT_URL}/appointments/${record.appointmentId}`);
      if (resp.ok) {
        const appt = await resp.json();
        if (appt.status === 'cancelled') {
          return res.status(409).json({ error: 'appointment was cancelled' });
        }
      }
    } catch (e) {
      console.warn('[records-service] could not verify appointment:', e.message);
      // Non-fatal for the prototype; continue.
    }

    const { notes, prescription } = req.body || {};
    if (notes !== undefined) record.notes = notes;
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
