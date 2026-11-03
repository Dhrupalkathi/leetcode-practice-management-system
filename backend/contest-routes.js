const express = require('express');

function validId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function validateContest(body) {
  const errors = [];
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const rules = body.rules == null ? '' : body.rules;
  const startTime = typeof body.start_time === 'string' ? body.start_time : '';
  const endTime = typeof body.end_time === 'string' ? body.end_time : '';
  const start = Date.parse(startTime);
  const end = Date.parse(endTime);
  if (!name) errors.push('Contest name is required.');
  if (name.length > 100) errors.push('Contest name must be 100 characters or fewer.');
  if (typeof rules !== 'string') errors.push('Contest rules must be text.');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    errors.push('Enter valid contest start and end times; the end must be after the start.');
  }
  const problemIds = Array.isArray(body.problem_ids) ? body.problem_ids.map(Number) : [];
  if (!problemIds.length) errors.push('Select at least one problem.');
  if (problemIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) errors.push('Problem IDs must be positive integers.');
  if (new Set(problemIds).size !== problemIds.length) errors.push('A problem can only be added once to a contest.');
  if (problemIds.length > 50) errors.push('A contest can contain at most 50 problems.');
  return { errors, name, rules: typeof rules === 'string' ? rules.trim() : '', startTime, endTime, problemIds };
}

