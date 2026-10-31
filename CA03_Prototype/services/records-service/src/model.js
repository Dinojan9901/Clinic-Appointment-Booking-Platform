/** Data layer: consultation records with signed e-prescriptions, EHR access log and signing key (records_db). */
const mongoose = require('mongoose');
const { outboxSchema } = require('../common/messaging');

const medicationSchema = new mongoose.Schema(
  {
    medication: { type: String, required: true },
    dosage: { type: String, default: '' },
  },
  { _id: false }
);

const recordSchema = new mongoose.Schema(
  {
    appointmentId: { type: String, required: true, unique: true },
    patientId: { type: String, required: true, index: true },
    patientName: { type: String, required: true },
    patientEmail: { type: String },
    doctorId: { type: String, required: true },
    doctorName: { type: String, required: true },
    doctorEmail: { type: String, index: true },
    clinicName: { type: String },
    visitDate: { type: String },
    notes: { type: String, default: '' },
    prescription: { type: [medicationSchema], default: [] },
    prescriptionCode: { type: String, unique: true, sparse: true },
    signature: { type: String },
    signedAt: { type: Date },
    status: { type: String, enum: ['pending', 'completed', 'cancelled'], default: 'pending' },
    pendingEvents: { type: [outboxSchema], default: [] },
  },
  { timestamps: true }
);

recordSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.pendingEvents;
    return ret;
  },
});

const accessLogSchema = new mongoose.Schema(
  {
    doctorEmail: { type: String, required: true },
    doctorName: { type: String },
    patientId: { type: String, required: true, index: true },
    recordsViewed: { type: Number, default: 0 },
    pendingEvents: { type: [outboxSchema], default: [] },
  },
  { timestamps: true }
);

const keySchema = new mongoose.Schema({
  _id: { type: String },
  publicKey: { type: String, required: true },
  privateKey: { type: String, required: true },
});

const Record = mongoose.model('Record', recordSchema);
const AccessLog = mongoose.model('AccessLog', accessLogSchema);
const SigningKey = mongoose.model('SigningKey', keySchema);

module.exports = { Record, AccessLog, SigningKey };
