/** Controller layer: HTTP routes for the Records Service. */
const express = require('express');
const c = require('./controller');

const records = express.Router();
records.get('/mine', c.myRecords);
records.get('/doctor', c.doctorRecords);
records.get('/patient/:patientId', c.patientHistory);
records.get('/:id/prescription', c.prescriptionPdf);
records.put('/:id', c.completeRecord);

const prescriptions = express.Router();
prescriptions.get('/public-key', c.publicKey);
prescriptions.get('/verify/:code', c.verifyPrescription);

module.exports = { records, prescriptions };
