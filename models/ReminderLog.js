const mongoose = require('mongoose');

const reminderLogSchema = new mongoose.Schema({
  type: { type: String, required: true },
  runKey: { type: String, required: true, unique: true },
  sentAt: { type: Date, default: Date.now },
  recipient: { type: String, default: '' },
  customerCount: { type: Number, default: 0 }
});

module.exports = mongoose.models.ReminderLog || mongoose.model('ReminderLog', reminderLogSchema);
