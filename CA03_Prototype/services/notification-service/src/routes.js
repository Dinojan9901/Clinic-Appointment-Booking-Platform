/** Controller layer: HTTP routes for the Notification Service. */
const express = require('express');
const { Notification } = require('./model');
const { requireRole } = require('../common/service');

const router = express.Router();

const mine = (req) => {
  const { userId, email } = requireRole(req);
  return email ? { $or: [{ userId }, { email }] } : { userId };
};

// GET /notifications/mine
router.get('/mine', async (req, res, next) => {
  try {
    res.json(await Notification.find(mine(req)).sort({ createdAt: -1 }).limit(100));
  } catch (err) {
    next(err);
  }
});

// POST /notifications/mine/read
router.post('/mine/read', async (req, res, next) => {
  try {
    const result = await Notification.updateMany({ ...mine(req), read: false }, { $set: { read: true } });
    res.json({ updated: result.modifiedCount });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
