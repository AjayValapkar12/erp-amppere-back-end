const express = require('express');
const router = express.Router();
const Payment = require('../models/Payment');
const SalesOrder = require('../models/SalesOrder');
const PurchaseOrder = require('../models/PurchaseOrder');
const Customer = require('../models/Customer');
const Vendor = require('../models/Vendor');
const { getAccountByCode, getPaymentAccount, postJournalEntry } = require('../services/ledgerService');
const { protect } = require('../middleware/auth');

router.use(protect);

async function reversePaymentEntry(payment, userId) {
  const amount = payment.amount;
  const reverseDate = new Date();

  if (!payment.referenceModel || !payment.reference) {
    throw new Error('Payment missing reference details');
  }

  if (payment.referenceModel === 'SalesOrder') {
    const order = await SalesOrder.findById(payment.reference).populate('customer');
    if (!order) throw new Error('Linked sales order not found');
    const customer = await Customer.findById(order.customer._id);
    if (!customer) throw new Error('Linked customer not found');

    order.paidAmount = Math.max(0, (order.paidAmount || 0) - amount);
    order.outstandingAmount = Math.max(0, order.totalAmount - order.paidAmount);
    order.paymentStatus = order.paidAmount >= order.totalAmount ? 'paid' : order.paidAmount > 0 ? 'partial' : 'pending';
    await order.save();

    customer.outstandingBalance = (customer.outstandingBalance || 0) + amount;
    await customer.save();

    const cashAccount = await getPaymentAccount(payment.paymentMethod);
    const arAccount = await getAccountByCode('1200');
    await postJournalEntry({
      date: reverseDate,
      referenceModel: 'Payment',
      reference: payment._id,
      referenceNumber: payment.referenceNumber,
      paymentMethod: payment.paymentMethod,
      transactionId: payment.transactionId,
      description: `Reversal of receipt for ${payment.referenceNumber}`,
      lines: [
        { account: arAccount._id, debit: amount },
        { account: cashAccount._id, credit: amount },
      ],
      createdBy: userId,
      party: customer._id,
      partyModel: 'Customer',
      partyName: customer.name,
    });

    return { order, party: customer };
  }

  if (payment.referenceModel === 'PurchaseOrder') {
    const order = await PurchaseOrder.findById(payment.reference).populate('vendor');
    if (!order) throw new Error('Linked purchase order not found');
    const vendor = await Vendor.findById(order.vendor._id);
    if (!vendor) throw new Error('Linked vendor not found');

    order.paidAmount = Math.max(0, (order.paidAmount || 0) - amount);
    order.outstandingAmount = Math.max(0, order.totalAmount - order.paidAmount);
    order.paymentStatus = order.paidAmount >= order.totalAmount ? 'paid' : order.paidAmount > 0 ? 'partial' : 'pending';
    await order.save();

    vendor.outstandingBalance = (vendor.outstandingBalance || 0) + amount;
    await vendor.save();

    const cashAccount = await getPaymentAccount(payment.paymentMethod);
    const apAccount = await getAccountByCode('2100');
    await postJournalEntry({
      date: reverseDate,
      referenceModel: 'Payment',
      reference: payment._id,
      referenceNumber: payment.referenceNumber,
      paymentMethod: payment.paymentMethod,
      transactionId: payment.transactionId,
      description: `Reversal of payment for ${payment.referenceNumber}`,
      lines: [
        { account: apAccount._id, debit: amount },
        { account: cashAccount._id, credit: amount },
      ],
      createdBy: userId,
      party: vendor._id,
      partyModel: 'Vendor',
      partyName: vendor.name,
    });

    return { order, party: vendor };
  }

  throw new Error('Unsupported payment reference type');
}

router.get('/', async (req, res) => {
  try {
    const { type, startDate, endDate, reference, referenceModel, party, partyModel, reversed } = req.query;
    let query = {};
    if (type) query.type = type;
    if (reference) query.reference = reference;
    if (referenceModel) query.referenceModel = referenceModel;
    if (party) query.party = party;
    if (partyModel) query.partyModel = partyModel;
    if (reversed !== undefined) query.reversed = reversed === 'true';
    if (startDate || endDate) {
      query.paymentDate = {};
      if (startDate) query.paymentDate.$gte = new Date(startDate);
      if (endDate) query.paymentDate.$lte = new Date(endDate);
    }
    const payments = await Payment.find(query).sort('-paymentDate');
    res.json({ success: true, data: payments });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/:id/reverse', async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
    if (payment.reversed) return res.status(400).json({ success: false, message: 'Payment already reversed' });

    const { order, party } = await reversePaymentEntry(payment, req.user._id);

    payment.reversed = true;
    payment.reversalOf = payment._id;
    payment.reversedAt = new Date();
    await payment.save();

    const reversalType = payment.type === 'received' ? 'made' : 'received';
    await Payment.create({
      type: reversalType,
      reference: payment.reference,
      referenceModel: payment.referenceModel,
      referenceNumber: payment.referenceNumber,
      party: payment.party,
      partyModel: payment.partyModel,
      partyName: payment.partyName,
      amount: payment.amount,
      paymentDate: new Date(),
      paymentMethod: payment.paymentMethod,
      transactionId: payment.transactionId,
      notes: `Reversal of payment ${payment._id}: ${payment.notes || ''}`,
      reversed: true,
      reversalOf: payment._id,
      reversedAt: new Date(),
      createdBy: req.user._id,
    });

    res.json({ success: true, data: { order, party, paymentId: payment._id } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
