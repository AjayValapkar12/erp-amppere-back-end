const PaymentLedger = require('../models/PaymentLedger');
const Payment = require('../models/Payment');

/**
 * Sync existing Payment records to PaymentLedger
 * This migrates old payment records to the new system
 */
async function syncExistingPayments() {
  try {
    console.log('Starting payment sync...');

    // Get all existing payments that haven't been synced
    const existingPayments = await Payment.find({
      synced: { $ne: true }
    }).lean();

    if (existingPayments.length === 0) {
      console.log('No payments to sync');
      return { synced: 0, message: 'No payments to sync' };
    }

    console.log(`Found ${existingPayments.length} payments to sync`);

    let syncedCount = 0;
    const errors = [];

    for (const payment of existingPayments) {
      try {
        // Determine transaction type from payment type
        const transactionType = payment.type === 'received' ? 'Sales' : 'Purchase';
        const partyType = payment.partyModel || (transactionType === 'Sales' ? 'Customer' : 'Vendor');

        // Create entry in new PaymentLedger
        const ledgerEntry = await PaymentLedger.create({
          date: payment.paymentDate || payment.createdAt || new Date(),
          transactionType,
          referenceModel: payment.referenceModel,
          referenceNumber: payment.referenceNumber,
          reference: payment.reference,
          partyType,
          partyId: payment.party,
          partyName: payment.partyName,
          amount: payment.amount,
          paymentMethod: payment.paymentMethod || 'bank_transfer',
          transactionId: payment.transactionId,
          description: `Migrated: ${payment.notes || 'Payment recorded'}`,
          createdBy: payment.createdBy,
          createdAt: payment.createdAt
        });

        // Mark as synced in old Payment model
        await Payment.findByIdAndUpdate(payment._id, { synced: true, syncedTo: ledgerEntry._id });
        syncedCount++;
      } catch (err) {
        errors.push({ paymentId: payment._id, error: err.message });
        console.error(`Error syncing payment ${payment._id}:`, err.message);
      }
    }

    console.log(`✓ Synced ${syncedCount} payments successfully`);
    if (errors.length > 0) {
      console.log(`✗ Failed to sync ${errors.length} payments`);
    }

    return {
      synced: syncedCount,
      failed: errors.length,
      errors,
      message: `Synced ${syncedCount} payments to new ledger`
    };
  } catch (err) {
    console.error('Sync failed:', err.message);
    throw err;
  }
}

/**
 * Get unified ledger combining old and new payments
 */
async function getUnifiedLedger({ startDate, endDate, paymentMethod, transactionType }) {
  try {
    const query = {};

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    if (paymentMethod) query.paymentMethod = paymentMethod;
    if (transactionType) query.transactionType = transactionType;

    // Get from new PaymentLedger (already has debit/credit calculated)
    const newLedger = await PaymentLedger.find(query)
      .sort({ date: 1 })
      .lean();

    // Get from old Payment and convert format
    const oldPaymentQuery = {
      synced: { $ne: true } // Only get non-synced payments
    };

    if (startDate || endDate) {
      oldPaymentQuery.paymentDate = {};
      if (startDate) oldPaymentQuery.paymentDate.$gte = new Date(startDate);
      if (endDate) oldPaymentQuery.paymentDate.$lte = new Date(endDate);
    }

    if (paymentMethod) oldPaymentQuery.paymentMethod = paymentMethod;

    const oldPayments = await Payment.find(oldPaymentQuery).lean();

    // Convert old payments to new format
    const convertedOldPayments = oldPayments.map(p => ({
      _id: p._id,
      date: p.paymentDate || p.createdAt,
      transactionType: p.type === 'received' ? 'Sales' : 'Purchase',
      referenceModel: p.referenceModel,
      referenceNumber: p.referenceNumber,
      reference: p.reference,
      partyType: p.partyModel,
      partyId: p.party,
      partyName: p.partyName,
      amount: p.amount,
      paymentMethod: p.paymentMethod,
      transactionId: p.transactionId,
      description: p.notes || 'Payment',
      debit: p.type === 'made' ? p.amount : 0,
      credit: p.type === 'received' ? p.amount : 0,
      createdBy: p.createdBy,
      createdAt: p.createdAt,
      fromOldSystem: true
    }));

    // Filter converted old payments if transaction type is specified
    let filtered = convertedOldPayments;
    if (transactionType) {
      filtered = convertedOldPayments.filter(p => p.transactionType === transactionType);
    }

    // Combine and sort
    const allEntries = [...newLedger, ...filtered].sort((a, b) => new Date(a.date) - new Date(b.date));

    // Calculate running balance
    let runningBalance = 0;
    const withBalance = allEntries.map(entry => {
      runningBalance += (entry.credit || 0) - (entry.debit || 0);
      return {
        ...entry,
        runningBalance: parseFloat(runningBalance.toFixed(2))
      };
    });

    return withBalance;
  } catch (err) {
    console.error('Error getting unified ledger:', err.message);
    throw err;
  }
}

/**
 * Get unified summary combining old and new payments
 */
async function getUnifiedSummary({ startDate, endDate }) {
  try {
    const allEntries = await getUnifiedLedger({ startDate, endDate });

    const summary = {
      totalCredit: 0,
      totalDebit: 0,
      netBalance: 0,
      byPaymentMethod: {},
      byTransactionType: {
        Sales: { count: 0, amount: 0 },
        Purchase: { count: 0, amount: 0 }
      },
      newLedgerCount: 0,
      oldPaymentCount: 0
    };

    allEntries.forEach(entry => {
      // Totals
      if (entry.credit > 0) summary.totalCredit += entry.credit;
      if (entry.debit > 0) summary.totalDebit += entry.debit;

      // By payment method
      if (!summary.byPaymentMethod[entry.paymentMethod]) {
        summary.byPaymentMethod[entry.paymentMethod] = { credit: 0, debit: 0, count: 0 };
      }
      summary.byPaymentMethod[entry.paymentMethod].credit += entry.credit || 0;
      summary.byPaymentMethod[entry.paymentMethod].debit += entry.debit || 0;
      summary.byPaymentMethod[entry.paymentMethod].count += 1;

      // By transaction type
      summary.byTransactionType[entry.transactionType].count += 1;
      summary.byTransactionType[entry.transactionType].amount += entry.amount;

      // Track source
      if (entry.fromOldSystem) {
        summary.oldPaymentCount += 1;
      } else {
        summary.newLedgerCount += 1;
      }
    });

    summary.netBalance = summary.totalCredit - summary.totalDebit;
    return summary;
  } catch (err) {
    console.error('Error getting unified summary:', err.message);
    throw err;
  }
}

module.exports = {
  syncExistingPayments,
  getUnifiedLedger,
  getUnifiedSummary
};
