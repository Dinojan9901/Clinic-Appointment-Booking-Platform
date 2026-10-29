/** Data layer: User model (Auth Service owns the auth_db database). */
const mongoose = require('mongoose');
const { outboxSchema } = require('../common/messaging');

const doctorProfileSchema = new mongoose.Schema(
  {
    licenseNo: { type: String, trim: true },
    speciality: { type: String, trim: true },
    clinicId: { type: String },
    clinicName: { type: String },
    fee: { type: Number },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['patient', 'doctor', 'admin'], default: 'patient' },
    active: { type: Boolean, default: true },
    doctorStatus: { type: String, enum: ['pending', 'approved', 'rejected'] },
    doctorProfile: { type: doctorProfileSchema },
    rejectionReason: { type: String },
    pendingEvents: { type: [outboxSchema], default: [] },
  },
  { timestamps: true }
);

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    delete ret.pendingEvents;
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);
