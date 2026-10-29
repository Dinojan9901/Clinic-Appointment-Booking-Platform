/** Data layer: Notification and Reminder models (notification_db). */
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, sparse: true },
    userId: { type: String, index: true },
    email: { type: String, lowercase: true, index: true },
    type: { type: String, default: 'appointment' },
    message: { type: String, required: true },
    channel: { type: String, default: 'in-app + email' },
    emailStatus: { type: String, enum: ['sent', 'failed', 'skipped'], default: 'skipped' },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const reminderSchema = new mongoose.Schema(
  {
    appointmentId: { type: String, required: true, unique: true },
    patientId: { type: String, required: true },
    patientEmail: { type: String },
    doctorName: { type: String },
    clinicName: { type: String },
    slot: { type: String, required: true },
    sendAt: { type: Date, required: true, index: true },
    sent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const Notification = mongoose.model('Notification', notificationSchema);
const Reminder = mongoose.model('Reminder', reminderSchema);

module.exports = { Notification, Reminder };
