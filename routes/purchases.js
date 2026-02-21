const express = require('express');
const router = express.Router();
const PurchaseOrder = require('../models/PurchaseOrder');
const Vendor = require('../models/Vendor');
const Payment = require('../models/Payment');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/', async (req, res) => {
  try {
    const { search, status } = req.query;
    let query = {};
    if (status) query.paymentStatus = status;
    let orders = await PurchaseOrder.find(query).populate('vendor', 'name phone').sort('-createdAt');
    if (search) {
      orders = orders.filter(o =>
        o.orderNumber.toLowerCase().includes(search.toLowerCase()) ||
        (o.vendor && o.vendor.name.toLowerCase().includes(search.toLowerCase()))
      );
    }
    res.json({ success: true, data: orders });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const order = await PurchaseOrder.findById(req.params.id).populate('vendor');
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, data: order });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const orderData = { ...req.body, createdBy: req.user._id };
    let subtotal = 0, totalGst = 0;
    orderData.items = orderData.items.map(item => {
      const amount = item.quantity * item.rate;
      const gstAmount = (amount * item.gstRate) / 100;
      subtotal += amount;
      totalGst += gstAmount;
      return { ...item, amount, gstAmount };
    });
    orderData.subtotal = subtotal;
    orderData.totalGst = totalGst;
    orderData.totalAmount = subtotal + totalGst;
    orderData.outstandingAmount = orderData.totalAmount;
    const order = await PurchaseOrder.create(orderData);
    await Vendor.findByIdAndUpdate(order.vendor, { $inc: { outstandingBalance: order.totalAmount } });
    res.status(201).json({ success: true, data: order });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const orderData = req.body;
    if (orderData.items) {
      let subtotal = 0, totalGst = 0;
      orderData.items = orderData.items.map(item => {
        const amount = item.quantity * item.rate;
        const gstAmount = (amount * item.gstRate) / 100;
        subtotal += amount; totalGst += gstAmount;
        return { ...item, amount, gstAmount };
      });
      orderData.subtotal = subtotal; orderData.totalGst = totalGst;
      orderData.totalAmount = subtotal + totalGst;
    }
    const order = await PurchaseOrder.findByIdAndUpdate(req.params.id, orderData, { new: true }).populate('vendor');
    res.json({ success: true, data: order });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const order = await PurchaseOrder.findByIdAndDelete(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, message: 'Order deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/:id/payment', async (req, res) => {
  try {
    const order = await PurchaseOrder.findById(req.params.id).populate('vendor');
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const { amount, paymentMethod, transactionId, notes, paymentDate } = req.body;
    const payAmount = parseFloat(amount);
    if (payAmount > order.outstandingAmount) return res.status(400).json({ success: false, message: 'Payment exceeds outstanding' });
    order.paidAmount += payAmount;
    order.outstandingAmount -= payAmount;
    if (order.outstandingAmount <= 0) order.paymentStatus = 'paid';
    else if (order.paidAmount > 0) order.paymentStatus = 'partial';
    await order.save();
    await Vendor.findByIdAndUpdate(order.vendor._id, { $inc: { outstandingBalance: -payAmount } });
    await Payment.create({
      type: 'made', reference: order._id, referenceModel: 'PurchaseOrder',
      referenceNumber: order.orderNumber, party: order.vendor._id, partyModel: 'Vendor',
      partyName: order.vendor.name, amount: payAmount, paymentMethod, transactionId, notes,
      paymentDate: paymentDate || new Date(), createdBy: req.user._id
    });
    res.json({ success: true, data: order, message: 'Payment recorded' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
