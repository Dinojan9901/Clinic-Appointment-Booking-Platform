/** Controller layer: HTTP routes for the Auth Service. */
const express = require('express');
const { register, login, me } = require('./controller');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', me);

module.exports = router;
