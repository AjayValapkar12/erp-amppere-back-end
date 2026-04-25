const express = require('express');
const router = express.Router();
const SalesOrder = require('../models/SalesOrder');
const PurchaseOrder = require('../models/PurchaseOrder');
const Payment = require('../models/Payment');
const Customer = require('../models/Customer');
const { protect } = require('../middleware/auth');

router.use(protect);

// Sales report - grouped by customer with outstanding and invoice/PO details
router.get('/sales', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let query = {};
    if (startDate || endDate) {
      query.orderDate = {};
      if (startDate) query.orderDate.$gte = new Date(startDate);
      if (endDate) query.orderDate.$lte = new Date(endDate);
    }
    
    const orders = await SalesOrder.find(query)
      .populate('customer', 'name phone')
      .populate('latestInvoice', 'invoiceNumber invoiceDate poNumber')
      .sort('-orderDate');
    
    // Group by customer and calculate outstanding
    const customerMap = new Map();
    orders.forEach(order => {
      const custId = order.customer?._id?.toString();
      if (!custId) return;
      
      if (!customerMap.has(custId)) {
        customerMap.set(custId, {
          customer: order.customer,
          totalAmount: 0,
          paidAmount: 0,
          outstandingAmount: 0,
          orderCount: 0,
          orders: []
        });
      }
      
      const custData = customerMap.get(custId);
      custData.totalAmount += order.totalAmount || 0;
      custData.paidAmount += order.paidAmount || 0;
      custData.outstandingAmount += order.outstandingAmount || 0;
      custData.orderCount += 1;
      custData.orders.push({
        _id: order._id,
        orderNumber: order.orderNumber,
        orderDate: order.orderDate,
        totalAmount: order.totalAmount,
        paidAmount: order.paidAmount,
        outstandingAmount: order.outstandingAmount,
        paymentStatus: order.paymentStatus,
        invoiceNumber: order.latestInvoice?.invoiceNumber || '-',
        invoiceDate: order.latestInvoice?.invoiceDate,
        poNumber: order.poNumber || order.latestInvoice?.poNumber || '-'
      });
    });
    
    const customerData = Array.from(customerMap.values())
      .sort((a, b) => b.outstandingAmount - a.outstandingAmount);
    
    const totalRevenue = customerData.reduce((s, c) => s + c.totalAmount, 0);
    const totalReceived = customerData.reduce((s, c) => s + c.paidAmount, 0);
    const totalOutstanding = customerData.reduce((s, c) => s + c.outstandingAmount, 0);
    
    res.json({ success: true, data: { customers: customerData, totalRevenue, totalReceived, totalOutstanding } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Purchase report - grouped by vendor with outstanding and invoice/PO details
router.get('/purchases', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let query = {};
    if (startDate || endDate) {
      query.orderDate = {};
      if (startDate) query.orderDate.$gte = new Date(startDate);
      if (endDate) query.orderDate.$lte = new Date(endDate);
    }
    
    const orders = await PurchaseOrder.find(query)
      .populate('vendor', 'name phone')
      .sort('-orderDate');
    
    // Group by vendor and calculate outstanding
    const vendorMap = new Map();
    orders.forEach(order => {
      const vendId = order.vendor?._id?.toString();
      if (!vendId) return;
      
      if (!vendorMap.has(vendId)) {
        vendorMap.set(vendId, {
          vendor: order.vendor,
          totalAmount: 0,
          paidAmount: 0,
          outstandingAmount: 0,
          orderCount: 0,
          orders: []
        });
      }
      
      const vendData = vendorMap.get(vendId);
      vendData.totalAmount += order.totalAmount || 0;
      vendData.paidAmount += order.paidAmount || 0;
      vendData.outstandingAmount += order.outstandingAmount || 0;
      vendData.orderCount += 1;
      vendData.orders.push({
        _id: order._id,
        orderNumber: order.orderNumber,
        orderDate: order.orderDate,
        totalAmount: order.totalAmount,
        paidAmount: order.paidAmount,
        outstandingAmount: order.outstandingAmount,
        paymentStatus: order.paymentStatus,
        invoiceNumber: order.invoiceNumber || '-',
        invoiceDate: order.invoiceDate,
        poNumber: order.poNumber || '-'
      });
    });
    
    const vendorData = Array.from(vendorMap.values())
      .sort((a, b) => b.outstandingAmount - a.outstandingAmount);
    
    const totalPurchases = vendorData.reduce((s, c) => s + c.totalAmount, 0);
    const totalPaid = vendorData.reduce((s, c) => s + c.paidAmount, 0);
    const totalOutstanding = vendorData.reduce((s, c) => s + c.outstandingAmount, 0);
    
    res.json({ success: true, data: { vendors: vendorData, totalPurchases, totalPaid, totalOutstanding } });
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
