/** Data layer: Clinic, Doctor, Appointment and Review models (appointment_db). */
const mongoose = require('mongoose');
const { outboxSchema } = require('../common/messaging');

const clinicSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    address: { type: String, required: true, trim: true },
    location: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, default: '' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const doctorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, lowercase: true, trim: true, unique: true, sparse: true },
    userId: { type: String },
    licenseNo: { type: String },
    speciality: { type: String, required: true },
    clinicId: { type: String, index: true },
    clinicName: { type: String, required: true },
    clinicAddress: { type: String, required: true },
    location: { type: String, required: true },
    fee: { type: Number, required: true },
    rating: { type: Number, default: null },
    ratingSum: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    status: { type: String, enum: ['pending', 'active', 'rejected', 'suspended'], default: 'active', index: true },
    availableSlots: { type: [String], default: [] },
  },
  { timestamps: true }
);

const appointmentSchema = new mongoose.Schema(
  {
    patientId: { type: String, required: true, index: true },
    patientName: { type: String, required: true },
    patientEmail: { type: String },
    doctorId: { type: String, required: true },
    doctorName: { type: String, required: true },
    doctorEmail: { type: String, index: true },
    speciality: { type: String },
    clinicName: { type: String },
    clinicAddress: { type: String },
    slot: { type: String, required: true },
    fee: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['pending_payment', 'booked', 'completed', 'cancelled', 'expired'],
      default: 'pending_payment',
      index: true,
    },
    paymentStatus: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
    holdExpiresAt: { type: Date, index: true },
    paymentId: { type: String },
    receiptNo: { type: String },
    rejectedPaymentIds: { type: [String], default: [] },
    rescheduleHistory: { type: [{ from: String, to: String, at: Date, _id: false }], default: [] },
    reviewed: { type: Boolean, default: false },
    pendingEvents: { type: [outboxSchema], default: [] },
  },
  { timestamps: true }
);

appointmentSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.pendingEvents;
    delete ret.rejectedPaymentIds;
    return ret;
  },
});

const reviewSchema = new mongoose.Schema(
  {
    appointmentId: { type: String, required: true, unique: true },
    doctorId: { type: String, required: true, index: true },
    patientId: { type: String, required: true },
    patientName: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: '', maxlength: 500 },
  },
  { timestamps: true }
);

const Clinic = mongoose.model('Clinic', clinicSchema);
const Doctor = mongoose.model('Doctor', doctorSchema);
const Appointment = mongoose.model('Appointment', appointmentSchema);
const Review = mongoose.model('Review', reviewSchema);

module.exports = { Clinic, Doctor, Appointment, Review };
