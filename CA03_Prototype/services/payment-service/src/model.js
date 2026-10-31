/** Data layer: Payment model (payment_db). Raw card numbers and CVCs are never stored. */
const mongoose = require('mongoose');
const { outboxSchema } = require('../common/messaging');

const paymentSchema = new mongoose.Schema(
  {
    appointmentId: { type: String, required: true },
    patientId: { type: String, required: true, index: true },
    patientName: { type: String },
    patientEmail: { type: String },
    doctorName: { type: String },
    clinicName: { type: String },
    slot: { type: String },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'LKR' },
    status: { type: String, enum: ['processing', 'succeeded', 'failed', 'refunded'], required: true, index: true },
    active: { type: Boolean },
    cardBrand: { type: String },
    cardLast4: { type: String },
    providerRef: { type: String },
    failureReason: { type: String },
    receiptNo: { type: String },
    idempotencyKey: { type: String, unique: true, sparse: true },
    refundedAt: { type: Date },
    refundReason: { type: String },
    pendingEvents: { type: [outboxSchema], default: [] },
  },
  { timestamps: true }
);

paymentSchema.index({ appointmentId: 1 }, { unique: true, partialFilterExpression: { active: true }, name: 'one_active_payment_per_appointment' });
paymentSchema.index({ appointmentId: 1, status: 1 });

paymentSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.pendingEvents;
    delete ret.active;
    delete ret.idempotencyKey;
    return ret;
  },
});

module.exports = mongoose.model('Payment', paymentSchema);
