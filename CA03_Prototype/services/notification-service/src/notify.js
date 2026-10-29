/**
 * Delivery: stores the in-app notification (idempotent by key) and sends the
 * email through SMTP (Mailpit in the demo). SMS is mocked in the log.
 */
const nodemailer = require('nodemailer');
const { Notification } = require('./model');

const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'localhost',
  port: Number(process.env.SMTP_PORT || 1025),
  secure: false,
  tls: { rejectUnauthorized: false },
});
const FROM = process.env.MAIL_FROM || 'MediConnect <no-reply@mediconnect.lk>';

async function notify({ key, userId, email, type, subject, message }) {
  let doc;
  try {
    doc = await Notification.create({ key, userId, email, type, message });
  } catch (err) {
    if (err.code === 11000) return;
    throw err;
  }
  console.log(`[notification-service] (in-app/sms) -> ${email || userId}: ${message}`);
  if (!email) return;
  try {
    await transport.sendMail({ from: FROM, to: email, subject: `MediConnect - ${subject}`, text: `${message}\n\n- MediConnect` });
    await Notification.updateOne({ _id: doc._id }, { $set: { emailStatus: 'sent' } });
  } catch (err) {
    console.warn(`[notification-service] email to ${email} failed: ${err.message}`);
    await Notification.updateOne({ _id: doc._id }, { $set: { emailStatus: 'failed' } });
  }
}

module.exports = { notify };
