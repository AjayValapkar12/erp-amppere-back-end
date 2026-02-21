const express = require('express');
const router = express.Router();
const Invoice = require('../models/invoice');
const SalesOrder = require('../models/SalesOrder');
const Customer = require('../models/Customer');
const { protect } = require('../middleware/auth');

router.use(protect);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcItemAmounts(item, saleWithinMH) {
  const totalValue   = (item.quantity || 0) * (item.rate || 0);
  const discount     = item.discount || 0;
  const taxableValue = totalValue - discount;
  const gstRate      = item.gstRate || 18;
  const cgstRate     = saleWithinMH ? gstRate / 2 : 0;
  const sgstRate     = saleWithinMH ? gstRate / 2 : 0;
  const igstRate     = saleWithinMH ? 0 : gstRate;
  const cgstAmount   = saleWithinMH ? (taxableValue * cgstRate) / 100 : 0;
  const sgstAmount   = saleWithinMH ? (taxableValue * sgstRate) / 100 : 0;
  const igstAmount   = !saleWithinMH ? (taxableValue * igstRate) / 100 : 0;
  return { ...item, totalValue, taxableValue, cgstRate, cgstAmount, sgstRate, sgstAmount, igstRate, igstAmount };
}

/**
 * After an invoice is saved, push edited rate/qty back into the linked SalesOrder
 * for delivered items only, recompute SO totals, then adjust customer outstanding by delta.
 *
 * FIX: Original used falsy check `soItem.amount || calc` which would wrongly
 * recalculate when amount was a legitimate 0. Now uses explicit null/undefined check.
 */
