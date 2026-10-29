/**
 * Digital signatures for e-prescriptions (Ed25519, Node's built-in crypto).
 * The key pair is created once and kept in records_db so every replica signs
 * with the same key; anyone can verify with the public key.
 */
const crypto = require('crypto');
const { SigningKey } = require('./model');

const KEY_ID = 'prescription-signing';
let keys = null;

async function loadKeys() {
  let doc = await SigningKey.findById(KEY_ID);
  if (!doc) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    try {
      doc = await SigningKey.create({ _id: KEY_ID, publicKey, privateKey });
    } catch (err) {
      if (err.code !== 11000) throw err;
      doc = await SigningKey.findById(KEY_ID);
    }
  }
  keys = { publicKey: doc.publicKey, privateKey: doc.privateKey };
}

function canonical(record) {
  return JSON.stringify({
    code: record.prescriptionCode,
    appointmentId: record.appointmentId,
    patientName: record.patientName,
    doctorName: record.doctorName,
    doctorEmail: record.doctorEmail,
    clinicName: record.clinicName,
    visitDate: record.visitDate,
    notes: record.notes,
    medications: (record.prescription || []).map((p) => ({ medication: p.medication, dosage: p.dosage || '' })),
    signedAt: new Date(record.signedAt).toISOString(),
  });
}

function sign(record) {
  return crypto.sign(null, Buffer.from(canonical(record)), keys.privateKey).toString('base64');
}

function verify(record) {
  if (!record.signature) return false;
  return crypto.verify(null, Buffer.from(canonical(record)), keys.publicKey, Buffer.from(record.signature, 'base64'));
}

function newCode() {
  return `RX-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

const publicKeyPem = () => keys.publicKey;

module.exports = { loadKeys, sign, verify, newCode, publicKeyPem };
