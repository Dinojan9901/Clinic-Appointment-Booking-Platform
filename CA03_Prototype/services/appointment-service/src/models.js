/** Data layer: Doctor and Appointment models (appointment_db). */
const mongoose = require('mongoose');

const doctorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    // Business key linking this profile to the doctor's login (Auth Service).
    email: { type: String, lowercase: true, trim: true, index: true },
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

/**
 * Transactional outbox entry. Domain events are stored INSIDE the appointment
 * document, so the state change and the event are written in one atomic
 * single-document write (MongoDB guarantees atomicity per document, no
 * multi-document transaction needed). A background relay publishes them to
 * RabbitMQ and removes them only after the broker confirms receipt.
 */
const outboxEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true },
    routingKey: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const appointmentSchema = new mongoose.Schema(
  {
    patientId: { type: String, required: true },
    patientName: { type: String, required: true },
    doctorId: { type: String, required: true },
    doctorName: { type: String, required: true },
    doctorEmail: { type: String, index: true },
    speciality: { type: String },
    clinicName: { type: String },
    clinicAddress: { type: String },
    slot: { type: String, required: true },
    fee: { type: Number, default: 0 },
    paymentStatus: { type: String, enum: ['pending', 'paid'], default: 'pending' },
    status: { type: String, enum: ['booked', 'cancelled', 'completed'], default: 'booked' },
    pendingEvents: { type: [outboxEventSchema], default: [] },
  },
  { timestamps: true }
);

// The outbox is an internal implementation detail - never return it to clients.
appointmentSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.pendingEvents;
    return ret;
  },
});

const Doctor = mongoose.model('Doctor', doctorSchema);
const Appointment = mongoose.model('Appointment', appointmentSchema);

module.exports = { Doctor, Appointment };
