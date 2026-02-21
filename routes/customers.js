const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const SalesOrder = require('../models/SalesOrder');
const { protect } = require('../middleware/auth');

router.use(protect);

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANT: All specific routes (sync-balances, etc.) MUST be registered
// before generic /:id routes to avoid Express swallowing them as an ID param.
// ─────────────────────────────────────────────────────────────────────────────

// POST sync all customer outstanding balances from their actual orders
// Must be before /:id routes
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

// GET customer ledger — must be before GET /:id so it isn't swallowed
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

module.exports = router;