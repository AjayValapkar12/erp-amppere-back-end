const mongoose = require('mongoose');

const ledgerEntrySchema = new mongoose.Schema({
  date: { type: Date, required: true, default: Date.now },
  account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  referenceModel: { type: String, enum: ['SalesOrder', 'PurchaseOrder', 'Payment', 'Invoice'], required: true },
  reference: { type: mongoose.Schema.Types.ObjectId, required: true },
  referenceNumber: { type: String },
  paymentMethod: { type: String, enum: ['cash', 'bank_transfer', 'cheque', 'upi'] },
  transactionId: { type: String },
  description: { type: String, required: true },
  debit: { type: Number, default: 0 },
  credit: { type: Number, default: 0 },
  balanceType: { type: String, enum: ['Dr', 'Cr'], required: true },
  party: { type: mongoose.Schema.Types.ObjectId, refPath: 'partyModel' },
  partyModel: { type: String, enum: ['Customer', 'Vendor'] },
  partyName: { type: String },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('LedgerEntry', ledgerEntrySchema);
