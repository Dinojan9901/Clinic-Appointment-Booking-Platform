/** Data layer: consultation/prescription Record model (records_db). */
const mongoose = require('mongoose');

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
    patientId: { type: String, required: true },
    patientName: { type: String, required: true },
    doctorId: { type: String, required: true },
    doctorName: { type: String, required: true },
    clinicName: { type: String },
    visitDate: { type: String }, // the appointment slot
    notes: { type: String, default: '' },
    prescription: { type: [medicationSchema], default: [] },
    status: { type: String, enum: ['pending', 'completed', 'cancelled'], default: 'pending' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Record', recordSchema);
