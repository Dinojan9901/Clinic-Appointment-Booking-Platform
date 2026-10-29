/** Business-logic layer: checkout (Saga step 2), receipts and payment administration. */
const crypto = require('crypto');
const Payment = require('./model');
const provider = require('./provider');
const { renderReceipt } = require('./receipt');
const { outboxEvent } = require('../common/messaging');
const { identityHeaders, requireRole, httpError } = require('../common/service');

const APPOINTMENT_URL = process.env.APPOINTMENT_URL || 'http://localhost:4002';
let kick = () => {};
const onEventsQueued = (fn) => (kick = fn);

function receiptNumber() {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `RCPT-${day}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function paymentPayload(p, extra = {}) {
  return {
    paymentId: p._id.toString(),
    appointmentId: p.appointmentId,
    patientId: p.patientId,
    patientName: p.patientName,
    patientEmail: p.patientEmail,
    doctorName: p.doctorName,
    clinicName: p.clinicName,
    slot: p.slot,
    amount: p.amount,
    currency: p.currency,
    receiptNo: p.receiptNo,
    ...extra,
  };
}

async function fetchAppointment(req, appointmentId) {
  let resp;
  try {
    resp = await fetch(`${APPOINTMENT_URL}/appointments/${encodeURIComponent(appointmentId)}`, {
      headers: identityHeaders(req),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    throw httpError(503, 'cannot reach the Appointment Service right now; please try again');
  }
  if (resp.status === 404 || resp.status === 400) throw httpError(404, 'appointment not found');
  if (resp.status === 403) throw httpError(403, 'this is not your appointment');
  if (!resp.ok) throw httpError(502, `appointment lookup failed (${resp.status})`);
  return resp.json();
}

// POST /payments  { appointmentId, cardNumber, expMonth, expYear, cvc }  Idempotency-Key header optional
async function pay(req, res, next) {
  try {
    const who = requireRole(req, 'patient');
    const idempotencyKey = (req.get('Idempotency-Key') || '').slice(0, 100) || undefined;
    if (idempotencyKey) {
      const previous = await Payment.findOne({ idempotencyKey, patientId: who.userId });
      if (previous) return res.status(previous.status === 'failed' ? 402 : 200).json(previous);
    }
    const { appointmentId } = req.body || {};
    if (typeof appointmentId !== 'string' || !appointmentId) throw httpError(400, 'appointmentId is required');

    const appt = await fetchAppointment(req, appointmentId);
    if (appt.patientId !== who.userId) throw httpError(403, 'this is not your appointment');
    if (appt.status !== 'pending_payment') throw httpError(409, `appointment is ${appt.status.replace('_', ' ')}; nothing to pay`);
    if (!appt.holdExpiresAt || new Date(appt.holdExpiresAt).getTime() <= Date.now()) throw httpError(409, 'the slot hold has expired; please book again');

    const card = provider.validateCard(req.body);
    if (card.error) throw httpError(400, card.error);

    let payment;
    try {
      payment = await Payment.create({
        appointmentId,
        patientId: who.userId,
        patientName: appt.patientName,
        patientEmail: appt.patientEmail || who.email,
        doctorName: appt.doctorName,
        clinicName: appt.clinicName,
        slot: appt.slot,
        amount: appt.fee,
        status: 'processing',
        active: true,
        cardBrand: card.brand,
        cardLast4: card.last4,
        idempotencyKey,
      });
    } catch (err) {
      if (err.code === 11000) throw httpError(409, 'this appointment is already paid or a payment is in progress');
      throw err;
    }

    const result = await provider.charge(card, payment.amount);
    if (result.approved) {
      const receiptNo = receiptNumber();
      payment = await Payment.findByIdAndUpdate(
        payment._id,
        {
          $set: { status: 'succeeded', providerRef: result.providerRef, receiptNo },
          $push: { pendingEvents: outboxEvent('payment.succeeded', paymentPayload({ ...payment.toObject(), receiptNo })) },
        },
        { new: true }
      );
      kick();
      return res.status(201).json(payment);
    }
    payment = await Payment.findByIdAndUpdate(
      payment._id,
      {
        $set: { status: 'failed', providerRef: result.providerRef, failureReason: result.reason },
        $unset: { active: 1 },
        $push: { pendingEvents: outboxEvent('payment.failed', paymentPayload(payment, { reason: result.reason })) },
      },
      { new: true }
    );
    kick();
    res.status(402).json({ ...payment.toJSON(), error: `payment declined (${result.reason.replace('_', ' ')})` });
  } catch (err) {
    next(err);
  }
}

// GET /payments/mine
async function myPayments(req, res, next) {
  try {
    const { userId } = requireRole(req);
    res.json(await Payment.find({ patientId: userId, status: { $ne: 'processing' } }).sort({ createdAt: -1 }));
  } catch (err) {
    next(err);
  }
}

// GET /payments/:id/receipt  (PDF; owner or admin)
async function receipt(req, res, next) {
  try {
    const { userId, role } = requireRole(req);
    const payment = await Payment.findById(req.params.id);
    if (!payment || (payment.patientId !== userId && role !== 'admin')) throw httpError(404, 'payment not found');
    if (!['succeeded', 'refunded'].includes(payment.status)) throw httpError(409, 'receipts exist only for successful payments');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${payment.receiptNo}.pdf"`);
    renderReceipt(payment, res);
  } catch (err) {
    next(err);
  }
}

// GET /payments  (admin: all payments + totals)
async function allPayments(req, res, next) {
  try {
    requireRole(req, 'admin');
    const payments = await Payment.find({ status: { $ne: 'processing' } }).sort({ createdAt: -1 }).limit(200);
    const sum = async (status) =>
      (await Payment.aggregate([{ $match: { status } }, { $group: { _id: null, total: { $sum: '$amount' } } }]))[0]?.total || 0;
    const succeeded = await sum('succeeded');
    const refunded = await sum('refunded');
    res.json({
      payments,
      totals: { collected: succeeded + refunded, refunded, net: succeeded, failed: await Payment.countDocuments({ status: 'failed' }) },
    });
  } catch (err) {
    next(err);
  }
}

async function refund(filter, reason) {
  const payment = await Payment.findOne({ ...filter, status: 'succeeded' });
  if (!payment) return false;
  const refunded = await Payment.findOneAndUpdate(
    { _id: payment._id, status: 'succeeded' },
    {
      $set: { status: 'refunded', refundedAt: new Date(), refundReason: reason },
      $unset: { active: 1 },
      $push: { pendingEvents: outboxEvent('payment.refunded', paymentPayload(payment, { reason })) },
    }
  );
  return !!refunded;
}

async function failStuckPayments() {
  const cutoff = new Date(Date.now() - 2 * 60000);
  await Payment.updateMany(
    { status: 'processing', createdAt: { $lt: cutoff } },
    { $set: { status: 'failed', failureReason: 'provider_timeout' }, $unset: { active: 1 } }
  );
}

module.exports = { onEventsQueued, pay, myPayments, receipt, allPayments, refund, failStuckPayments };
