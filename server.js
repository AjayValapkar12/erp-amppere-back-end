require('dotenv').config();
const dns = require('dns');

if (process.env.MONGODB_URI && process.env.MONGODB_URI.startsWith('mongodb+srv')) {
  try {
    const customDns = process.env.DNS_SERVERS
      ? process.env.DNS_SERVERS.split(',').map((s) => s.trim())
      : ['8.8.8.8', '1.1.1.1'];
    dns.setServers(customDns);
  } catch (e) {
    console.warn('Could not set custom DNS servers:', e.message);
  }
}

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const http = require('http');
const https = require('https');

const User = require('./models/User');
const { startOutstandingReminderScheduler } = require('./services/outstandingReminder');
const { ensureDefaultAccounts } = require('./services/ledgerService');

const app = express();

function pingUrl(url) {
  return new Promise((resolve, reject) => {
    try {
      const client = url.startsWith('https') ? https : http;
      const req = client.get(url, (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.statusCode);
          return;
        }
        reject(new Error(`Unexpected status code ${res.statusCode}`));
      });

      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.destroy(new Error('Self-ping request timed out'));
      });
    } catch (error) {
      reject(error);
    }
  });
}

function startSelfPing(port) {
  const baseUrl =
    process.env.SELF_PING_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    (process.env.NODE_ENV === 'production' ? null : `http://localhost:${port}`);

  if (!baseUrl) {
    console.log('Self-ping disabled: set SELF_PING_URL or RENDER_EXTERNAL_URL.');
    return;
  }

  const targetUrl = `${baseUrl.replace(/\/+$/, '')}/api/health`;
  const intervalMs = 15 * 60 * 1000;

  const runPing = async () => {
    try {
      const status = await pingUrl(targetUrl);
      console.log(`Self-ping OK (${status}) -> ${targetUrl}`);
    } catch (error) {
      console.error(`Self-ping failed -> ${targetUrl}:`, error.message);
    }
  };

  runPing();
  setInterval(runPing, intervalMs);
}

/* ======================
   MIDDLEWARE
====================== */

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174'
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // allow requests with no origin (like mobile apps, curl, or Postman)
    if (!origin) return callback(null, true);
    if (process.env.NODE_ENV !== 'production' || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS policy does not allow access from origin ${origin}`));
  },
  credentials: true
}));

app.use(express.json());
app.use(morgan('dev'));


/* ======================
   ROUTES
====================== */

app.use('/api/auth', require('./routes/auth'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/vendors', require('./routes/vendors'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/purchases', require('./routes/purchases'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/ledger', require('./routes/ledger'));
app.use('/api/payment-ledger', require('./routes/paymentLedger'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/invoices', require('./routes/Invoices'));
app.use('/api/reminders', require('./routes/reminders'));


/* ======================
   ROOT LANDING & HEALTH CHECK
====================== */

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Cable ERP API</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
        .card { background: #1e293b; border-radius: 12px; padding: 32px; max-width: 600px; width: 100%; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3); border: 1px solid #334155; }
        .badge { display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: 13px; font-weight: 600; background: #065f46; color: #34d399; margin-bottom: 16px; }
        h1 { margin: 0 0 8px; font-size: 24px; color: #fff; }
        p { color: #94a3b8; line-height: 1.5; margin: 0 0 20px; }
        .endpoints { background: #0f172a; border-radius: 8px; padding: 16px; border: 1px solid #334155; }
        .endpoints h3 { margin: 0 0 12px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; }
        ul { list-style: none; padding: 0; margin: 0; }
        li { padding: 8px 0; border-bottom: 1px solid #1e293b; display: flex; justify-content: space-between; font-family: monospace; font-size: 13px; }
        li:last-child { border-bottom: none; }
        a { color: #38bdf8; text-decoration: none; }
        a:hover { text-decoration: underline; }
      </style>
    </head>
    <body>
      <div class="card">
        <span class="badge">● Online</span>
        <h1>Cable ERP Backend API</h1>
        <p>The backend server is running successfully. This service provides RESTful API endpoints for the ERP frontend application.</p>
        <div class="endpoints">
          <h3>Quick Links</h3>
          <ul>
            <li><span>Health Check</span> <a href="/api/health" target="_blank">/api/health</a></li>
            <li><span>Auth API</span> <code>/api/auth</code></li>
            <li><span>Invoices API</span> <code>/api/invoices</code></li>
            <li><span>Customers API</span> <code>/api/customers</code></li>
            <li><span>Vendors API</span> <code>/api/vendors</code></li>
            <li><span>Sales API</span> <code>/api/sales</code></li>
            <li><span>Dashboard API</span> <code>/api/dashboard</code></li>
          </ul>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Cable ERP API Running'
  });
});


/* ======================
   ERROR HANDLER
====================== */

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: err.message || 'Server Error'
  });
});


/* ======================
   CREATE DEFAULT ADMIN
===================== */

async function createAdminIfNotExists() {
  try {
    const existing = await User.findOne({ email: 'admin@cableerp.com' });

    if (!existing) {
      await User.create({
        name: 'Admin User',
        email: 'admin@cableerp.com',
        password: 'Admin@1234', // Make sure password is hashed in User model
        role: 'admin'
      });

      console.log('✅ Default Admin Created');
    } else {
      console.log('ℹ️ Admin already exists');
    }
  } catch (error) {
    console.error('Error creating admin:', error);
  }
}


/* ======================
   DATABASE CONNECTION
====================== */

const PORT = process.env.PORT || 5000;

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✅ MongoDB Connected');

    // Create admin only once
    await createAdminIfNotExists();
    await ensureDefaultAccounts();

    app.listen(PORT, () => {
      startSelfPing(PORT);
      startOutstandingReminderScheduler();
      console.log(`🚀 Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ DB Connection Error:', err);
    process.exit(1);
  });
