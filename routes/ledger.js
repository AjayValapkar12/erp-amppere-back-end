const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { listAccounts, getLedgerByAccount, getTrialBalance, getLedgerByParty, getPartyBalance } = require('../services/ledgerService');

router.use(protect);

router.get('/accounts', async (req, res) => {
  try {
    const accounts = await listAccounts();
    res.json({ success: true, data: accounts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/account/:accountId', async (req, res) => {
  try {
    const accountId = req.params.accountId;
    const { startDate, endDate, party, partyModel } = req.query;
    const ledger = await getLedgerByAccount(accountId, { startDate, endDate, party, partyModel });
    res.json({ success: true, data: ledger });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/party', async (req, res) => {
  try {
    const { partyModel, partyId, startDate, endDate, direction } = req.query;
    if (!partyModel || !partyId) {
      return res.status(400).json({ success: false, message: 'partyModel and partyId are required' });
    }
    const ledger = await getLedgerByParty(partyId, partyModel, { startDate, endDate, direction });
    res.json({ success: true, data: ledger });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/party/summary', async (req, res) => {
  try {
    const { partyModel, partyId, startDate, endDate } = req.query;
    if (!partyModel || !partyId) {
      return res.status(400).json({ success: false, message: 'partyModel and partyId are required' });
    }
    const summary = await getPartyBalance(partyId, partyModel, { startDate, endDate });
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/trial-balance', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const report = await getTrialBalance({ startDate, endDate });
    res.json({ success: true, data: report });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
