/** Data layer: MongoDB connection with retry (waits for the DB container). */
const mongoose = require('mongoose');

async function connectDB(uri, name = 'service') {
  for (let attempt = 1; attempt <= 12; attempt++) {
    try {
      await mongoose.connect(uri);
      console.log(`[${name}] connected to MongoDB`);
      return;
    } catch (err) {
      console.log(`[${name}] MongoDB attempt ${attempt} failed (${err.message}); retrying in 3s`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error('Could not connect to MongoDB after several attempts');
}

module.exports = connectDB;
