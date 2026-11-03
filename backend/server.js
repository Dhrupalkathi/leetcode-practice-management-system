require('dotenv').config();

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const argon2 = require('argon2');
const { rateLimit } = require('express-rate-limit');
const { pool } = require('./db');
const createProblemDiscoveryRouter = require('./problem-discovery');
const createSubmissionRouter = require('./submission-routes');
const createProgressRouter = require('./progress-routes');
const createContestRouter = require('./contest-routes');
const createAssessmentRouter = require('./assessment-routes');
const createCandidateAssessmentRouter = require('./candidate-assessment-routes');

const app = express();
const port = Number(process.env.PORT || 3000);
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error('Set SESSION_SECRET in .env to a random value of at least 32 characters.');
}
const PgSession = connectPgSimple(session);

app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '64kb' }));
app.use(session({
  store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: false }),
  name: 'practice.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000,
    path: '/'
  }
}));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }));
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10,
  standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' }
});

// SameSite cookies and Origin checking protect browser state-changing requests.
app.use('/api', (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin && origin !== `${req.protocol}://${req.get('host')}`) {
    return res.status(403).json({ error: 'Cross-origin request blocked.' });
  }
  next();
});

function roleCategory(roleName) {
  const value = String(roleName || '');
  const marker = value.lastIndexOf(' L');
  return marker < 0 ? value : value.slice(0, marker);
}

function shapeUser(row) {
  return {
    user_id: row.user_id, name: row.name, email: row.email,
    role_id: row.role_id, role_name: row.role_name,
    role_category: roleCategory(row.role_name),
    organizer_id: row.organizer_id ?? null
  };
}
async function authRequired(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please log in first.' });
  try {
    const result = await pool.query(
      `SELECT u.user_id,u.name,u.email,u.role_id,u.is_active,r.role_name,o.organizer_id
       FROM public.users u JOIN public.role r ON r.role_id=u.role_id
       LEFT JOIN public.organizer o ON o.organizer_id=u.user_id
       WHERE u.user_id=$1`,
      [req.session.userId]
    );
    if (!result.rowCount || !result.rows[0].is_active) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'Account is unavailable. Please sign in again.' });
    }
    req.user = shapeUser(result.rows[0]);
    next();
  } catch (error) { next(error); }
}
function allowRoles(...categories) {
  return (req, res, next) => {
    if (!req.user || !categories.includes(req.user.role_category)) {
      return res.status(403).json({ error: 'Your role does not have permission to do this.' });
    }
    next();
  };
}
function validateProblem(body) {
  const errors = [];
  for (const field of ['title','problem_statement','input_format','output_format','difficulty']) {
    if (typeof body[field] !== 'string' || !body[field].trim()) errors.push(`${field} is required`);
  }
  if (!['Easy','Medium','Hard'].includes(body.difficulty)) errors.push('difficulty must be Easy, Medium, or Hard');
  if (body.constraints !== undefined && body.constraints !== null && typeof body.constraints !== 'string') {
    errors.push('constraints must be text or null');
  }
  return errors;
}

app.get('/api/health/db', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT version() AS postgres_version');
    res.json({ ok: true, database: 'connected', postgresVersion: result.rows[0].postgres_version });
  } catch (error) { next(error); }
});

const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, limit: 5,
  standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Too many account creation attempts. Try again later.' }
});

app.post('/api/auth/register', registrationLimiter, async (req, res, next) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) {
    return res.status(400).json({ error: 'Enter a valid name and email address.' });
  }
  if (password.length < 10 || password.length > 1024) {
    return res.status(400).json({ error: 'Password must be between 10 and 1024 characters.' });
  }
  try {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const client = await pool.connect();
    let user;
    try {
      await client.query('BEGIN');
      const role = await client.query(
        `SELECT role_id,role_name FROM public.role WHERE role_name='Learner L1'`
      );
      if (!role.rowCount) throw new Error('The default Learner role is not configured.');
      const inserted = await client.query(
        `INSERT INTO public.users (name,email,password_hash,is_active,role_id)
         VALUES ($1,$2,$3,TRUE,$4)
         RETURNING user_id,name,email,role_id`,
        [name,email,passwordHash,role.rows[0].role_id]
      );
      user = inserted.rows[0];
      await client.query(
        'INSERT INTO public.learner (learner_id,current_streak,solved_count) VALUES ($1,0,0)',
        [user.user_id]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') return res.status(409).json({ error: 'An account with this email already exists.' });
      throw error;
    } finally { client.release(); }
    await new Promise((resolve,reject)=>req.session.regenerate(error=>error?reject(error):resolve()));
    req.session.userId=user.user_id;
    res.status(201).json({
      user: { user_id:user.user_id,name:user.name,email:user.email,role_id:user.role_id,
        role_name:'Learner L1',role_category:'Learner',organizer_id:null },
      message:'Your Learner account has been created.'
    });
  } catch (error) { next(error); }
});
app.post('/api/auth/login', loginLimiter, async (req, res, next) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!email || !password || email.length > 320 || password.length > 1024) {
    return res.status(400).json({ error: 'Enter a valid email and password.' });
  }
  try {
    const result = await pool.query(
      `SELECT u.user_id,u.name,u.email,u.password_hash,u.role_id,u.is_active,
              r.role_name,o.organizer_id
       FROM public.users u JOIN public.role r ON r.role_id=u.role_id
       LEFT JOIN public.organizer o ON o.organizer_id=u.user_id
       WHERE LOWER(u.email)=$1`,
      [email]
    );
    if (!result.rowCount || !result.rows[0].is_active) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const row = result.rows[0];
    const stored = String(row.password_hash).trim();
    let valid = false;
    let needsUpgrade = false;
    if (stored.startsWith('$argon2')) {
      valid = await argon2.verify(stored, password);
    } else if (/^[a-f0-9]{64}$/i.test(stored)) {
      const actual = crypto.createHash('sha256').update(password, 'utf8').digest();
      const expected = Buffer.from(stored, 'hex');
      valid = actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
      needsUpgrade = valid;
    }
    if (!valid) return res.status(401).json({ error: 'Invalid email or password.' });

    if (needsUpgrade) {
      const upgraded = await argon2.hash(password, { type: argon2.argon2id });
      await pool.query('UPDATE public.users SET password_hash=$1 WHERE user_id=$2', [upgraded, row.user_id]);
    }
    await new Promise((resolve, reject) => {
      req.session.regenerate(error => error ? reject(error) : resolve());
    });
    req.session.userId = row.user_id;
    res.json({ user: shapeUser(row), passwordUpgraded: needsUpgrade });
  } catch (error) { next(error); }
});
app.get('/api/auth/me', authRequired, (req, res) => res.json({ user: req.user }));
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(error => {
    if (error) return res.status(500).json({ error: 'Could not end the session.' });
    res.clearCookie('practice.sid', { httpOnly: true, sameSite: 'strict', path: '/' });
    res.json({ ok: true });
  });
});

