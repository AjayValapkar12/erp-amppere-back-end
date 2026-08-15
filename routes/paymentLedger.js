const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  recordPayment,
  getSimpleLedger,
  getLedgerSummary,
  getLedgerByPaymentMethod,
  getLedgerByParty,
  getPaymentMethodStats,
  getTransactionsByType
} = require('../services/paymentLedgerService');
const {
  syncExistingPayments,
  getUnifiedLedger,
  getUnifiedSummary
} = require('../services/paymentLedgerSync');

router.use(protect);

/**
 * POST - Sync existing payments from old system
 * This migrates old Payment records to new PaymentLedger
 */
router.post('/sync-existing', async (req, res) => {
  try {
    const result = await syncExistingPayments();
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET - Unified ledger (old + new payments)
 */
router.get('/unified', async (req, res) => {
  try {
    const { startDate, endDate, paymentMethod, transactionType } = req.query;
    const ledger = await getUnifiedLedger({ startDate, endDate, paymentMethod, transactionType });
    res.json({ success: true, data: ledger });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET - Unified summary (old + new payments)
 */
router.get('/unified/summary', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const summary = await getUnifiedSummary({ startDate, endDate });
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST - Record a new payment
 */
router.post('/record', async (req, res) => {
  try {
    const {
      date,
      transactionType, // 'Sales' or 'Purchase'
      referenceModel,
      referenceNumber,
      reference,
      partyType,
      partyId,
      partyName,
      amount,
      paymentMethod,
      transactionId,
      description
    } = req.body;

    if (!transactionType || !['Sales', 'Purchase'].includes(transactionType)) {
      return res.status(400).json({ success: false, message: 'Invalid transactionType (must be Sales or Purchase)' });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be greater than 0' });
    }

    const entry = await recordPayment({
      date,
      transactionType,
      referenceModel,
      referenceNumber,
      reference,
      partyType,
      partyId,
      partyName,
      amount,
      paymentMethod,
      transactionId,
      description,
      createdBy: req.user._id
    });

    res.json({ success: true, data: entry, message: `${transactionType} payment recorded successfully` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET - Simple ledger with all payments
 */
router.get('/simple', async (req, res) => {
  try {
    const { startDate, endDate, paymentMethod, transactionType } = req.query;
    const ledger = await getSimpleLedger({ startDate, endDate, paymentMethod, transactionType });
    res.json({ success: true, data: ledger });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET - Ledger summary with totals
 */
router.get('/summary', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const summary = await getLedgerSummary({ startDate, endDate });
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET - Transactions by payment method
 */
router.get('/method/:paymentMethod', async (req, res) => {
  try {
    const { paymentMethod } = req.params;
    const { startDate, endDate } = req.query;
    const data = await getLedgerByPaymentMethod({ startDate, endDate, paymentMethod });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET - Payment method statistics
 */
router.get('/stats/methods', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const stats = await getPaymentMethodStats({ startDate, endDate });
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET - Transactions by type (Sales/Purchase)
 */
router.get('/type/:transactionType', async (req, res) => {
  try {
    const { transactionType } = req.params;
    const { startDate, endDate } = req.query;
    
    if (!['Sales', 'Purchase'].includes(transactionType)) {
      return res.status(400).json({ success: false, message: 'Invalid transaction type' });
    }

    const data = await getTransactionsByType({ transactionType, startDate, endDate });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET - Ledger for specific customer/vendor
 */
router.get('/party/:partyId', async (req, res) => {
  try {
    const { partyId } = req.params;
    const { partyType, startDate, endDate } = req.query;

    if (!partyType || !['Customer', 'Vendor'].includes(partyType)) {
      return res.status(400).json({ success: false, message: 'partyType is required (Customer or Vendor)' });
    }

    const data = await getLedgerByParty({ partyId, partyType, startDate, endDate });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
