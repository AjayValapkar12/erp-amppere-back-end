require('dotenv').config();
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
