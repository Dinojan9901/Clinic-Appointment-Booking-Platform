/** Renders a signed e-prescription as a PDF with a verification QR code. */
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const PUBLIC_URL = process.env.PUBLIC_URL || 'http://localhost:3000';

async function renderPrescription(record, out) {
  const verifyUrl = `${PUBLIC_URL}/verify/${record.prescriptionCode}`;
  const qr = await QRCode.toBuffer(verifyUrl, { margin: 1, width: 110 });
  const doc = new PDFDocument({ size: 'A5', margin: 40 });
  doc.pipe(out);

  doc.fontSize(18).fillColor('#14345f').text('MediConnect', 40, 40).fontSize(10).fillColor('#6b7688').text('Digital Prescription');
  doc.image(qr, 300, 34, { width: 80 });
  doc.moveTo(40, 120).lineTo(380, 120).strokeColor('#dfe4ec').stroke();
  doc.y = 132;

  const row = (label, value) => {
    doc.fontSize(10).fillColor('#6b7688').text(label, 40, doc.y, { continued: true }).fillColor('#1f2733').text(`  ${value || '-'}`);
    doc.moveDown(0.25);
  };
  row('Prescription no.', record.prescriptionCode);
  row('Patient', record.patientName);
  row('Doctor', record.doctorName);
  row('Clinic', record.clinicName);
  row('Visit', record.visitDate);

  doc.moveDown(0.6).fontSize(12).fillColor('#14345f').text('Rx', 40);
  doc.moveDown(0.2).fontSize(10).fillColor('#1f2733');
  if (record.prescription.length === 0) doc.text('No medication prescribed.', 40);
  record.prescription.forEach((p, i) => doc.text(`${i + 1}. ${p.medication}${p.dosage ? ` - ${p.dosage}` : ''}`, 40));

  doc.moveDown(0.6).fontSize(12).fillColor('#14345f').text('Notes', 40);
  doc.moveDown(0.2).fontSize(10).fillColor('#1f2733').text(record.notes, 40, doc.y, { width: 340 });

  doc.moveDown(1).fontSize(8).fillColor('#6b7688');
  doc.text(`Digitally signed (Ed25519) by ${record.doctorName} on ${new Date(record.signedAt).toLocaleString('en-GB', { timeZone: 'Asia/Colombo' })}.`, 40);
  doc.text(`Verify: ${verifyUrl}`, 40);
  doc.text(`Signature: ${record.signature.slice(0, 44)}...`, 40);
  doc.end();
}

module.exports = { renderPrescription };
