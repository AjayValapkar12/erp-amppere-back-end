const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  type: { type: String, required: true },
  normalBalance: { type: String, enum: ['Debit', 'Credit'], required: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Account', accountSchema);
