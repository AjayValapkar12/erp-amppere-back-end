const express = require('express');
const router = express.Router();
const SalesOrder = require('../models/SalesOrder');
const Customer = require('../models/Customer');
const Payment = require('../models/Payment');
const Invoice = require('../models/invoice');
const { getAccountByCode, getPaymentAccount, postJournalEntry } = require('../services/ledgerService');
const { protect } = require('../middleware/auth');

router.use(protect);

// ─── Helper ───────────────────────────────────────────────────────────────────

function calcOrderTotals(items, paidAmount = 0) {
  let subtotal = 0, totalGst = 0;
  const mapped = items.map(item => {
    const amount    = (parseFloat(item.quantity) || 0) * (parseFloat(item.rate) || 0);
    const gstAmount = (amount * (parseFloat(item.gstRate) || 18)) / 100;
    subtotal += amount;
    totalGst += gstAmount;
    return { ...item, amount, gstAmount };
  });
  const totalAmount       = subtotal + totalGst;
  const outstandingAmount = Math.max(0, totalAmount - paidAmount);
  return { items: mapped, subtotal, totalGst, totalAmount, outstandingAmount };
}

function calcInvoiceItemFromSO(soItem, saleWithinMH) {
  const totalValue   = (parseFloat(soItem.quantity) || 0) * (parseFloat(soItem.rate) || 0);
  const discount     = 0;
  const taxableValue = totalValue - discount;
  const gstRate      = parseFloat(soItem.gstRate) || 18;
  const cgstRate     = saleWithinMH ? gstRate / 2 : 0;
  const sgstRate     = saleWithinMH ? gstRate / 2 : 0;
  const igstRate     = saleWithinMH ? 0 : gstRate;
  const cgstAmount   = saleWithinMH ? (taxableValue * cgstRate) / 100 : 0;
  const sgstAmount   = saleWithinMH ? (taxableValue * sgstRate) / 100 : 0;
  const igstAmount   = !saleWithinMH ? (taxableValue * igstRate) / 100 : 0;

  return {
    description:  soItem.description,
    hsnCode:      soItem.hsnCode || '8544',
    uom:          soItem.unit === 'Mtr' ? 'METER' : (soItem.unit || 'METER').toUpperCase(),
    quantity:     parseFloat(soItem.quantity) || 0,
    rate:         parseFloat(soItem.rate) || 0,
    totalValue,
    discount,
    taxableValue,
    gstRate,
    cgstRate,
    cgstAmount,
    sgstRate,
    sgstAmount,
    igstRate,
    igstAmount,
  };
}

async function syncInvoiceFromOrder(order) {
  const invoice = await Invoice.findOne({ salesOrder: order._id }).sort('-createdAt');
  if (!invoice) return;

  const saleWithinMH = !!invoice.saleWithinMaharashtra;
  const delivered    = order.items.filter(i => i.isDelivered === true);
  const soItemIds    = new Set(delivered.map(i => String(i._id)));
  const itemMap      = {};

  delivered.forEach(i => { itemMap[String(i._id)] = i; });

  const nextItems = [];
  (invoice.items || []).forEach(invItem => {
    const soId = invItem.soItemId ? String(invItem.soItemId) : '';
    const soIt = itemMap[soId];
    if (!soIt) return;
    nextItems.push({
      ...calcInvoiceItemFromSO(soIt, saleWithinMH),
      soItemId: soId,
    });
  });

  // Add newly delivered SO items not present in current invoice
  delivered.forEach(soIt => {
    const soId = String(soIt._id);
    const exists = (invoice.items || []).some(invItem => String(invItem.soItemId || '') === soId);
    if (!exists) {
      nextItems.push({
        ...calcInvoiceItemFromSO(soIt, saleWithinMH),
        soItemId: soId,
      });
    }
  });

  // Drop invoice items no longer delivered on SO by filtering against delivered ids
  const filteredItems = nextItems.filter(i => soItemIds.has(String(i.soItemId)));
  const subtotal      = filteredItems.reduce((s, i) => s + (i.taxableValue || 0), 0);
  const totalGst      = filteredItems.reduce((s, i) => s + (i.cgstAmount || 0) + (i.sgstAmount || 0) + (i.igstAmount || 0), 0);
  const totalAmount   = subtotal + totalGst;

  invoice.items       = filteredItems;
  invoice.subtotal    = subtotal;
  invoice.totalGst    = totalGst;
  invoice.totalAmount = totalAmount;
  invoice.updatedAt   = new Date();

  await invoice.save();
}

