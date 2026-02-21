const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  description:       { type: String, required: true },
  hsnCode:           { type: String, default: '8544' },
  quantity:          { type: Number, required: true },
  unit:              { type: String, default: 'Mtr' },
  rate:              { type: Number, required: true },
  amount:            { type: Number, required: true },
  gstRate:           { type: Number, default: 18 },
  gstAmount:         { type: Number, default: 0 },
  isDelivered:       { type: Boolean, default: false },
  deliveredDate:     { type: Date },
  deliveredQuantity: { type: Number, default: 0 },
});

const salesOrderSchema = new mongoose.Schema({
  orderNumber: { type: String, unique: true },
  customer:    { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  orderDate:   { type: Date, default: Date.now },
  deliveryDate:{ type: Date },
  items:       [orderItemSchema],
  subtotal:         { type: Number, default: 0 },
  totalGst:         { type: Number, default: 0 },
  totalAmount:      { type: Number, default: 0 },
  paidAmount:       { type: Number, default: 0 },
  outstandingAmount:{ type: Number, default: 0 },
  paymentStatus: {
    type: String,
    enum: ['pending', 'partial', 'paid'],
    default: 'pending',
  },
  deliveryStatus: {
    type: String,
    enum: ['pending', 'processing', 'dispatched', 'delivered'],
    default: 'pending',
  },
  notes:         { type: String },
  latestInvoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
  createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt:     { type: Date, default: Date.now },
});

salesOrderSchema.pre('save', async function (next) {
  // Auto-generate order number on first save
  if (!this.orderNumber) {
    const now      = new Date();
    const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const count    = await mongoose.model('SalesOrder').countDocuments();
    this.orderNumber = `SO${datePart}${String(count + 1).padStart(4, '0')}`;
  }

  // Always recompute outstanding and payment status from source of truth
  this.outstandingAmount = Math.max(0, this.totalAmount - this.paidAmount);

  if (this.paidAmount >= this.totalAmount && this.totalAmount > 0) {
    this.paymentStatus = 'paid';
  } else if (this.paidAmount > 0) {
    this.paymentStatus = 'partial';
  } else {
    this.paymentStatus = 'pending';
  }

  // Auto-update delivery status based on items
  const allDelivered = this.items.length > 0 && this.items.every(i => i.isDelivered);
  const anyDelivered = this.items.some(i => i.isDelivered);
  if (allDelivered)      this.deliveryStatus = 'delivered';
  else if (anyDelivered) this.deliveryStatus = 'dispatched';

  next();
});

module.exports = mongoose.model('SalesOrder', salesOrderSchema);