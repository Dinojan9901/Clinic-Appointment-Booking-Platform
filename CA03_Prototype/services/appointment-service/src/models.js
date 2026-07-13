/** Data layer: Doctor and Appointment models (appointment_db). */
const mongoose = require('mongoose');

const doctorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    speciality: { type: String, required: true },
    clinicName: { type: String, required: true },
    clinicAddress: { type: String, required: true },
    location: { type: String, required: true }, // city / town
    fee: { type: Number, required: true },
    rating: { type: Number, default: 4.5 },
    availableSlots: { type: [String], default: [] }, // e.g. "2026-07-20 09:00"
  },
  { timestamps: true }
);

const appointmentSchema = new mongoose.Schema(
  {
    patientId: { type: String, required: true },
    patientName: { type: String, required: true },
    doctorId: { type: String, required: true },
    doctorName: { type: String, required: true },
    speciality: { type: String },
    clinicName: { type: String },
    clinicAddress: { type: String },
    slot: { type: String, required: true },
    fee: { type: Number, default: 0 },
    paymentStatus: { type: String, enum: ['pending', 'paid'], default: 'pending' },
    status: { type: String, enum: ['booked', 'cancelled', 'completed'], default: 'booked' },
  },
  { timestamps: true }
);

const Doctor = mongoose.model('Doctor', doctorSchema);
const Appointment = mongoose.model('Appointment', appointmentSchema);

module.exports = { Doctor, Appointment };
