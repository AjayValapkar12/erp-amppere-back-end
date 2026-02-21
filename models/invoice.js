const mongoose = require('mongoose');

const invoiceItemSchema = new mongoose.Schema({
  soItemId:     { type: String, default: '' },  // ref to SalesOrder item _id for syncing
  description:  { type: String, required: true },
  hsnCode:      { type: String, default: '8544' },
  uom:          { type: String, default: 'METER' },
  quantity:     { type: Number, required: true },
  rate:         { type: Number, required: true },
  totalValue:   { type: Number, required: true },
  discount:     { type: Number, default: 0 },
  taxableValue: { type: Number, required: true },
  gstRate:      { type: Number, default: 18 },
  cgstRate:     { type: Number, default: 0 },
  cgstAmount:   { type: Number, default: 0 },
  sgstRate:     { type: Number, default: 0 },
  sgstAmount:   { type: Number, default: 0 },
  igstRate:     { type: Number, default: 18 },
  igstAmount:   { type: Number, default: 0 },
});

const invoiceSchema = new mongoose.Schema({
  invoiceNumber:         { type: String, unique: true },
  salesOrder:            { type: mongoose.Schema.Types.ObjectId, ref: 'SalesOrder' },
  invoiceDate:           { type: Date, default: Date.now },
  dateOfSupply:          { type: Date, default: Date.now },
  poNumber:              { type: String, default: '' },
  poDate:                { type: Date },
  saleWithinMaharashtra: { type: Boolean, default: false },
  transporterName:       { type: String, default: '' },
  lrNo:                  { type: String, default: '' },
  vehicleNo:             { type: String, default: '' },
  lrDate:                { type: Date },
  billedTo: {
    name:      { type: String, default: '' },
    address:   { type: String, default: '' },
    stateCode: { type: String, default: '' },
    gstNumber: { type: String, default: '' },
    contact:   { type: String, default: '' },
  },
  deliveryAt: {
    name:    { type: String, default: '' },
    address: { type: String, default: '' },
    contact: { type: String, default: '' },
  },
  items:            [invoiceItemSchema],
  subtotal:         { type: Number, default: 0 },
  totalGst:         { type: Number, default: 0 },
  totalAmount:      { type: Number, default: 0 },
  freightCharges:   { type: String, default: 'nil' },
  packingCharges:   { type: String, default: 'nil' },
  insuranceCharges: { type: String, default: 'nil' },
  otherCharges:     { type: String, default: 'nil' },
  specialRemark:    { type: String, default: '' },
  createdBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt:        { type: Date, default: Date.now },
  updatedAt:        { type: Date, default: Date.now },
});

invoiceSchema.pre('save', async function (next) {
  if (!this.invoiceNumber) {
    const now      = new Date();
    const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const count    = await mongoose.model('Invoice').countDocuments();
    this.invoiceNumber = `INV${datePart}${String(count + 1).padStart(4, '0')}`;
  }
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.models.Invoice || mongoose.model('Invoice', invoiceSchema);
