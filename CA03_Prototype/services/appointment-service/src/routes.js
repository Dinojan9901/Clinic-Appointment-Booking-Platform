/** Controller layer: HTTP routes for the Appointment Service. */
const express = require('express');
const c = require('./controller');

const doctors = express.Router();
doctors.get('/', c.listDoctors);
doctors.get('/:id', c.getDoctor);

const appointments = express.Router();
appointments.post('/', c.bookAppointment);
appointments.get('/mine', c.myAppointments);
appointments.get('/doctor', c.doctorAppointments);
appointments.get('/:id', c.getAppointment);
appointments.post('/:id/cancel', c.cancelAppointment);

module.exports = { doctors, appointments };
