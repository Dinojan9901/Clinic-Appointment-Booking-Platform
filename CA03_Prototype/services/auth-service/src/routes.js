/** Controller layer: HTTP routes for the Auth Service. */
const express = require('express');
const c = require('./controller');

const router = express.Router();

router.post('/register', c.register);
router.post('/register-doctor', c.registerDoctor);
router.post('/login', c.login);
router.get('/me', c.me);
router.get('/users', c.listUsers);
router.patch('/users/:id/status', c.setUserStatus);
router.get('/doctors', c.listDoctors);
router.post('/doctors/:id/approve', c.approveDoctor);
router.post('/doctors/:id/reject', c.rejectDoctor);

module.exports = router;