module.exports = function createContestRouter({ pool, authRequired, allowRoles }) {
  const router = express.Router();

  router.get('/contests', async (req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT c.contest_id, c.name, c.start_time, c.end_time, c.rules,
                c.created_at, c.organizer_id, COALESCE(organizer_user.name, creator_user.name, 'Platform') AS organizer_name,
                (SELECT COUNT(*)::integer FROM public.includes i WHERE i.contest_id=c.contest_id) AS problem_count,
                (SELECT COUNT(*)::integer FROM public.contest_registration cr WHERE cr.contest_id=c.contest_id) AS participant_count,
                EXISTS(SELECT 1 FROM public.contest_registration cr WHERE cr.contest_id=c.contest_id AND cr.learner_id=$1) AS is_registered,
                CASE WHEN CURRENT_TIMESTAMP < c.start_time THEN 'UPCOMING'
                     WHEN CURRENT_TIMESTAMP < c.end_time THEN 'LIVE' ELSE 'ENDED' END AS contest_status
         FROM public.contest c
         LEFT JOIN public.organizer o ON o.organizer_id=c.organizer_id
         LEFT JOIN public.users organizer_user ON organizer_user.user_id=o.organizer_id
         LEFT JOIN public.users creator_user ON creator_user.user_id=c.created_by_user_id
         ORDER BY c.start_time DESC, c.contest_id DESC`,
        [req.session.userId || null]
      );
      res.json({ contests: result.rows });
    } catch (error) { next(error); }
  });

  router.get('/contests/:id', async (req, res, next) => {
    const contestId = validId(req.params.id);
    if (!contestId) return res.status(400).json({ error: 'Invalid contest ID.' });
    try {
      const result = await pool.query(
        `SELECT c.contest_id, c.name, c.start_time, c.end_time, c.rules,
                c.created_at, c.organizer_id, COALESCE(organizer_user.name, creator_user.name, 'Platform') AS organizer_name,
                (SELECT COUNT(*)::integer FROM public.contest_registration cr WHERE cr.contest_id=c.contest_id) AS participant_count,
                EXISTS(SELECT 1 FROM public.contest_registration cr WHERE cr.contest_id=c.contest_id AND cr.learner_id=$2) AS is_registered,
                CASE WHEN CURRENT_TIMESTAMP < c.start_time THEN 'UPCOMING'
                     WHEN CURRENT_TIMESTAMP < c.end_time THEN 'LIVE' ELSE 'ENDED' END AS contest_status
         FROM public.contest c
         LEFT JOIN public.organizer o ON o.organizer_id=c.organizer_id
         LEFT JOIN public.users organizer_user ON organizer_user.user_id=o.organizer_id
         LEFT JOIN public.users creator_user ON creator_user.user_id=c.created_by_user_id
         WHERE c.contest_id=$1`,
        [contestId, req.session.userId || null]
      );
      if (!result.rowCount) return res.status(404).json({ error: 'Contest not found.' });
      const problems = await pool.query(
        `SELECT p.problem_id, p.title, p.difficulty, p.is_active
         FROM public.includes i JOIN public.problem p ON p.problem_id=i.problem_id
         WHERE i.contest_id=$1 ORDER BY p.problem_id`,
        [contestId]
      );
      res.json({ contest: result.rows[0], problems: problems.rows });
    } catch (error) { next(error); }
  });

  router.get('/contests/:id/leaderboard', async (req, res, next) => {
    const contestId = validId(req.params.id);
    if (!contestId) return res.status(400).json({ error: 'Invalid contest ID.' });
    try {
      const exists = await pool.query('SELECT 1 FROM public.contest WHERE contest_id=$1', [contestId]);
      if (!exists.rowCount) return res.status(404).json({ error: 'Contest not found.' });
      const result = await pool.query(
        `SELECT RANK() OVER (ORDER BY cr.score DESC, cr.penalty ASC, cr.registered_at ASC, cr.learner_id ASC)::integer AS rank,
                cr.learner_id, u.name AS learner_name, cr.registered_at, cr.score, cr.penalty
         FROM public.contest_registration cr JOIN public.users u ON u.user_id=cr.learner_id
         WHERE cr.contest_id=$1 ORDER BY rank, cr.learner_id`,
        [contestId]
      );
      res.json({ leaderboard: result.rows, scoring: {
        points_per_solved_problem: 100,
        penalty_per_wrong_attempt_before_acceptance: 5,
        ranking: 'Higher score, then lower penalty, then earlier registration.'
      } });
    } catch (error) { next(error); }
  });

  router.post('/contests', authRequired, allowRoles('Organizer', 'Admin'), async (req, res, next) => {
    const input = validateContest(req.body);
    if (input.errors.length) return res.status(400).json({ error: 'Validation failed.', details: input.errors });
    if (req.user.role_category === 'Organizer' && !req.user.organizer_id) return res.status(403).json({ error: 'An Organizer profile is required to create a contest.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const active = await client.query(
        'SELECT problem_id FROM public.problem WHERE is_active=TRUE AND problem_id=ANY($1::integer[])',
        [input.problemIds]
      );
      if (active.rowCount !== input.problemIds.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Every selected problem must exist and be active.' });
      }
      const created = await client.query(
        `INSERT INTO public.contest (name,start_time,end_time,rules,organizer_id,created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING contest_id,name,start_time,end_time,rules,organizer_id,created_at`,
        [input.name,input.startTime,input.endTime,input.rules || null,req.user.organizer_id || null,req.user.user_id]
      );
      const contest = created.rows[0];
      await client.query('INSERT INTO public.includes (contest_id,problem_id) SELECT $1, unnest($2::integer[])', [contest.contest_id,input.problemIds]);
      await client.query('COMMIT');
      res.status(201).json({ contest, problem_count: input.problemIds.length });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') return res.status(409).json({ error: 'A contest with that name already exists.' });
      next(error);
    } finally { client.release(); }
  });

  router.put('/contests/:id', authRequired, allowRoles('Organizer', 'Admin'), async (req, res, next) => {
    const contestId = validId(req.params.id);
    if (!contestId) return res.status(400).json({ error: 'Invalid contest ID.' });
    const input = validateContest(req.body);
    if (input.errors.length) return res.status(400).json({ error: 'Validation failed.', details: input.errors });
    if (req.user.role_category === 'Organizer' && !req.user.organizer_id) return res.status(403).json({ error: 'An Organizer profile is required.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE public.contest SET name=$1,start_time=$2,end_time=$3,rules=$4
         WHERE contest_id=$5 AND start_time>CURRENT_TIMESTAMP
           AND (($7='Admin') OR ($7='Organizer' AND organizer_id=$6))
         RETURNING contest_id,name,start_time,end_time,rules,organizer_id,created_at`,
        [input.name,input.startTime,input.endTime,input.rules || null,contestId,req.user.organizer_id,req.user.role_category]
      );
      if (!updated.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Contest not found, not owned by you, or already started.' });
      }
      const active = await client.query(
        'SELECT problem_id FROM public.problem WHERE is_active=TRUE AND problem_id=ANY($1::integer[])',
        [input.problemIds]
      );
      if (active.rowCount !== input.problemIds.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Every selected problem must exist and be active.' });
      }
      await client.query('DELETE FROM public.includes WHERE contest_id=$1', [contestId]);
      await client.query('INSERT INTO public.includes (contest_id,problem_id) SELECT $1, unnest($2::integer[])', [contestId,input.problemIds]);
      await client.query('COMMIT');
      res.json({ contest: updated.rows[0], problem_count: input.problemIds.length });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') return res.status(409).json({ error: 'A contest with that name already exists.' });
      next(error);
    } finally { client.release(); }
  });

  router.post('/contests/:id/register', authRequired, allowRoles('Learner'), async (req, res, next) => {
    const contestId = validId(req.params.id);
    if (!contestId) return res.status(400).json({ error: 'Invalid contest ID.' });
    try {
      const registration = await pool.query(
        `INSERT INTO public.contest_registration (contest_id,learner_id)
         SELECT contest_id,$2 FROM public.contest
         WHERE contest_id=$1
           AND start_time>CURRENT_TIMESTAMP
           AND end_time>CURRENT_TIMESTAMP
         ON CONFLICT (contest_id,learner_id) DO NOTHING
         RETURNING contest_id,learner_id,registered_at,score,penalty`,
        [contestId,req.user.user_id]
      );
      if (!registration.rowCount) {
        const existingContest = await pool.query('SELECT 1 FROM public.contest WHERE contest_id=$1', [contestId]);
        if (!existingContest.rowCount) return res.status(404).json({ error: 'Contest not found.' });
        const open = await pool.query(
          'SELECT start_time>CURRENT_TIMESTAMP AS registration_open FROM public.contest WHERE contest_id=$1',
          [contestId]
        );
        if (!open.rows[0].registration_open) {
          return res.status(409).json({ error: 'Registration has closed because this contest has started.' });
        }
        return res.status(409).json({ error: 'You are already registered for this contest.' });
      }
      res.status(201).json({ registration: registration.rows[0] });
    } catch (error) { next(error); }
  });

  return router;
};