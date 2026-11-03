require('dotenv').config();

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { pool } = require('./db');

const app = express();
const port = Number(process.env.PORT || 3000);

app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '64kb' }));
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false
}));

// Phase 1 diagnostic endpoint. Application routes will require
// authentication and authorization when those features are added.
app.get('/api/health/db', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT version() AS postgres_version');
    res.json({
      ok: true,
      database: 'connected',
      postgresVersion: result.rows[0].postgres_version
    });
  } catch (error) {
    next(error);
  }
});

app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

app.use((error, req, res, next) => {
  console.error('Request failed:', error.message);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'The server could not complete the request.' });
});

async function start() {
  try {
    const result = await pool.query('SELECT version() AS postgres_version');
    console.log('PostgreSQL connection successful.');
    console.log(result.rows[0].postgres_version);

    app.listen(port, '127.0.0.1', () => {
      console.log(`Application running at http://127.0.0.1:${port}`);
    });
  } catch (error) {
    console.error('Could not connect to PostgreSQL.');
    console.error('Check that PostgreSQL is running and that .env has the correct local settings.');
    console.error('Database error:', error.message);
    process.exitCode = 1;
    await pool.end();
  }
}

start();
