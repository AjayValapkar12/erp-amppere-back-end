const mongoose = require('mongoose');

const purchaseItemSchema = new mongoose.Schema({
  description: { type: String, required: true },
  hsnCode: { type: String },
  quantity: { type: Number, required: true },
  unit: { type: String, default: 'Kg' },
  rate: { type: Number, required: true },
  amount: { type: Number, required: true },
  gstRate: { type: Number, default: 18 },
  gstAmount: { type: Number, default: 0 }
});

const purchaseOrderSchema = new mongoose.Schema({
  orderNumber: { type: String, unique: true },
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
  orderDate: { type: Date, default: Date.now },
  expectedDate: { type: Date },
  items: [purchaseItemSchema],
  subtotal: { type: Number, default: 0 },
  totalGst: { type: Number, default: 0 },
  totalAmount: { type: Number, default: 0 },
  paidAmount: { type: Number, default: 0 },
  outstandingAmount: { type: Number, default: 0 },
  paymentStatus: { type: String, enum: ['pending', 'partial', 'paid'], default: 'pending' },
  status: { type: String, enum: ['pending', 'confirmed', 'received', 'cancelled'], default: 'pending' },
  notes: { type: String },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

purchaseOrderSchema.pre('save', async function(next) {
  if (!this.orderNumber) {
    const now = new Date();
    const datePart = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
    const count = await mongoose.model('PurchaseOrder').countDocuments();
    this.orderNumber = `PO${datePart}${String(count + 1).padStart(4, '0')}`;
  }
  this.outstandingAmount = this.totalAmount - this.paidAmount;
  if (this.paidAmount >= this.totalAmount) this.paymentStatus = 'paid';
  else if (this.paidAmount > 0) this.paymentStatus = 'partial';
  else this.paymentStatus = 'pending';
  next();
});

module.exports = mongoose.model('PurchaseOrder', purchaseOrderSchema);