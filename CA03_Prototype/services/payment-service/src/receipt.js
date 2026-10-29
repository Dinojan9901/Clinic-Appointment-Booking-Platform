/** Renders a payment receipt as a PDF stream. */
const PDFDocument = require('pdfkit');

function renderReceipt(payment, out) {
  const doc = new PDFDocument({ size: 'A5', margin: 40 });
  doc.pipe(out);
  doc.fontSize(18).fillColor('#14345f').text('MediConnect', { continued: true }).fontSize(11).fillColor('#6b7688').text('  Payment Receipt');
  doc.moveDown(0.4).strokeColor('#dfe4ec').moveTo(40, doc.y).lineTo(380, doc.y).stroke().moveDown(0.8);

  const row = (label, value) => {
    doc.fontSize(10).fillColor('#6b7688').text(label, { continued: true }).fillColor('#1f2733').text(`  ${value ?? '-'}`);
    doc.moveDown(0.25);
  };
  row('Receipt no.', payment.receiptNo);
  row('Date', new Date(payment.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Colombo' }));
  row('Patient', payment.patientName);
  row('Doctor', payment.doctorName);
  row('Clinic', payment.clinicName);
  row('Appointment', payment.slot);
  row('Paid with', `${payment.cardBrand} **** ${payment.cardLast4}`);
  row('Provider ref.', payment.providerRef);
  doc.moveDown(0.6).fontSize(14).fillColor('#14345f').text(`Amount: ${payment.currency} ${payment.amount.toFixed(2)}`);
  if (payment.status === 'refunded') {
    doc.moveDown(0.4).fontSize(11).fillColor('#c0392b').text(`REFUNDED on ${new Date(payment.refundedAt).toLocaleDateString('en-GB')} (${payment.refundReason || 'cancelled'})`);
  }
  doc.moveDown(1.2).fontSize(8).fillColor('#6b7688').text('Simulated payment for the EC8208 prototype - no real money was charged.');
  doc.end();
}

module.exports = { renderReceipt };
