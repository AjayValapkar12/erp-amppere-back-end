const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  name:          { type: String, required: true },
  email:         { type: String },
  phone:         { type: String },
  contactPerson: { type: String },
  billingAddress: {
    street:  String,
    city:    String,
    state:   String,
    pincode: String,
    country: { type: String, default: 'India' },
  },
  deliveryAddress: {
    street:  String,
    city:    String,
    state:   String,
    pincode: String,
    country: { type: String, default: 'India' },
  },
  gstNumber:          { type: String },
  outstandingBalance: { type: Number, default: 0 },
  status:             { type: String, enum: ['active', 'inactive'], default: 'active' },
  createdAt:          { type: Date, default: Date.now },
});

module.exports = mongoose.model('Customer', customerSchema);