const mongoose = require('mongoose');

async function connectDB() {
  try {
    const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/whispr';
    await mongoose.connect(uri);
    console.log('[whispr] MongoDB connected ->', mongoose.connection.name);
  } catch (err) {
    console.error('[whispr] MongoDB connection failed:', err.message);
    process.exit(1);
  }
}

module.exports = connectDB;
