/** Controller layer: HTTP routes for the Records Service. */
const express = require('express');
const c = require('./controller');

const router = express.Router();
router.get('/mine', c.myRecords);
router.get('/doctor', c.doctorRecords);
router.put('/:id', c.completeRecord);

module.exports = router;
