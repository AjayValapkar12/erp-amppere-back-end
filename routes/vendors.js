const express = require('express');
const router = express.Router();
const Vendor = require('../models/Vendor');
const PurchaseOrder = require('../models/PurchaseOrder');
const Payment = require('../models/Payment');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    let query = {};
    if (search) query.name = { $regex: search, $options: 'i' };
    const vendors = await Vendor.find(query).sort('-createdAt');
    res.json({ success: true, data: vendors });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
    res.json({ success: true, data: vendor });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Get all outstanding purchase orders for a vendor
router.get('/:id/orders', async (req, res) => {
  try {
    const orders = await PurchaseOrder.find({
      vendor: req.params.id,
      paymentStatus: { $in: ['pending', 'partial'] }
    }).sort('createdAt');
    res.json({ success: true, data: orders });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const vendor = await Vendor.create(req.body);
    res.status(201).json({ success: true, data: vendor });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const vendor = await Vendor.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
    res.json({ success: true, data: vendor });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await Vendor.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Vendor deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/**
 * POST /vendors/:id/payment
 * Records a payment against a vendor and applies it to their
 * outstanding purchase orders (oldest first), keeping everything in sync.
 */
router.post('/:id/payment', async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });

    const { amount, paymentMethod, transactionId, notes, paymentDate } = req.body;
    let remaining = parseFloat(amount);

    if (!remaining || remaining <= 0)
      return res.status(400).json({ success: false, message: 'Enter a valid amount' });
    if (remaining > vendor.outstandingBalance)
      return res.status(400).json({ success: false, message: 'Payment exceeds vendor outstanding balance' });

    // Fetch unpaid/partial orders for this vendor, oldest first
    const orders = await PurchaseOrder.find({
      vendor: req.params.id,
      paymentStatus: { $in: ['pending', 'partial'] }
    }).sort('createdAt');

    const updatedOrders = [];

    for (const order of orders) {
      if (remaining <= 0) break;

      const applyAmount = Math.min(remaining, order.outstandingAmount);
      order.paidAmount += applyAmount;
      order.outstandingAmount -= applyAmount;
      remaining -= applyAmount;

      if (order.outstandingAmount <= 0) {
        order.outstandingAmount = 0;
        order.paymentStatus = 'paid';
      } else {
        order.paymentStatus = 'partial';
      }

      await order.save();
      updatedOrders.push(order);

      // Create an individual payment record per order settled
      await Payment.create({
        type: 'made',
        reference: order._id,
        referenceModel: 'PurchaseOrder',
        referenceNumber: order.orderNumber,
        party: vendor._id,
        partyModel: 'Vendor',
        partyName: vendor.name,
        amount: applyAmount,
        paymentMethod,
        transactionId,
        notes,
        paymentDate: paymentDate || new Date(),
        createdBy: req.user._id,
      });
    }

    // Deduct total paid from vendor outstanding balance
    const totalPaid = parseFloat(amount) - remaining; // remaining should be 0 unless orders < balance
    vendor.outstandingBalance -= totalPaid;
    if (vendor.outstandingBalance < 0) vendor.outstandingBalance = 0;
    await vendor.save();

    res.json({
      success: true,
      data: vendor,
      updatedOrders,
      message: `Payment of ₹${totalPaid.toFixed(2)} recorded and applied to ${updatedOrders.length} order(s)`,
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;