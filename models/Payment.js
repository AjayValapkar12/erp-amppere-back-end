const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  type: { type: String, enum: ['received', 'made'], required: true },
  reference: { type: mongoose.Schema.Types.ObjectId, refPath: 'referenceModel' },
  referenceModel: { type: String, enum: ['SalesOrder', 'PurchaseOrder'] },
  referenceNumber: { type: String },
  party: { type: mongoose.Schema.Types.ObjectId, refPath: 'partyModel' },
  partyModel: { type: String, enum: ['Customer', 'Vendor'] },
  partyName: { type: String },
  amount: { type: Number, required: true },
  paymentDate: { type: Date, default: Date.now },
  paymentMethod: { type: String, enum: ['cash', 'bank_transfer', 'cheque', 'upi'], default: 'bank_transfer' },
  transactionId: { type: String },
  notes: { type: String },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Payment', paymentSchema);
