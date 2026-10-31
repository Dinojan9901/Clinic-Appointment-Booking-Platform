/** Business-logic layer: consultation records, signed e-prescriptions and EHR history. */
const { Record, AccessLog } = require('./model');
const signing = require('./signing');
const { renderPrescription } = require('./pdf');
const { outboxEvent } = require('../common/messaging');
const { identityHeaders, requireRole, httpError } = require('../common/service');

const APPOINTMENT_URL = process.env.APPOINTMENT_URL || 'http://localhost:4002';
let kick = () => {};
const onEventsQueued = (fn) => (kick = fn);

// GET /records/mine  (patient's own records)
async function myRecords(req, res, next) {
  try {
    const { userId } = requireRole(req);
    res.json(await Record.find({ patientId: userId }).sort({ createdAt: -1 }));
  } catch (err) {
    next(err);
  }
}

// GET /records/doctor  (records of the logged-in doctor's patients; cancelled ones hidden)
async function doctorRecords(req, res, next) {
  try {
    const { email } = requireRole(req, 'doctor');
    res.json(await Record.find({ doctorEmail: email, status: { $ne: 'cancelled' } }).sort({ status: 1, createdAt: -1 }));
  } catch (err) {
    next(err);
  }
}

function cleanPrescription(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((p) => p && typeof p.medication === 'string' && p.medication.trim())
    .slice(0, 20)
    .map((p) => ({ medication: p.medication.trim().slice(0, 120), dosage: typeof p.dosage === 'string' ? p.dosage.trim().slice(0, 120) : '' }));
}

async function completeAppointment(req, appointmentId) {
  let resp;
  try {
    resp = await fetch(`${APPOINTMENT_URL}/appointments/${appointmentId}/complete`, {
      method: 'POST',
      headers: identityHeaders(req),
      signal: AbortSignal.timeout(3000),
    });
  } catch (e) {
    console.warn('[records-service] could not verify appointment:', e.message);
    throw httpError(503, 'cannot verify the appointment right now (Appointment Service unavailable); please try again');
  }
  if (resp.status === 404) throw httpError(409, 'appointment no longer exists');
  if (resp.status === 403 || resp.status === 409) {
    const body = await resp.json().catch(() => ({}));
    throw httpError(resp.status, body.error || 'appointment cannot be completed');
  }
  if (!resp.ok) throw httpError(502, `appointment verification failed (${resp.status})`);
}

// PUT /records/:id   { notes, prescription:[{medication,dosage}] }  -> completes and signs the record
async function completeRecord(req, res, next) {
  try {
    const { email, name } = requireRole(req, 'doctor');
    const record = await Record.findById(req.params.id);
    if (!record) throw httpError(404, 'record not found');
    if (!email || record.doctorEmail !== email) throw httpError(403, 'this record belongs to another doctor');
    if (record.status === 'cancelled') throw httpError(409, 'appointment was cancelled');

    const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim().slice(0, 4000) : '';
    if (!notes) throw httpError(400, 'consultation notes are required before completing a record');
    const prescription = cleanPrescription(req.body?.prescription);

    await completeAppointment(req, record.appointmentId);

    const firstCompletion = record.status !== 'completed';
    const signed = {
      ...record.toObject(),
      notes,
      prescription,
      prescriptionCode: record.prescriptionCode || signing.newCode(),
      signedAt: new Date(),
    };
    signed.signature = signing.sign(signed);

    const update = {
      $set: {
        notes,
        prescription,
        status: 'completed',
        prescriptionCode: signed.prescriptionCode,
        signedAt: signed.signedAt,
        signature: signed.signature,
      },
    };
    if (firstCompletion) {
      update.$push = {
        pendingEvents: outboxEvent('record.completed', {
          recordId: record._id.toString(),
          appointmentId: record.appointmentId,
          patientId: record.patientId,
          patientName: record.patientName,
          patientEmail: record.patientEmail,
          doctorName: name || record.doctorName,
          doctorEmail: email,
          prescriptionCode: signed.prescriptionCode,
          medications: prescription.length,
        }),
      };
    }
    const saved = await Record.findOneAndUpdate({ _id: record._id, status: { $ne: 'cancelled' } }, update, { new: true });
    if (!saved) throw httpError(409, 'appointment was cancelled');
    kick();
    res.json(saved);
  } catch (err) {
    next(err);
  }
}

// GET /records/:id/prescription  (signed PDF; patient, assigned doctor or admin)
async function prescriptionPdf(req, res, next) {
  try {
    const { userId, role, email } = requireRole(req);
    const record = await Record.findById(req.params.id);
    const allowed = record && (record.patientId === userId || role === 'admin' || (role === 'doctor' && record.doctorEmail === email));
    if (!allowed) throw httpError(404, 'record not found');
    if (record.status !== 'completed' || !record.signature) throw httpError(409, 'the prescription is available after the doctor completes the visit');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${record.prescriptionCode}.pdf"`);
    await renderPrescription(record, res);
  } catch (err) {
    next(err);
  }
}

// GET /records/patient/:patientId  (EHR history; only for a doctor who treats this patient; access is audited)
async function patientHistory(req, res, next) {
  try {
    const { email, name } = requireRole(req, 'doctor');
    const { patientId } = req.params;
    const treats = await Record.exists({ patientId, doctorEmail: email, status: { $ne: 'cancelled' } });
    if (!treats) throw httpError(403, 'you can view the history only of patients who booked with you');
    const history = await Record.find({ patientId, status: 'completed' }).sort({ updatedAt: -1 });
    const patientName = history[0]?.patientName || (await Record.findOne({ patientId }))?.patientName;
    const log = new AccessLog({ doctorEmail: email, doctorName: name, patientId, recordsViewed: history.length });
    log.pendingEvents = [outboxEvent('ehr.accessed', { doctorEmail: email, doctorName: name, patientId, patientName, recordsViewed: history.length })];
    await log.save();
    kick();
    res.json({ patientId, patientName, records: history });
  } catch (err) {
    next(err);
  }
}

// GET /prescriptions/verify/:code  (public - for pharmacies; checks the digital signature)
async function verifyPrescription(req, res, next) {
  try {
    const record = await Record.findOne({ prescriptionCode: String(req.params.code || '').toUpperCase() });
    if (!record || record.status !== 'completed') return res.status(404).json({ valid: false, error: 'prescription not found' });
    const initials = record.patientName.split(/\s+/).map((p) => `${p[0]}.`).join(' ');
    res.json({
      valid: signing.verify(record),
      code: record.prescriptionCode,
      issuedAt: record.signedAt,
      doctorName: record.doctorName,
      clinicName: record.clinicName,
      patient: initials,
      visitDate: record.visitDate,
      medications: record.prescription,
      algorithm: 'Ed25519',
    });
  } catch (err) {
    next(err);
  }
}

// GET /prescriptions/public-key
function publicKey(_req, res) {
  res.type('text/plain').send(signing.publicKeyPem());
}

module.exports = { onEventsQueued, myRecords, doctorRecords, completeRecord, prescriptionPdf, patientHistory, verifyPrescription, publicKey };
