/** Data layer: platform activity / audit log (admin_db), built from every domain event. */
const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true },
    type: { type: String, required: true, index: true },
    summary: { type: String, required: true },
    actor: { type: String },
    amount: { type: Number },
    data: { type: mongoose.Schema.Types.Mixed },
    occurredAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Activity', activitySchema);
