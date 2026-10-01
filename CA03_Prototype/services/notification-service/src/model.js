/** Data layer: Notification model (notification_db). */
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    // Source event id: unique, so a redelivered event can't notify twice.
    eventId: { type: String, unique: true, sparse: true },
    type: { type: String, default: 'appointment' },
    message: { type: String, required: true },
    channel: { type: String, default: 'email/sms' },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Notification', notificationSchema);
