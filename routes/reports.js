const express = require('express');
const router = express.Router();
const SalesOrder = require('../models/SalesOrder');
const PurchaseOrder = require('../models/PurchaseOrder');
const Payment = require('../models/Payment');
const Customer = require('../models/Customer');
const { protect } = require('../middleware/auth');

router.use(protect);

// Sales report
router.get('/sales', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let query = {};
    if (startDate || endDate) {
      query.orderDate = {};
      if (startDate) query.orderDate.$gte = new Date(startDate);
      if (endDate) query.orderDate.$lte = new Date(endDate);
    }
    const orders = await SalesOrder.find(query).populate('customer', 'name').sort('-orderDate');
    const totalRevenue = orders.reduce((s, o) => s + o.totalAmount, 0);
    const totalReceived = orders.reduce((s, o) => s + o.paidAmount, 0);
    const totalOutstanding = orders.reduce((s, o) => s + o.outstandingAmount, 0);
    res.json({ success: true, data: { orders, totalRevenue, totalReceived, totalOutstanding } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Purchase report
router.get('/purchases', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let query = {};
    if (startDate || endDate) {
      query.orderDate = {};
      if (startDate) query.orderDate.$gte = new Date(startDate);
      if (endDate) query.orderDate.$lte = new Date(endDate);
    }
    const orders = await PurchaseOrder.find(query).populate('vendor', 'name').sort('-orderDate');
    const totalPurchases = orders.reduce((s, o) => s + o.totalAmount, 0);
    const totalPaid = orders.reduce((s, o) => s + o.paidAmount, 0);
    const totalOutstanding = orders.reduce((s, o) => s + o.outstandingAmount, 0);
    res.json({ success: true, data: { orders, totalPurchases, totalPaid, totalOutstanding } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// P&L report
router.get('/pl', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let dateQuery = {};
    if (startDate || endDate) {
      dateQuery = {};
      if (startDate) dateQuery.$gte = new Date(startDate);
      if (endDate) dateQuery.$lte = new Date(endDate);
    }
    const salesQuery = Object.keys(dateQuery).length ? { orderDate: dateQuery } : {};
    const [salesOrders, purchaseOrders] = await Promise.all([
      SalesOrder.find(salesQuery),
      PurchaseOrder.find(salesQuery)
    ]);
    const revenue = salesOrders.reduce((s, o) => s + o.totalAmount, 0);
    const purchases = purchaseOrders.reduce((s, o) => s + o.totalAmount, 0);
    res.json({ success: true, data: { revenue, purchases, grossProfit: revenue - purchases, orders: salesOrders.length, pos: purchaseOrders.length } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Customer outstanding report
router.get('/outstanding', async (req, res) => {
  try {
    const customers = await Customer.find({ outstandingBalance: { $gt: 0 } }).sort('-outstandingBalance');
    const total = customers.reduce((s, c) => s + c.outstandingBalance, 0);
    res.json({ success: true, data: { customers, total } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