app.use('/api', createProblemDiscoveryRouter({ pool, authRequired }));
app.use('/api', createSubmissionRouter({ pool, authRequired, allowRoles }));
app.use('/api', createProgressRouter({ pool, authRequired, allowRoles }));
app.use('/api', createContestRouter({ pool, authRequired, allowRoles }));
app.use('/api', createAssessmentRouter({ pool, authRequired, allowRoles }));
app.use('/api/candidate-assessment', createCandidateAssessmentRouter({ pool }));

app.get('/api/problems', async (req, res, next) => {
  try {
    const includeInactive = req.query.includeInactive === 'true' && Boolean(req.session.userId);
    const result = await pool.query(
      `SELECT problem_id,title,problem_statement,input_format,output_format,constraints,
              difficulty,is_active,created_at,created_by
       FROM public.problem WHERE ($1::boolean OR is_active=TRUE) ORDER BY problem_id`,
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
      `SELECT problem_id,title,problem_statement,input_format,output_format,constraints,
              difficulty,is_active,created_at,created_by
       FROM public.problem WHERE problem_id=$1 AND (is_active=TRUE OR $2::boolean)`,
      [id, Boolean(req.session.userId)]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Problem not found.' });
    res.json({ problem: result.rows[0] });
  } catch (error) { next(error); }
});

app.post('/api/problems', authRequired, allowRoles('Organizer'), async (req, res, next) => {
  const errors = validateProblem(req.body);
  if (errors.length) return res.status(400).json({ error: 'Validation failed.', details: errors });
  if (!req.user.organizer_id) return res.status(403).json({ error: 'Organizer profile is missing.' });
  try {
    const result = await pool.query(
      `INSERT INTO public.problem(title,problem_statement,input_format,output_format,constraints,difficulty,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       RETURNING problem_id,title,problem_statement,input_format,output_format,constraints,
                 difficulty,is_active,created_at,created_by`,
      [req.body.title.trim(),req.body.problem_statement.trim(),req.body.input_format.trim(),
       req.body.output_format.trim(),req.body.constraints?.trim() || null,req.body.difficulty,req.user.organizer_id]
    );
    res.status(201).json({ problem: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'A problem with that title already exists.' });
    next(error);
  }
});
app.put('/api/problems/:id', authRequired, allowRoles('Organizer'), async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid problem ID.' });
  const errors = validateProblem(req.body);
  if (errors.length) return res.status(400).json({ error: 'Validation failed.', details: errors });
  try {
    const result = await pool.query(
      `UPDATE public.problem SET title=$1,problem_statement=$2,input_format=$3,
       output_format=$4,constraints=$5,difficulty=$6 WHERE problem_id=$7
       RETURNING problem_id,title,problem_statement,input_format,output_format,constraints,
                 difficulty,is_active,created_at,created_by`,
      [req.body.title.trim(),req.body.problem_statement.trim(),req.body.input_format.trim(),
       req.body.output_format.trim(),req.body.constraints?.trim() || null,req.body.difficulty,id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Problem not found.' });
    res.json({ problem: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'A problem with that title already exists.' });
    next(error);
  }
});
app.patch('/api/problems/:id/retire', authRequired, allowRoles('Organizer'), async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid problem ID.' });
  try {
    const result = await pool.query(
      'UPDATE public.problem SET is_active=FALSE WHERE problem_id=$1 RETURNING problem_id,title,is_active',
      [id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Problem not found.' });
    res.json({ problem: result.rows[0], message: 'Problem retired. Related history was preserved.' });
  } catch (error) { next(error); }
});

app.use(express.static(path.join(__dirname,'..','frontend')));
app.use('/api',(req,res)=>res.status(404).json({error:'API route not found'}));
app.use((error,req,res,next)=>{
  console.error('Request failed:',error.message);
  if(res.headersSent)return next(error);
  res.status(500).json({error:'The server could not complete the request.'});
});
async function start(){
  try{
    await pool.query(
      `UPDATE public.submission
       SET execution_status='FAILED',
           execution_error='The server restarted before execution completed. Please submit again.'
       WHERE execution_status IN ('PENDING','RUNNING')`
    );
    const result=await pool.query('SELECT version() AS postgres_version');
    console.log('PostgreSQL connection successful:',result.rows[0].postgres_version);
    app.listen(port,'127.0.0.1',()=>console.log(`Application running at http://127.0.0.1:${port}`));
  }catch(error){
    console.error('Could not connect to PostgreSQL. Check local .env settings:',error.message);
    process.exitCode=1;
    await pool.end();
  }
}
start();