// ─── Item suggestions ─────────────────────────────────────────────────────────
// Aggregates unique item descriptions from historical orders.
// No product master needed — learns from what was entered before.
// MUST be before /:id to avoid Express treating 'item-suggestions' as an id param.

router.get('/item-suggestions', async (req, res) => {
  try {
    const { q = '' } = req.query;

    const pipeline = [
      ...(q.trim() ? [{ $match: { 'items.description': { $regex: q.trim(), $options: 'i' } } }] : []),
      { $unwind: '$items' },
      ...(q.trim() ? [{ $match: { 'items.description': { $regex: q.trim(), $options: 'i' } } }] : []),
      {
        $group: {
          _id:      '$items.description',
          hsnCode:  { $last: '$items.hsnCode' },
          unit:     { $last: '$items.unit' },
          gstRate:  { $last: '$items.gstRate' },
          lastRate: { $last: '$items.rate' },
        },
      },
      { $sort: { _id: 1 } },
      { $limit: 20 },
    ];

    const results = await SalesOrder.aggregate(pipeline);

    const suggestions = results.map(r => ({
      description: r._id,
      hsnCode:     r.hsnCode  || '8544',
      unit:        r.unit     || 'Mtr',
      gstRate:     r.gstRate  || 18,
      lastRate:    r.lastRate || 0,
    }));

    res.json({ success: true, data: suggestions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── CRUD ─────────────────────────────────────────────────────────────────────

// GET all orders
router.get('/', async (req, res) => {
  try {
    const { search, status } = req.query;
    let query = {};
    if (status) query.paymentStatus = status;

    let orders = await SalesOrder.find(query)
      .populate('customer', 'name phone')
      .sort('-createdAt');

    if (search) {
      const s = search.toLowerCase();
      orders = orders.filter(o =>
        o.orderNumber.toLowerCase().includes(s) ||
        (o.customer && o.customer.name.toLowerCase().includes(s))
      );
    }
    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET order payment history. Match by both order ID and order number because
// older payment records were not consistent about their reference fields.
router.get('/:id/payment-history', async (req, res) => {
  try {
    const order = await SalesOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const payments = await Payment.find({
      $or: [
        { reference: order._id },
        { referenceNumber: order.orderNumber },
      ],
      type: 'received',
      reversed: { $ne: true },
    }).sort({ paymentDate: -1, createdAt: -1 });

    const recordedAmount = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const untrackedAmount = Math.max(0, Number(order.paidAmount || 0) - recordedAmount);

    res.json({
      success: true,
      data: {
        payments,
        untrackedAmount: Math.round((untrackedAmount + Number.EPSILON) * 100) / 100,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Recover an unmatched historical paid balance and reverse it with a complete
// payment/reversal audit trail. A payment method is required because the old
// receipt record did not retain that information.
router.post('/:id/payment-history/reverse-untracked', async (req, res) => {
  try {
    const order = await SalesOrder.findById(req.params.id).populate('customer');
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (!order.customer) {
      return res.status(409).json({ success: false, message: 'This order is not linked to an existing customer. Restore or re-link the customer before reversing payment.' });
    }

    const paymentMethod = req.body.paymentMethod;
    if (!['cash', 'bank_transfer', 'cheque', 'upi'].includes(paymentMethod)) {
      return res.status(400).json({ success: false, message: 'Select the original payment method before reversing this untracked amount.' });
    }

    const receipts = await Payment.find({
      $or: [{ reference: order._id }, { referenceNumber: order.orderNumber }],
      type: 'received',
      reversed: { $ne: true },
    });
    const recordedAmount = receipts.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const untrackedAmount = Math.max(0, Number(order.paidAmount || 0) - recordedAmount);
    if (untrackedAmount <= 0.009) {
      return res.status(409).json({ success: false, message: 'There is no untracked paid amount to reverse. Refresh payment history.' });
    }

    const [cashAccount, arAccount] = await Promise.all([
      getPaymentAccount(paymentMethod),
      getAccountByCode('1200'),
    ]);
    if (!cashAccount || !arAccount) {
      return res.status(503).json({ success: false, message: 'Required accounting accounts are unavailable. Restart the backend after updating it, then retry.' });
    }

    const amount = Math.round((untrackedAmount + Number.EPSILON) * 100) / 100;
    const reconstructedPayment = await Payment.create({
      type: 'received',
      reference: order._id,
      referenceModel: 'SalesOrder',
      referenceNumber: order.orderNumber,
      party: order.customer._id,
      partyModel: 'Customer',
      partyName: order.customer.name,
      amount,
      paymentMethod,
      notes: 'Recovered from the order paid balance; original payment record was missing.',
      createdBy: req.user._id,
    });

    order.paidAmount = Math.max(0, Number(order.paidAmount || 0) - amount);
    order.outstandingAmount = Math.max(0, Number(order.totalAmount || 0) - order.paidAmount);
    order.paymentStatus = order.paidAmount >= order.totalAmount
      ? 'paid'
      : order.paidAmount > 0 ? 'partial' : 'pending';
    await order.save();

    order.customer.outstandingBalance = Number(order.customer.outstandingBalance || 0) + amount;
    await order.customer.save();

    await postJournalEntry({
      date: new Date(),
      referenceModel: 'Payment',
      reference: reconstructedPayment._id,
      referenceNumber: order.orderNumber,
      paymentMethod,
      description: `Reversal of recovered payment for ${order.orderNumber}`,
      lines: [
        { account: arAccount._id, debit: amount },
        { account: cashAccount._id, credit: amount },
      ],
      createdBy: req.user._id,
      party: order.customer._id,
      partyModel: 'Customer',
      partyName: order.customer.name,
    });

    reconstructedPayment.reversed = true;
    reconstructedPayment.reversalOf = reconstructedPayment._id;
    reconstructedPayment.reversedAt = new Date();
    await reconstructedPayment.save();
    await Payment.create({
      type: 'made',
      reference: order._id,
      referenceModel: 'SalesOrder',
      referenceNumber: order.orderNumber,
      party: order.customer._id,
      partyModel: 'Customer',
      partyName: order.customer.name,
      amount,
      paymentDate: new Date(),
      paymentMethod,
      notes: `Reversal of recovered untracked payment ${reconstructedPayment._id}`,
      reversed: true,
      reversalOf: reconstructedPayment._id,
      reversedAt: new Date(),
      createdBy: req.user._id,
    });

    res.json({ success: true, data: { order, reversedAmount: amount } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET single order
router.get('/:id', async (req, res) => {
  try {
    const order = await SalesOrder.findById(req.params.id).populate('customer');
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST create order
router.post('/', async (req, res) => {
  try {
    const { deliveryDate, ...rest } = req.body;
    const orderData = { ...rest, createdBy: req.user._id };

    const calc              = calcOrderTotals(orderData.items || [], 0);
    orderData.items             = calc.items.map(i => ({ ...i, isDelivered: false, deliveredQuantity: 0 }));
    orderData.subtotal          = calc.subtotal;
    orderData.totalGst          = calc.totalGst;
    orderData.totalAmount       = calc.totalAmount;
    orderData.outstandingAmount = calc.totalAmount; // nothing paid yet
    orderData.paidAmount        = 0;

    const order = await SalesOrder.create(orderData);

    // Increase customer outstanding by the full new order amount
    await Customer.findByIdAndUpdate(order.customer, {
      $inc: { outstandingBalance: order.totalAmount },
    });

    // Post accounting entries for the sales order
    const arAccount = await getAccountByCode('1200');
    const salesAccount = await getAccountByCode('4000');
    const gstOutputAccount = await getAccountByCode('2200');
    const journalLines = [
      { account: arAccount._id, debit: order.totalAmount },
      { account: salesAccount._id, credit: order.subtotal },
    ];
    if (order.totalGst > 0) {
      journalLines.push({ account: gstOutputAccount._id, credit: order.totalGst });
    }

    await postJournalEntry({
      date: order.orderDate,
      referenceModel: 'SalesOrder',
      reference: order._id,
      referenceNumber: order.orderNumber,
      description: `Sales Order ${order.orderNumber}`,
      lines: journalLines,
      createdBy: req.user._id,
      party: order.customer,
      partyModel: 'Customer',
      partyName: order.customer?.name || '',
    });

    res.status(201).json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT update order
// FIX: original code never synced customer outstanding on order edit.
// Now fetches the BEFORE state, recomputes totals, then applies the delta to customer.
router.put('/:id', async (req, res) => {
  try {
    // Capture BEFORE state so we can compute delta
    const existing = await SalesOrder.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'Order not found' });

    const oldOutstandingAmount = existing.outstandingAmount;
    const { deliveryDate, ...orderData } = req.body;

    if (orderData.items && orderData.items.length > 0) {
      // Always recalculate server-side using existing paidAmount
      const calc              = calcOrderTotals(orderData.items, existing.paidAmount);
      orderData.items             = calc.items;
      orderData.subtotal          = calc.subtotal;
      orderData.totalGst          = calc.totalGst;
      orderData.totalAmount       = calc.totalAmount;
      orderData.outstandingAmount = calc.outstandingAmount;
    }

    const order = await SalesOrder.findByIdAndUpdate(
      req.params.id,
      orderData,
      { new: true, runValidators: true }
    ).populate('customer');

    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    // Keep linked invoice in sync when SO is edited (reverse direction of invoice->SO sync).
    await syncInvoiceFromOrder(order);

    // Apply delta to customer outstanding — not the full amount, just what changed
    const delta = order.outstandingAmount - oldOutstandingAmount;
    if (Math.abs(delta) > 0.001) {
      await Customer.findByIdAndUpdate(existing.customer, {
        $inc: { outstandingBalance: delta },
      });
    }

    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH toggle item delivery status
router.patch('/:id/items/:itemId/delivery', async (req, res) => {
  try {
    const order = await SalesOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const item = order.items.id(req.params.itemId);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });

    item.isDelivered       = !item.isDelivered;
    item.deliveredDate     = item.isDelivered ? new Date() : undefined;
    item.deliveredQuantity = item.isDelivered ? item.quantity : 0;

    await order.save();

    // Keep invoice items aligned with delivered SO items:
    // delivered -> present in invoice, un-delivered -> removed from invoice.
    await syncInvoiceFromOrder(order);

    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE order
router.delete('/:id', async (req, res) => {
  try {
    const order = await SalesOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    // Only remove the outstanding (unpaid) portion — paid amount was already deducted at payment time
    if (order.outstandingAmount > 0) {
      await Customer.findByIdAndUpdate(order.customer, {
        $inc: { outstandingBalance: -order.outstandingAmount },
      });
    }

    await SalesOrder.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Order deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST record payment for order
router.post('/:id/payment', async (req, res) => {
  try {
    const order = await SalesOrder.findById(req.params.id).populate('customer');
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const {
      amount,
      paymentMethod = 'bank_transfer',
      transactionId = '',
      notes,
      paymentDate,
    } = req.body;
    const payAmount = parseFloat(amount);

    if (isNaN(payAmount) || payAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid payment amount' });
    }
    if (payAmount > order.outstandingAmount + 0.001) {
      return res.status(400).json({ success: false, message: 'Payment exceeds outstanding amount' });
    }

    order.paidAmount        += payAmount;
    order.outstandingAmount  = Math.max(0, order.totalAmount - order.paidAmount);

    if (order.outstandingAmount <= 0.001) order.paymentStatus = 'paid';
    else if (order.paidAmount > 0)        order.paymentStatus = 'partial';

    await order.save();

    await Customer.findByIdAndUpdate(order.customer._id, {
      $inc: { outstandingBalance: -payAmount },
    });

    const cashAccount = await getPaymentAccount(paymentMethod);
    const arAccount = await getAccountByCode('1200');
    await postJournalEntry({
      date: paymentDate ? new Date(paymentDate) : new Date(),
      referenceModel: 'Payment',
      reference: order._id,
      referenceNumber: order.orderNumber,
      paymentMethod,
      transactionId,
      description: `Customer payment for ${order.orderNumber}`,
      lines: [
        { account: cashAccount._id, debit: payAmount },
        { account: arAccount._id, credit: payAmount },
      ],
      createdBy: req.user._id,
      party: order.customer._id,
      partyModel: 'Customer',
      partyName: order.customer.name,
    });

    await Payment.create({
      type:            'received',
      reference:       order._id,
      referenceModel:  'SalesOrder',
      referenceNumber: order.orderNumber,
      party:           order.customer._id,
      partyModel:      'Customer',
      partyName:       order.customer.name,
      amount:          payAmount,
      paymentMethod,
      transactionId,
      notes,
      paymentDate:     paymentDate || new Date(),
      createdBy:       req.user._id,
    });

    res.json({ success: true, data: order, message: 'Payment recorded successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
