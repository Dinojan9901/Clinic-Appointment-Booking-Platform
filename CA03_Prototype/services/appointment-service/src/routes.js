/** Controller layer: HTTP routes for the Appointment Service. */
const express = require('express');
const clinics = require('./clinics');
const doctors = require('./doctors');
const appts = require('./appointments');

const clinicRoutes = express.Router();
clinicRoutes.get('/', clinics.listClinics);
clinicRoutes.get('/:id', clinics.getClinic);
clinicRoutes.post('/', clinics.createClinic);
clinicRoutes.put('/:id', clinics.updateClinic);

const doctorRoutes = express.Router();
doctorRoutes.get('/', doctors.listDoctors);
doctorRoutes.get('/all', doctors.listAllDoctors);
doctorRoutes.get('/me', doctors.myProfile);
doctorRoutes.post('/me/slots', doctors.addSlot);
doctorRoutes.delete('/me/slots/:slot', doctors.removeSlot);
doctorRoutes.get('/:id', doctors.getDoctor);
doctorRoutes.get('/:id/reviews', doctors.doctorReviews);

const appointmentRoutes = express.Router();
appointmentRoutes.post('/', appts.bookAppointment);
appointmentRoutes.get('/mine', appts.myAppointments);
appointmentRoutes.get('/doctor', appts.doctorAppointments);
appointmentRoutes.get('/all', appts.allAppointments);
appointmentRoutes.get('/:id', appts.getAppointment);
appointmentRoutes.post('/:id/complete', appts.completeAppointment);
appointmentRoutes.post('/:id/cancel', appts.cancelAppointment);
appointmentRoutes.post('/:id/reschedule', appts.rescheduleAppointment);
appointmentRoutes.post('/:id/review', appts.reviewAppointment);

module.exports = { clinicRoutes, doctorRoutes, appointmentRoutes };
