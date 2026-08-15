const PaymentLedger = require('../models/PaymentLedger');
const Invoice = require('../models/invoice');
const PurchaseOrder = require('../models/PurchaseOrder');
const Customer = require('../models/Customer');
const Vendor = require('../models/Vendor');

/**
 * Record a payment in the ledger
 * Automatically sets Debit (Purchase) or Credit (Sales) based on transaction type
 */
async function recordPayment({
  date,
  transactionType, // 'Sales' or 'Purchase'
  referenceModel, // 'Invoice' or 'PurchaseOrder'
  referenceNumber,
  reference,
  partyType, // 'Customer' or 'Vendor'
  partyId,
  partyName,
  amount,
  paymentMethod, // 'cash', 'bank_transfer', 'cheque', 'upi'
  transactionId,
  description,
  createdBy
}) {
  const entry = new PaymentLedger({
    date: date || new Date(),
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
    createdBy
  });

  return entry.save();
}

/**
 * Get simple ledger - all payments with running balance
 */
async function getSimpleLedger({ startDate, endDate, paymentMethod, transactionType }) {
  const query = {};

  if (startDate || endDate) {
    query.date = {};
    if (startDate) query.date.$gte = new Date(startDate);
    if (endDate) query.date.$lte = new Date(endDate);
  }

  if (paymentMethod) query.paymentMethod = paymentMethod;
  if (transactionType) query.transactionType = transactionType;

  const entries = await PaymentLedger.find(query)
    .sort({ date: 1 })
    .lean();

  // Calculate running balance
  let runningBalance = 0;
  const withBalance = entries.map(entry => {
    runningBalance += (entry.credit || 0) - (entry.debit || 0);
    return {
      ...entry,
      runningBalance: parseFloat(runningBalance.toFixed(2))
    };
  });

  return withBalance;
}

/**
 * Get ledger summary - totals by transaction type
 */
async function getLedgerSummary({ startDate, endDate }) {
  const query = {};

  if (startDate || endDate) {
    query.date = {};
    if (startDate) query.date.$gte = new Date(startDate);
    if (endDate) query.date.$lte = new Date(endDate);
  }

  const entries = await PaymentLedger.find(query).lean();

  const summary = {
    totalCredit: 0,      // Sales received
    totalDebit: 0,       // Purchase paid
    netBalance: 0,
    byPaymentMethod: {},
    byTransactionType: {
      Sales: { count: 0, amount: 0 },
      Purchase: { count: 0, amount: 0 }
    }
  };

  entries.forEach(entry => {
    // Summary by amount
    if (entry.credit > 0) {
      summary.totalCredit += entry.credit;
    }
    if (entry.debit > 0) {
      summary.totalDebit += entry.debit;
    }

    // By payment method
    if (!summary.byPaymentMethod[entry.paymentMethod]) {
      summary.byPaymentMethod[entry.paymentMethod] = { 
        credit: 0, 
        debit: 0, 
        count: 0 
      };
    }
    summary.byPaymentMethod[entry.paymentMethod].credit += entry.credit || 0;
    summary.byPaymentMethod[entry.paymentMethod].debit += entry.debit || 0;
    summary.byPaymentMethod[entry.paymentMethod].count += 1;

    // By transaction type
    summary.byTransactionType[entry.transactionType].count += 1;
    summary.byTransactionType[entry.transactionType].amount += entry.amount;
  });

  summary.netBalance = summary.totalCredit - summary.totalDebit;
  return summary;
}

/**
 * Get ledger by payment method
 */
async function getLedgerByPaymentMethod({ startDate, endDate, paymentMethod }) {
  const query = { paymentMethod };

  if (startDate || endDate) {
    query.date = {};
    if (startDate) query.date.$gte = new Date(startDate);
    if (endDate) query.date.$lte = new Date(endDate);
  }

  const entries = await PaymentLedger.find(query)
    .sort({ date: -1 })
    .lean();

  const summary = {
    paymentMethod,
    transactions: entries,
    totalCredit: entries.reduce((sum, e) => sum + (e.credit || 0), 0),
    totalDebit: entries.reduce((sum, e) => sum + (e.debit || 0), 0),
    count: entries.length
  };

  return summary;
}

/**
 * Get ledger for specific customer/vendor
 */
async function getLedgerByParty({ partyId, partyType, startDate, endDate }) {
  const query = { partyId, partyType };

  if (startDate || endDate) {
    query.date = {};
    if (startDate) query.date.$gte = new Date(startDate);
    if (endDate) query.date.$lte = new Date(endDate);
  }

  const entries = await PaymentLedger.find(query)
    .sort({ date: -1 })
    .lean();

  return {
    partyId,
    partyType,
    transactions: entries,
    totalCredit: entries.reduce((sum, e) => sum + (e.credit || 0), 0),
    totalDebit: entries.reduce((sum, e) => sum + (e.debit || 0), 0),
    balance: entries.reduce((sum, e) => sum + ((e.credit || 0) - (e.debit || 0)), 0),
    count: entries.length
  };
}

/**
 * Get all payment methods statistics
 */
async function getPaymentMethodStats({ startDate, endDate }) {
  const query = {};

  if (startDate || endDate) {
    query.date = {};
    if (startDate) query.date.$gte = new Date(startDate);
    if (endDate) query.date.$lte = new Date(endDate);
  }

  const entries = await PaymentLedger.find(query).lean();

  const stats = {};
  const methods = ['cash', 'bank_transfer', 'cheque', 'upi'];

  methods.forEach(method => {
    const methodEntries = entries.filter(e => e.paymentMethod === method);
    stats[method] = {
      count: methodEntries.length,
      credit: methodEntries.reduce((sum, e) => sum + (e.credit || 0), 0),
      debit: methodEntries.reduce((sum, e) => sum + (e.debit || 0), 0),
      net: methodEntries.reduce((sum, e) => sum + ((e.credit || 0) - (e.debit || 0)), 0)
    };
  });

  return stats;
}

/**
 * Get transactions by type (Sales/Purchase)
 */
async function getTransactionsByType({ transactionType, startDate, endDate }) {
  const query = { transactionType };

  if (startDate || endDate) {
    query.date = {};
    if (startDate) query.date.$gte = new Date(startDate);
    if (endDate) query.date.$lte = new Date(endDate);
  }

  const entries = await PaymentLedger.find(query)
    .sort({ date: -1 })
    .lean();

  return {
    transactionType,
    transactions: entries,
    total: entries.reduce((sum, e) => sum + e.amount, 0),
    count: entries.length
  };
}

module.exports = {
  recordPayment,
  getSimpleLedger,
  getLedgerSummary,
  getLedgerByPaymentMethod,
  getLedgerByParty,
  getPaymentMethodStats,
  getTransactionsByType
};
