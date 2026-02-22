const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const SalesOrder = require('../models/SalesOrder');
const Payment = require('../models/Payment');
const { protect } = require('../middleware/auth');

router.use(protect);

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANT: All specific routes MUST be registered before generic /:id routes
// ─────────────────────────────────────────────────────────────────────────────

// POST sync all customer outstanding balances from their actual orders
router.post('/sync-balances', async (req, res) => {
  try {
    const customers = await Customer.find();
    for (const customer of customers) {
      const orders      = await SalesOrder.find({ customer: customer._id });
      const outstanding = orders.reduce((sum, o) => sum + (o.outstandingAmount || 0), 0);
      await Customer.findByIdAndUpdate(customer._id, { outstandingBalance: outstanding });
    }
    res.json({ success: true, message: 'Balances synced successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET all customers
router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    let query = {};
    if (search) query.name = { $regex: search, $options: 'i' };
    const customers = await Customer.find(query).sort('-createdAt');
    res.json({ success: true, data: customers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET customer ledger (outstanding sales orders) — before /:id
router.get('/:id/ledger', async (req, res) => {
  try {
    const orders = await SalesOrder.find({ customer: req.params.id }).sort('-orderDate');
    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET single customer
router.get('/:id', async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
    res.json({ success: true, data: customer });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST create customer
router.post('/', async (req, res) => {
  try {
    const customer = await Customer.create(req.body);
    res.status(201).json({ success: true, data: customer });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT update customer
router.put('/:id', async (req, res) => {
  try {
    const customer = await Customer.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
    res.json({ success: true, data: customer });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE customer
router.delete('/:id', async (req, res) => {
  try {
    const customer = await Customer.findByIdAndDelete(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
    res.json({ success: true, message: 'Customer deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /customers/:id/payment
 * Records money received from a customer and applies it to their
 * outstanding sales orders (oldest first), keeping everything in sync.
 */
router.post('/:id/payment', async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    const { amount, paymentMethod, transactionId, notes, paymentDate } = req.body;
    let remaining = parseFloat(amount);

    if (!remaining || remaining <= 0)
      return res.status(400).json({ success: false, message: 'Enter a valid amount' });
    if (remaining > customer.outstandingBalance)
      return res.status(400).json({ success: false, message: 'Amount exceeds customer outstanding balance' });

    // Fetch unpaid/partial sales orders oldest first
    const orders = await SalesOrder.find({
      customer: req.params.id,
      paymentStatus: { $in: ['pending', 'partial'] },
    }).sort('createdAt');

    const updatedOrders = [];

    for (const order of orders) {
      if (remaining <= 0) break;

      const applyAmount = Math.min(remaining, order.outstandingAmount);
      order.paidAmount        += applyAmount;
      order.outstandingAmount -= applyAmount;
      remaining               -= applyAmount;

      if (order.outstandingAmount <= 0) {
        order.outstandingAmount = 0;
        order.paymentStatus = 'paid';
      } else {
        order.paymentStatus = 'partial';
      }

      await order.save();
      updatedOrders.push(order);

      // Payment record per order settled
      await Payment.create({
        type:            'received',
        reference:       order._id,
        referenceModel:  'SalesOrder',
        referenceNumber: order.orderNumber,
        party:           customer._id,
        partyModel:      'Customer',
        partyName:       customer.name,
        amount:          applyAmount,
        paymentMethod,
        transactionId,
        notes,
        paymentDate:     paymentDate || new Date(),
        createdBy:       req.user._id,
      });
    }

    // Deduct from customer outstanding balance
    const totalReceived = parseFloat(amount) - remaining;
    customer.outstandingBalance -= totalReceived;
    if (customer.outstandingBalance < 0) customer.outstandingBalance = 0;
    await customer.save();

    res.json({
      success:       true,
      data:          customer,
      updatedOrders,
      message:       `Payment of ₹${totalReceived.toFixed(2)} received and applied to ${updatedOrders.length} order(s)`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;