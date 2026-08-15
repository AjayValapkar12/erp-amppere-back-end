const mongoose = require('mongoose');

const paymentLedgerSchema = new mongoose.Schema({
  date: { type: Date, required: true, default: Date.now },
  
  // Transaction Type
  transactionType: { 
    type: String, 
    enum: ['Sales', 'Purchase'], 
    required: true,
    description: 'Sales = Credit (money received), Purchase = Debit (money paid)'
  },
  
  // Reference
  referenceModel: { 
    type: String, 
    enum: ['Invoice', 'PurchaseOrder'], 
    required: true 
  },
  referenceNumber: { type: String, required: true },
  reference: { type: mongoose.Schema.Types.ObjectId, required: true },
  
  // Party Details
  partyType: { 
    type: String, 
    enum: ['Customer', 'Vendor'], 
    required: true,
    description: 'Customer for Sales, Vendor for Purchase'
  },
  partyId: { type: mongoose.Schema.Types.ObjectId, required: true },
  partyName: { type: String, required: true },
  
  // Payment Details
  amount: { type: Number, required: true },
  paymentMethod: { 
    type: String, 
    enum: ['cash', 'bank_transfer', 'cheque', 'upi'], 
    required: true 
  },
  transactionId: String, // For bank transfer, UPI reference
  
  // Ledger Entries (Auto-calculated)
  debit: { type: Number, default: 0 },  // For Purchase payments (money out)
  credit: { type: Number, default: 0 }, // For Sales payments (money in)
  
  description: String,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now, index: true }
});

// Pre-save hook to auto-set debit/credit based on transaction type
paymentLedgerSchema.pre('save', function(next) {
  if (this.transactionType === 'Sales') {
    // Sales = Money coming IN = CREDIT
    this.credit = this.amount;
    this.debit = 0;
  } else if (this.transactionType === 'Purchase') {
    // Purchase = Money going OUT = DEBIT
    this.debit = this.amount;
    this.credit = 0;
  }
  next();
});

// Index for common queries
paymentLedgerSchema.index({ date: -1 });
paymentLedgerSchema.index({ transactionType: 1, date: -1 });
paymentLedgerSchema.index({ paymentMethod: 1, date: -1 });
paymentLedgerSchema.index({ partyId: 1, date: -1 });
paymentLedgerSchema.index({ transactionType: 1, paymentMethod: 1, date: -1 });

module.exports = mongoose.model('PaymentLedger', paymentLedgerSchema);
