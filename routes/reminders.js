const express = require('express');
const { protect } = require('../middleware/auth');
const { sendOutstandingReminder } = require('../services/outstandingReminder');

const router = express.Router();

router.use(protect);

router.post('/outstanding/send', async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admin can send reminders.' });
    }

    const result = await sendOutstandingReminder({ force: true });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
