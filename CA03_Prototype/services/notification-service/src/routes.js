/** Controller layer: HTTP routes for the Notification Service. */
const express = require('express');
const Notification = require('./model');

const router = express.Router();

// GET /notifications/mine
router.get('/mine', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'not authenticated' });
    const items = await Notification.find({ userId }).sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
