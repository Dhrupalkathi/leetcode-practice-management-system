require('dotenv').config();

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { pool } = require('./db');

const app = express();
const port = Number(process.env.PORT || 3000);
const devOrganizerId = Number(process.env.DEV_ORGANIZER_ID || 0);

app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '64kb' }));
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false
}));

app.get('/api/health/db', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT version() AS postgres_version');
    res.json({ ok: true, database: 'connected', postgresVersion: result.rows[0].postgres_version });
  } catch (error) {
    next(error);
  }
});

function validateProblem(body, { partial = false } = {}) {
  const errors = [];
  const fields = ['title', 'problem_statement', 'input_format', 'output_format', 'difficulty'];
  for (const field of fields) {
    if (!partial || Object.hasOwn(body, field)) {
      if (typeof body[field] !== 'string' || body[field].trim().length === 0) {
        errors.push(`${field} is required`);
      }
    }
  }
  if ((!partial || Object.hasOwn(body, 'difficulty')) &&
      !['Easy', 'Medium', 'Hard'].includes(body.difficulty)) {
    errors.push('difficulty must be Easy, Medium, or Hard');
  }
  if (Object.hasOwn(body, 'constraints') &&
      body.constraints !== null && typeof body.constraints !== 'string') {
    errors.push('constraints must be text or null');
  }
  return errors;
}

// Read: only active problems are shown by default. ?includeInactive=true is
// available for this localhost-only development interface.
app.get('/api/problems', async (req, res, next) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const result = await pool.query(
      `SELECT problem_id, title, problem_statement, input_format, output_format,
              constraints, difficulty, is_active, created_at, created_by
       FROM public.problem
       WHERE ($1::boolean OR is_active = TRUE)
       ORDER BY problem_id`,
      [includeInactive]
    );
    res.json({ problems: result.rows });
  } catch (error) { next(error); }
});

app.get('/api/problems/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid problem ID.' });
  try {
    const result = await pool.query(
      `SELECT problem_id, title, problem_statement, input_format, output_format,
              constraints, difficulty, is_active, created_at, created_by
       FROM public.problem WHERE problem_id = $1`,
      [id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Problem not found.' });
    res.json({ problem: result.rows[0] });
  } catch (error) { next(error); }
});

// Local development only: DEV_ORGANIZER_ID is a temporary creator identity.
// Replace this with authenticated server-side identity before deployment.
app.post('/api/problems', async (req, res, next) => {
  const errors = validateProblem(req.body);
  if (errors.length) return res.status(400).json({ error: 'Validation failed.', details: errors });
  if (!Number.isSafeInteger(devOrganizerId) || devOrganizerId <= 0) {
    return res.status(503).json({ error: 'Set DEV_ORGANIZER_ID to an existing organizer ID in local .env for development.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO public.problem
         (title, problem_statement, input_format, output_format, constraints, difficulty, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING problem_id, title, problem_statement, input_format, output_format,
                 constraints, difficulty, is_active, created_at, created_by`,
      [
        req.body.title.trim(), req.body.problem_statement.trim(),
        req.body.input_format.trim(), req.body.output_format.trim(),
        req.body.constraints?.trim() || null, req.body.difficulty, devOrganizerId
      ]
    );
    res.status(201).json({ problem: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'A problem with that title already exists.' });
    if (error.code === '23503') return res.status(400).json({ error: 'The configured creator is not a valid organizer.' });
    next(error);
  }
});

app.put('/api/problems/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid problem ID.' });
  const errors = validateProblem(req.body);
  if (errors.length) return res.status(400).json({ error: 'Validation failed.', details: errors });
  try {
    const result = await pool.query(
      `UPDATE public.problem
       SET title = $1, problem_statement = $2, input_format = $3,
           output_format = $4, constraints = $5, difficulty = $6
       WHERE problem_id = $7
       RETURNING problem_id, title, problem_statement, input_format, output_format,
                 constraints, difficulty, is_active, created_at, created_by`,
      [
        req.body.title.trim(), req.body.problem_statement.trim(),
        req.body.input_format.trim(), req.body.output_format.trim(),
        req.body.constraints?.trim() || null, req.body.difficulty, id
      ]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Problem not found.' });
    res.json({ problem: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'A problem with that title already exists.' });
    next(error);
  }
});

// Retire rather than DELETE: submissions, test cases and relationships remain.
app.patch('/api/problems/:id/retire', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid problem ID.' });
  try {
    const result = await pool.query(
      `UPDATE public.problem SET is_active = FALSE
       WHERE problem_id = $1
       RETURNING problem_id, title, is_active`,
      [id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Problem not found.' });
    res.json({ problem: result.rows[0], message: 'Problem retired. Related history was preserved.' });
  } catch (error) { next(error); }
});

app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found' }));
app.use((error, req, res, next) => {
  console.error('Request failed:', error.message);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'The server could not complete the request.' });
});

async function start() {
  try {
    const result = await pool.query('SELECT version() AS postgres_version');
    console.log('PostgreSQL connection successful:', result.rows[0].postgres_version);
    app.listen(port, '127.0.0.1', () => console.log(`Application running at http://127.0.0.1:${port}`));
  } catch (error) {
    console.error('Could not connect to PostgreSQL. Check local .env settings:', error.message);
    process.exitCode = 1;
    await pool.end();
  }
}
start();
