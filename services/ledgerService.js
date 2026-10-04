const Account = require('../models/Account');
const LedgerEntry = require('../models/LedgerEntry');

const DEFAULT_ACCOUNTS = [
  { code: '1000', name: 'Cash', type: 'Asset', normalBalance: 'Debit' },
  { code: '1020', name: 'Bank Transfer', type: 'Asset', normalBalance: 'Debit' },
  { code: '1030', name: 'UPI', type: 'Asset', normalBalance: 'Debit' },
  { code: '1040', name: 'Cheque', type: 'Asset', normalBalance: 'Debit' },
  { code: '1200', name: 'Accounts Receivable', type: 'Asset', normalBalance: 'Debit' },
  { code: '1400', name: 'GST Input Tax', type: 'Asset', normalBalance: 'Debit' },
  { code: '2100', name: 'Accounts Payable', type: 'Liability', normalBalance: 'Credit' },
  { code: '2200', name: 'GST Output Tax', type: 'Liability', normalBalance: 'Credit' },
  { code: '4000', name: 'Sales Revenue', type: 'Income', normalBalance: 'Credit' },
  { code: '5000', name: 'Purchases', type: 'Expense', normalBalance: 'Debit' },
];

async function getOrCreateAccount({ code, name, type, normalBalance }) {
  let account = await Account.findOne({ code });
  if (!account) {
    account = await Account.create({ code, name, type, normalBalance });
  }
  return account;
}

async function ensureDefaultAccounts() {
  const created = {};
  for (const account of DEFAULT_ACCOUNTS) {
    created[account.code] = await getOrCreateAccount(account);
  }
  return created;
}

async function getAccountByCode(code) {
  return Account.findOne({ code });
}

async function getPaymentAccount(paymentMethod) {
  const codeMap = {
    cash: '1000',
    bank_transfer: '1020',
    upi: '1030',
    cheque: '1040',
  };
  return getAccountByCode(codeMap[paymentMethod] || '1020');
}

async function listAccounts() {
  return Account.find().sort('code');
}

async function postJournalEntry({ date, referenceModel, reference, referenceNumber, description, lines, createdBy, party, partyModel, partyName, paymentMethod, transactionId }) {
  const entries = lines.map(line => ({
    date,
    account: line.account,
    referenceModel,
    reference,
    referenceNumber,
    paymentMethod: line.paymentMethod || paymentMethod,
    transactionId: line.transactionId || transactionId,
    description,
    debit: line.debit || 0,
    credit: line.credit || 0,
    balanceType: line.debit ? 'Dr' : 'Cr',
    party,
    partyModel,
    partyName,
    createdBy,
  }));
  return LedgerEntry.insertMany(entries);
}

async function getLedgerByAccount(accountId, { startDate, endDate, party, partyModel }) {
  const query = { account: accountId };
  if (startDate || endDate) {
    query.date = {};
    if (startDate) query.date.$gte = new Date(startDate);
    if (endDate) query.date.$lte = new Date(endDate);
  }
  if (party) query.party = party;
  if (partyModel) query.partyModel = partyModel;
  return LedgerEntry.find(query).populate('account').sort('date');
}

async function getLedgerByParty(partyId, partyModel, { startDate, endDate, direction }) {
  const query = { party: partyId, partyModel };
  if (startDate || endDate) {
    query.date = {};
    if (startDate) query.date.$gte = new Date(startDate);
    if (endDate) query.date.$lte = new Date(endDate);
  }
  if (direction === 'debit') query.debit = { $gt: 0 };
  else if (direction === 'credit') query.credit = { $gt: 0 };

  return LedgerEntry.find(query).populate('account').sort('date');
}

async function getPartyBalance(partyId, partyModel, { startDate, endDate }) {
  const query = { party: partyId, partyModel };
  if (startDate || endDate) {
    query.date = {};
    if (startDate) query.date.$gte = new Date(startDate);
    if (endDate) query.date.$lte = new Date(endDate);
  }

  const entries = await LedgerEntry.find(query);
  const totals = entries.reduce((acc, entry) => {
    acc.debit += entry.debit || 0;
    acc.credit += entry.credit || 0;
    return acc;
  }, { debit: 0, credit: 0 });

  return {
    debit: totals.debit,
    credit: totals.credit,
    balance: totals.debit - totals.credit,
  };
}

async function getTrialBalance({ startDate, endDate }) {
  const query = {};
  if (startDate || endDate) {
    query.date = {};
    if (startDate) query.date.$gte = new Date(startDate);
    if (endDate) query.date.$lte = new Date(endDate);
  }

  const entries = await LedgerEntry.find(query).populate('account');
  const balanceMap = new Map();

  entries.forEach(entry => {
    const key = entry.account.code;
    if (!balanceMap.has(key)) {
      balanceMap.set(key, { account: entry.account, debit: 0, credit: 0 });
    }
    const row = balanceMap.get(key);
    row.debit += entry.debit || 0;
    row.credit += entry.credit || 0;
  });

  return Array.from(balanceMap.values()).map(row => ({
    account: row.account,
    debit: row.debit,
    credit: row.credit,
  }));
}

module.exports = {
  ensureDefaultAccounts,
  getAccountByCode,
  getPaymentAccount,
  listAccounts,
  postJournalEntry,
  getLedgerByAccount,
  getLedgerByParty,
  getPartyBalance,
  getTrialBalance,
};
