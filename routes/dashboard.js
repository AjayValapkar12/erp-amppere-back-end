const express = require('express');
const router = express.Router();
const SalesOrder = require('../models/SalesOrder');
const PurchaseOrder = require('../models/PurchaseOrder');
const Customer = require('../models/Customer');
const Vendor = require('../models/Vendor');
const Payment = require('../models/Payment');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/stats', async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalCustomers, totalVendors,
      salesOrders, purchaseOrders,
      monthSalesOrders, monthPurchaseOrders,
      recentSales, recentPurchases,
      paymentsReceived, paymentsMade
    ] = await Promise.all([
      Customer.countDocuments(),
      Vendor.countDocuments(),
      SalesOrder.find(),
      PurchaseOrder.find(),
      SalesOrder.find({ createdAt: { $gte: startOfMonth } }),
      PurchaseOrder.find({ createdAt: { $gte: startOfMonth } }),
      SalesOrder.find().sort('-createdAt').limit(5).populate('customer', 'name'),
      PurchaseOrder.find().sort('-createdAt').limit(5).populate('vendor', 'name'),
      Payment.find({ type: 'received', paymentDate: { $gte: startOfMonth } }),
      Payment.find({ type: 'made', paymentDate: { $gte: startOfMonth } })
    ]);

    const totalSalesRevenue = salesOrders.reduce((s, o) => s + o.totalAmount, 0);
    const totalOutstandingReceivables = salesOrders.reduce((s, o) => s + o.outstandingAmount, 0);
    const totalOutstandingPayables = purchaseOrders.reduce((s, o) => s + o.outstandingAmount, 0);
    const monthSalesRevenue = monthSalesOrders.reduce((s, o) => s + o.totalAmount, 0);
    const monthPurchases = monthPurchaseOrders.reduce((s, o) => s + o.totalAmount, 0);
    const monthReceivedPayments = paymentsReceived.reduce((s, p) => s + p.amount, 0);
    const monthMadePayments = paymentsMade.reduce((s, p) => s + p.amount, 0);

    // Monthly chart data (last 6 months)
    const chartData = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const monthOrders = salesOrders.filter(o => o.createdAt >= start && o.createdAt <= end);
      const monthPOs = purchaseOrders.filter(o => o.createdAt >= start && o.createdAt <= end);
      chartData.push({
        month: start.toLocaleString('default', { month: 'short' }),
        sales: monthOrders.reduce((s, o) => s + o.totalAmount, 0),
        purchases: monthPOs.reduce((s, o) => s + o.totalAmount, 0)
      });
    }

    res.json({
      success: true,
      data: {
        totalCustomers, totalVendors,
        totalSalesRevenue, totalOutstandingReceivables, totalOutstandingPayables,
        monthSalesRevenue, monthPurchases, monthReceivedPayments, monthMadePayments,
        pendingSalesOrders: salesOrders.filter(o => o.paymentStatus === 'pending').length,
        pendingPurchaseOrders: purchaseOrders.filter(o => o.paymentStatus === 'pending').length,
        recentSales, recentPurchases, chartData
      }
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
