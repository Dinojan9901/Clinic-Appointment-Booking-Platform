/** Business-logic layer: viewing and completing consultation records. */
const Record = require('./model');

const APPOINTMENT_URL = process.env.APPOINTMENT_URL || 'http://localhost:4002';

function identity(req) {
  return {
    userId: req.headers['x-user-id'],
    role: req.headers['x-user-role'],
    name: decodeURIComponent(req.headers['x-user-name'] || ''),
    email: req.headers['x-user-email'] || '',
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

// GET /records/doctor  (records of the logged-in doctor's patients only)
async function doctorRecords(req, res, next) {
  try {
    const { role, email } = identity(req);
    if (role !== 'doctor') return res.status(403).json({ error: 'doctor role required' });
    const records = await Record.find({ doctorEmail: email }).sort({ status: 1, createdAt: -1 });
    res.json(records);
  } catch (err) {
    next(err);
  }
}

// PUT /records/:id   { notes, prescription:[{medication,dosage}] }
async function completeRecord(req, res, next) {
  try {
    const { role, email } = identity(req);
    if (role !== 'doctor') {
      return res.status(403).json({ error: 'only doctors can complete records' });
    }
    const record = await Record.findById(req.params.id);
    if (!record) return res.status(404).json({ error: 'record not found' });
    if (!email || record.doctorEmail !== email) {
      return res.status(403).json({ error: 'this record belongs to another doctor' });
    }
    if (record.status === 'cancelled') {
      return res.status(409).json({ error: 'appointment was cancelled' });
    }

    // --- Synchronous inter-service call (REST) ---
    // Ask the Appointment Service (which owns appointment state) to mark the
    // appointment completed. It does an atomic booked -> completed transition,
    // so a concurrent patient cancel and this completion cannot both succeed,
    // and a completed appointment can no longer be cancelled. The caller's
    // identity is propagated so the Appointment Service applies its own
    // authorisation. The call is idempotent, so a retry is safe.
    //
    // This FAILS CLOSED: if the Appointment Service is unreachable we refuse
    // to write rather than risk recording a cancelled visit. For a clinical
    // record, consistency is worth more than availability - the doctor simply
    // retries in a moment.
    let resp;
    try {
      resp = await fetch(`${APPOINTMENT_URL}/appointments/${record.appointmentId}/complete`, {
        method: 'POST',
        headers: {
          'x-user-id': req.headers['x-user-id'] || '',
          'x-user-role': req.headers['x-user-role'] || '',
          'x-user-name': req.headers['x-user-name'] || '',
          'x-user-email': email,
        },
        signal: AbortSignal.timeout(3000),
      });
    } catch (e) {
      console.warn('[records-service] could not verify appointment:', e.message);
      return res.status(503).json({
        error: 'cannot verify the appointment right now (Appointment Service unavailable); please try again',
      });
    }
    if (resp.status === 404) {
      return res.status(409).json({ error: 'appointment no longer exists' });
    }
    if (resp.status === 403 || resp.status === 409) {
      // Not this doctor's appointment, or the patient cancelled it.
      const body = await resp.json().catch(() => ({}));
      return res.status(resp.status).json({ error: body.error || 'appointment cannot be completed' });
    }
    if (!resp.ok) {
      return res.status(502).json({ error: `appointment verification failed (${resp.status})` });
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
