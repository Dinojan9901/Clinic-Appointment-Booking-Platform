/** Controller layer: HTTP routes for the Payment Service. */
const express = require('express');
const c = require('./controller');

const router = express.Router();
router.post('/', c.pay);
router.get('/', c.allPayments);
router.get('/mine', c.myPayments);
router.get('/:id/receipt', c.receipt);

module.exports = router;
