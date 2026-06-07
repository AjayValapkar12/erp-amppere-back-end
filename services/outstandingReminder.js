const nodemailer = require('nodemailer');
const Customer = require('../models/Customer');
const ReminderLog = require('../models/ReminderLog');

const REMINDER_TYPE = 'customer-outstanding-email';
const DEFAULT_TIMEZONE = process.env.REMINDER_TIMEZONE || 'Asia/Kolkata';
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

function getZonedParts(date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    dateKey: `${map.year}-${map.month}-${map.day}`
  };
}

function isReminderDay(date = new Date()) {
  const { day } = getZonedParts(date);
  return day === 1 || day === 15;
}

function getReminderRecipient() {
  return process.env.REMINDER_EMAIL_TO || process.env.COMPANY_EMAIL || '';
}

function hasMailConfig() {
  return Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    getReminderRecipient()
  );
}

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

function buildEmailHtml(customers, dateKey) {
  const rows = customers.map((customer) => `
    <tr>
      <td style="padding:8px;border:1px solid #d1d5db;">${customer.name || '-'}</td>
      <td style="padding:8px;border:1px solid #d1d5db;">${customer.phone || '-'}</td>
      <td style="padding:8px;border:1px solid #d1d5db;">${customer.email || '-'}</td>
      <td style="padding:8px;border:1px solid #d1d5db;text-align:right;">${Number(customer.outstandingBalance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
    </tr>
  `).join('');

  return `
    <div style="font-family:Arial,sans-serif;color:#111827;">
      <h2 style="margin-bottom:8px;">Customer Outstanding Reminder</h2>
      <p style="margin:0 0 16px;">Outstanding customers as of ${dateKey}.</p>
      <table style="border-collapse:collapse;width:100%;max-width:860px;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="padding:8px;border:1px solid #d1d5db;text-align:left;">Customer</th>
            <th style="padding:8px;border:1px solid #d1d5db;text-align:left;">Phone</th>
            <th style="padding:8px;border:1px solid #d1d5db;text-align:left;">Email</th>
            <th style="padding:8px;border:1px solid #d1d5db;text-align:right;">Outstanding Amount</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function buildEmailText(customers, dateKey) {
  const lines = customers.map((customer, index) =>
    `${index + 1}. ${customer.name || '-'} | Phone: ${customer.phone || '-'} | Email: ${customer.email || '-'} | Outstanding: ${Number(customer.outstandingBalance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  );

  return [
    `Customer Outstanding Reminder - ${dateKey}`,
    '',
    ...lines
  ].join('\n');
}

async function sendOutstandingReminder({ force = false } = {}) {
  const { dateKey } = getZonedParts(new Date());
  const runKey = `${REMINDER_TYPE}:${dateKey}`;
  const recipient = getReminderRecipient();

  if (!hasMailConfig()) {
    return { skipped: true, reason: 'Missing SMTP or reminder email configuration.' };
  }

  if (!force && !isReminderDay()) {
    return { skipped: true, reason: 'Today is not a reminder day.' };
  }

  const existingLog = await ReminderLog.findOne({ runKey });
  if (existingLog && !force) {
    return { skipped: true, reason: 'Reminder already sent for today.' };
  }

  const customers = await Customer.find({ outstandingBalance: { $gt: 0 } })
    .sort('-outstandingBalance')
    .select('name phone email outstandingBalance');

  if (customers.length === 0) {
    return { skipped: true, reason: 'No outstanding customers found.' };
  }

  const transporter = createTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const subject = `Customer Outstanding Reminder - ${dateKey}`;

  await transporter.sendMail({
    from,
    to: recipient,
    subject,
    text: buildEmailText(customers, dateKey),
    html: buildEmailHtml(customers, dateKey)
  });

  await ReminderLog.findOneAndUpdate(
    { runKey },
    {
      type: REMINDER_TYPE,
      runKey,
      sentAt: new Date(),
      recipient,
      customerCount: customers.length
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return {
    success: true,
    recipient,
    customerCount: customers.length,
    dateKey
  };
}

function startOutstandingReminderScheduler() {
  if (!hasMailConfig()) {
    console.log('Outstanding reminder scheduler disabled: SMTP or reminder email config missing.');
    return;
  }

  const run = async () => {
    try {
      const result = await sendOutstandingReminder();
      if (result.success) {
        console.log(`Outstanding reminder sent to ${result.recipient} for ${result.customerCount} customers.`);
      } else if (result.skipped) {
        console.log(`Outstanding reminder skipped: ${result.reason}`);
      }
    } catch (error) {
      console.error('Outstanding reminder failed:', error.message);
    }
  };

  run();
  setInterval(run, CHECK_INTERVAL_MS);
}

module.exports = {
  sendOutstandingReminder,
  startOutstandingReminderScheduler
};
