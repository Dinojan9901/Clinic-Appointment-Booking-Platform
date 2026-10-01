/**
 * MediConnect - Auth Service (bootstrap)
 * Layered structure:  routes (controller) -> controller (business logic) -> model (data).
 */
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const connectDB = require('./db');
const routes = require('./routes');
const seedDoctorAccounts = require('./seed');

const PORT = process.env.PORT || 4001;
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/auth_db';

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'auth-service' }));
app.use('/', routes);

// Central error handler.
app.use((err, _req, res, _next) => {
  console.error('[auth-service] error:', err.message);
  res.status(500).json({ error: 'internal server error' });
});

connectDB(MONGO_URL, 'auth-service')
  .then(seedDoctorAccounts)
  .then(() => {
    app.listen(PORT, () => console.log(`[auth-service] listening on port ${PORT}`));
  });