async function syncOrderAndCustomer(orderId, invoiceItems) {
  const order = await SalesOrder.findById(orderId);
  if (!order) return;

  // Build lookup: soItemId → invoice item
  const invMap = {};
  (invoiceItems || []).forEach(i => {
    if (i.soItemId) invMap[String(i.soItemId)] = i;
  });

  const oldTotalAmount = order.totalAmount;
  let newSubtotal = 0;
  let newTotalGst = 0;

  order.items.forEach(soItem => {
    const id  = soItem._id.toString();
    const inv = invMap[id];

    if (soItem.isDelivered && inv) {
      // Mirror invoice edits back to the SO item
      soItem.rate      = inv.rate;
      soItem.quantity  = inv.quantity;
      soItem.amount    = inv.taxableValue;
      soItem.gstAmount = inv.cgstAmount + inv.sgstAmount + inv.igstAmount;
    } else {
      // Non-delivered items: fill in if missing (never overwrite existing valid values)
      if (soItem.amount == null) soItem.amount    = soItem.quantity * soItem.rate;
      if (soItem.gstAmount == null) soItem.gstAmount = (soItem.amount * soItem.gstRate) / 100;
    }

    newSubtotal += soItem.amount    || 0;
    newTotalGst += soItem.gstAmount || 0;
  });

  order.subtotal          = newSubtotal;
  order.totalGst          = newTotalGst;
  order.totalAmount       = newSubtotal + newTotalGst;
  order.outstandingAmount = Math.max(0, order.totalAmount - (order.paidAmount || 0));

  if ((order.paidAmount || 0) >= order.totalAmount && order.totalAmount > 0) {
    order.paymentStatus = 'paid';
  } else if ((order.paidAmount || 0) > 0) {
    order.paymentStatus = 'partial';
  } else {
    order.paymentStatus = 'pending';
  }

  await order.save();

  // Adjust customer outstanding by delta only
  const delta = order.totalAmount - oldTotalAmount;
  if (Math.abs(delta) > 0.001) {
    await Customer.findByIdAndUpdate(order.customer, {
      $inc: { outstandingBalance: delta },
    });
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────
// IMPORTANT: specific routes must come before /:id to avoid Express treating
// path segments like 'by-order' as MongoDB ObjectId params (causes CastError).

// GET all invoices
router.get('/', async (req, res) => {
  try {
    const invoices = await Invoice.find()
      .populate('salesOrder', 'orderNumber')
      .sort('-createdAt');
    res.json({ success: true, data: invoices });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET invoice by sales order ID — MUST be before GET /:id
// FIX: in the original code /:id was registered first, causing Mongoose to try
// casting 'by-order' as an ObjectId and throwing a CastError.
router.get('/by-order/:orderId', async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ salesOrder: req.params.orderId }).sort('-createdAt');
    res.json({ success: true, data: invoice || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET single invoice
router.get('/:id', async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id).populate('salesOrder');
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    res.json({ success: true, data: invoice });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST generate invoice from DELIVERED SO items only
// FIX: original filtered by isDelivered correctly, but the filter is now more explicit
// and returns a clear error message guiding the user to mark items first.
router.post('/generate/:orderId', async (req, res) => {
  try {
    const order = await SalesOrder.findById(req.params.orderId).populate('customer');
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const customer = order.customer;

    // Only include items explicitly marked as delivered
    const deliveredItems = order.items.filter(i => i.isDelivered === true);
    if (deliveredItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No delivered items found. Please mark items as delivered before generating an invoice.',
      });
    }

    // Determine CGST/SGST vs IGST split
    const customerState = (customer.billingAddress?.state || '').toLowerCase();
    const saleWithinMH  = req.body.saleWithinMaharashtra !== undefined
      ? req.body.saleWithinMaharashtra
      : (customerState.includes('maharashtra') || customerState === 'mh');

    // Build invoice items from delivered SO items only, store soItemId for future syncing
    const invoiceItems = deliveredItems.map(item =>
      calcItemAmounts({
        soItemId:    item._id.toString(),
        description: item.description,
        hsnCode:     item.hsnCode || '8544',
        uom:         item.unit === 'Mtr' ? 'METER' : (item.unit || 'METER').toUpperCase(),
        quantity:    item.quantity,
        rate:        item.rate,
        discount:    0,
        gstRate:     item.gstRate || 18,
      }, saleWithinMH)
    );

    const subtotal    = invoiceItems.reduce((s, i) => s + i.taxableValue, 0);
    const totalGst    = invoiceItems.reduce((s, i) => s + i.cgstAmount + i.sgstAmount + i.igstAmount, 0);
    const totalAmount = subtotal + totalGst;

    const ba      = customer.billingAddress  || {};
    const da      = customer.deliveryAddress || ba;
    const fmtAddr = a => [a.street, a.city, a.state, a.pincode].filter(Boolean).join(', ');

    const invoice = await Invoice.create({
      salesOrder:            order._id,
      saleWithinMaharashtra: saleWithinMH,
      poNumber:              order.orderNumber,
      poDate:                order.orderDate,
      invoiceDate:           new Date(),
      dateOfSupply:          new Date(),
      billedTo: {
        name:      customer.name      || '',
        address:   fmtAddr(ba),
        stateCode: ba.pincode ? ba.pincode.substring(0, 2) : '',
        gstNumber: customer.gstNumber || '',
        contact:   customer.phone     || '',
      },
      deliveryAt: {
        name:    customer.name  || '',
        address: fmtAddr(da),
        contact: customer.phone || '',
      },
      items:            invoiceItems,
      subtotal,
      totalGst,
      totalAmount,
      freightCharges:   'nil',
      packingCharges:   'nil',
      insuranceCharges: 'nil',
      otherCharges:     'nil',
      createdBy:        req.user._id,
    });

    await SalesOrder.findByIdAndUpdate(order._id, { latestInvoice: invoice._id });

    res.status(201).json({ success: true, data: invoice });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT save edited invoice AND sync SO + customer
// Recalculates all amounts server-side, then propagates changes back to SO and customer.
router.put('/:id', async (req, res) => {
  try {
    const data = { ...req.body };

    // Always recalculate server-side — never trust client-sent totals
    if (data.items && data.items.length > 0) {
      data.items       = data.items.map(item => calcItemAmounts(item, data.saleWithinMaharashtra));
      data.subtotal    = data.items.reduce((s, i) => s + i.taxableValue, 0);
      data.totalGst    = data.items.reduce((s, i) => s + i.cgstAmount + i.sgstAmount + i.igstAmount, 0);
      data.totalAmount = data.subtotal + data.totalGst;
    }

    data.updatedAt = new Date();

    const invoice = await Invoice.findByIdAndUpdate(req.params.id, data, { new: true });
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

    // Push changes back to linked SO and cascade to customer outstanding
    if (invoice.salesOrder) {
      await syncOrderAndCustomer(invoice.salesOrder.toString(), invoice.items);
    }

    res.json({ success: true, data: invoice, message: 'Invoice saved and order totals synced' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE invoice
router.delete('/:id', async (req, res) => {
  try {
    const invoice = await Invoice.findByIdAndDelete(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    res.json({ success: true, message: 'Invoice deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
