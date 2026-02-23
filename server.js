require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const http = require('http');
const https = require('https');

const User = require('./models/User');

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

app.use(cors({
  origin: process.env.FRONTEND_URL,
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
app.use('/api/reports', require('./routes/reports'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/invoices', require('./routes/Invoices'));


/* ======================
   HEALTH CHECK
====================== */

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
====================== */

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

    app.listen(PORT, () => {
      startSelfPing(PORT);
      console.log(`🚀 Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ DB Connection Error:', err);
    process.exit(1);
  });
