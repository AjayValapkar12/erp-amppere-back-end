require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');

const User = require('./models/User');

const app = express();

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
      console.log(`🚀 Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ DB Connection Error:', err);
    process.exit(1);
  });