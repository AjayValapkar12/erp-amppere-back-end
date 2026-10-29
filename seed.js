require('dotenv').config();
const dns = require('dns');

if (process.env.MONGODB_URI && process.env.MONGODB_URI.startsWith('mongodb+srv')) {
  try {
    const customDns = process.env.DNS_SERVERS ? process.env.DNS_SERVERS.split(',').map(s => s.trim()) : ['8.8.8.8', '1.1.1.1'];
    dns.setServers(customDns);
  } catch (e) {
    // Ignore if not supported
  }
}

const mongoose = require('mongoose');
const User = require('./models/User');

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const existing = await User.findOne({ email: 'admin@cableerp.com' });
  if (!existing) {
    await User.create({
      name: 'Admin User',
      email: 'admin@cableerp.com',
      password: 'Admin@1234',
      role: 'admin'
    });
    console.log('Admin user created: admin@cableerp.com / Admin@1234');
  } else {
    console.log('Admin user already exists');
  }
  
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
