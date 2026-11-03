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
  const ids = Array.isArray(body.problem_ids) ? body.problem_ids.map(Number) : [];
  const points = Number(body.points_per_problem ?? 100);
  const wrongPenalty = Number(body.wrong_attempt_penalty_minutes ?? 5);
  if (!name || name.length > 100) errors.push('Contest name is required and must be at most 100 characters.');
  if (typeof rules !== 'string') errors.push('Contest rules must be text.');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) errors.push('Enter valid contest start and end times; end must be after start.');
  else if (start <= Date.now()) errors.push('New contests must start in the future.');
  if (!ids.length || ids.length > 50) errors.push('Select between 1 and 50 problems.');
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) errors.push('Problem IDs must be unique positive integers.');
  if (!Number.isInteger(points) || points < 1 || points > 10000) errors.push('Points per solved problem must be from 1 to 10000.');
  if (!Number.isInteger(wrongPenalty) || wrongPenalty < 0 || wrongPenalty > 120) errors.push('Wrong-attempt penalty must be from 0 to 120 minutes.');
  if (body.time_penalty_enabled !== undefined && typeof body.time_penalty_enabled !== 'boolean') errors.push('Time penalty setting must be true or false.');
  return { errors, name, rules: typeof rules === 'string' ? rules.trim() : '', startTime, endTime, ids, points, wrongPenalty };
}

module.exports = function createContestRouter({ pool, authRequired, allowRoles }) {
  const router = express.Router();

  async function getContest(id) {
    const result = await pool.query('SELECT contest_id,organizer_id,created_by_user_id,start_time FROM public.contest WHERE contest_id=$1', [id]);
    return result.rows[0] || null;
  }

  function owns(req, contest) {
    return req.user.role_category === 'Admin' ||
      (req.user.role_category === 'Organizer' && req.user.organizer_id &&
       (Number(req.user.organizer_id) === Number(contest.organizer_id) ||
        Number(req.user.user_id) === Number(contest.created_by_user_id)));
  }

  async function requireOwner(req, res, next) {
    const id = validId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid contest ID.' });
    try {
      const contest = await getContest(id);
      if (!contest) return res.status(404).json({ error: 'Contest not found.' });
      if (!owns(req, contest)) return res.status(403).json({ error: 'You do not manage this contest.' });
      req.contest = contest;
      next();
    } catch (error) { next(error); }
  }

  async function requireProblemSetAccess(req, res, next) {
    const id = validId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid contest ID.' });
    try {
      const contest = await getContest(id);
      if (!contest) return res.status(404).json({ error: 'Contest not found.' });
      const moderator = req.user.role_category === 'Moderator';
      if (!owns(req, contest) && !moderator) return res.status(403).json({ error: 'You cannot edit this contest problem set.' });
      if (new Date(contest.start_time).getTime() <= Date.now()) return res.status(409).json({ error: 'The contest problem set is locked after the contest starts.' });
      req.contest = contest;
      next();
    } catch (error) { next(error); }
  }

  router.get('/organizer-options', authRequired, allowRoles('Admin'), async (req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT o.organizer_id,u.name,org.org_name
         FROM public.organizer o
         JOIN public.users u ON u.user_id=o.organizer_id
         JOIN public.organization org ON org.organization_id=o.organization_id
         WHERE u.is_active=TRUE ORDER BY u.name`
      );
      res.json({ organizers: result.rows });
    } catch (error) { next(error); }
  });

  router.get('/contests', async (req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT c.contest_id,c.name,c.start_time,c.end_time,c.rules,
                c.points_per_problem,c.wrong_attempt_penalty_minutes,c.time_penalty_enabled,
                c.organizer_id,COALESCE(ou.name,'Platform') AS organizer_name,
                (SELECT COUNT(*)::integer FROM public.includes i WHERE i.contest_id=c.contest_id) AS problem_count,
                (SELECT COUNT(*)::integer FROM public.contest_registration cr WHERE cr.contest_id=c.contest_id) AS participant_count,
                EXISTS(SELECT 1 FROM public.contest_registration cr WHERE cr.contest_id=c.contest_id AND cr.learner_id=$1) AS is_registered,
                (c.organizer_id=$1 OR c.created_by_user_id=$1 OR EXISTS(
                  SELECT 1 FROM public.users au JOIN public.role ar ON ar.role_id=au.role_id
                  WHERE au.user_id=$1 AND (ar.role_name LIKE 'Admin L%' OR ar.role_name LIKE 'Moderator L%')
                )) AS can_manage,
                CASE WHEN CURRENT_TIMESTAMP<c.start_time THEN 'UPCOMING'
                     WHEN CURRENT_TIMESTAMP<c.end_time THEN 'LIVE' ELSE 'ENDED' END AS contest_status
         FROM public.contest c
         LEFT JOIN public.users ou ON ou.user_id=c.organizer_id
         ORDER BY c.start_time DESC,c.contest_id DESC`,
        [req.session.userId || null]
      );
      res.json({ contests: result.rows });
    } catch (error) { next(error); }
  });

  router.get('/contests/:id', async (req, res, next) => {
    const id = validId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid contest ID.' });
    try {
      const result = await pool.query(
        `SELECT c.contest_id,c.name,c.start_time,c.end_time,c.rules,c.created_at,
                c.organizer_id,COALESCE(ou.name,'Platform') AS organizer_name,
                c.points_per_problem,c.wrong_attempt_penalty_minutes,c.time_penalty_enabled,
                (SELECT COUNT(*)::integer FROM public.contest_registration cr WHERE cr.contest_id=c.contest_id) AS participant_count,
                EXISTS(SELECT 1 FROM public.contest_registration cr WHERE cr.contest_id=c.contest_id AND cr.learner_id=$2) AS is_registered,
                (c.organizer_id=$2 OR c.created_by_user_id=$2 OR EXISTS(
                  SELECT 1 FROM public.users au JOIN public.role ar ON ar.role_id=au.role_id
                  WHERE au.user_id=$2 AND (ar.role_name LIKE 'Admin L%' OR ar.role_name LIKE 'Moderator L%')
                )) AS can_manage,
                CASE WHEN CURRENT_TIMESTAMP<c.start_time THEN 'UPCOMING'
                     WHEN CURRENT_TIMESTAMP<c.end_time THEN 'LIVE' ELSE 'ENDED' END AS contest_status
         FROM public.contest c LEFT JOIN public.users ou ON ou.user_id=c.organizer_id
         WHERE c.contest_id=$1`,
        [id,req.session.userId || null]
      );
      if (!result.rowCount) return res.status(404).json({ error: 'Contest not found.' });
      const contest = result.rows[0];
      if ((contest.contest_status==='UPCOMING' && !contest.can_manage) ||
          (contest.contest_status==='LIVE' && !contest.can_manage && !contest.is_registered)) {
        return res.json({ contest, problems: [], problems_locked: true });
      }
      const problems = await pool.query(
        `SELECT p.problem_id,p.title,p.difficulty,p.is_active,
                (SELECT COUNT(*)::integer FROM public.test_case tc WHERE tc.problem_id=p.problem_id AND tc.is_hidden=FALSE) AS sample_count
         FROM public.includes i JOIN public.problem p ON p.problem_id=i.problem_id
         WHERE i.contest_id=$1 ORDER BY p.problem_id`,
        [id]
      );
      res.json({ contest, problems: problems.rows, problems_locked: false });
    } catch (error) { next(error); }
  });

  router.get('/contests/:id/leaderboard', async (req, res, next) => {
    const id = validId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid contest ID.' });
    try {
      const contest = await pool.query('SELECT points_per_problem,wrong_attempt_penalty_minutes,time_penalty_enabled FROM public.contest WHERE contest_id=$1', [id]);
      if (!contest.rowCount) return res.status(404).json({ error: 'Contest not found.' });
      const rows = await pool.query(
        `SELECT RANK() OVER (ORDER BY cr.score DESC,cr.penalty ASC,cr.registered_at ASC)::integer AS rank,
                cr.learner_id,u.name AS learner_name,cr.registered_at,cr.score,cr.penalty
         FROM public.contest_registration cr JOIN public.users u ON u.user_id=cr.learner_id
         WHERE cr.contest_id=$1
         ORDER BY cr.score DESC,cr.penalty ASC,cr.registered_at ASC`,
        [id]
      );
      res.json({ leaderboard: rows.rows, scoring: contest.rows[0] });
    } catch (error) { next(error); }
  });

  router.post('/contests', authRequired, allowRoles('Organizer','Admin'), async (req, res, next) => {
    const input = validateContest(req.body);
    if (input.errors.length) return res.status(400).json({ error: 'Validation failed.', details: input.errors });
    const organizerId = req.user.role_category==='Organizer' ? req.user.organizer_id :
      (req.body.organizer_id == null || req.body.organizer_id === '' ? null : validId(req.body.organizer_id));
    if (req.user.role_category==='Organizer' && !organizerId) return res.status(403).json({ error: 'An Organizer profile is required.' });
    if (req.user.role_category==='Admin' && req.body.organizer_id != null && req.body.organizer_id !== '' && !organizerId) {
      return res.status(400).json({ error: 'Invalid Organizer profile ID.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (organizerId !== null) {
        const owner = await client.query(
          `SELECT o.organizer_id FROM public.organizer o JOIN public.users u ON u.user_id=o.organizer_id
           WHERE o.organizer_id=$1 AND u.is_active=TRUE`,
          [organizerId]
        );
        if (!owner.rowCount) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Selected Organizer profile is unavailable.' }); }
      }
      const active = await client.query('SELECT problem_id FROM public.problem WHERE is_active=TRUE AND problem_id=ANY($1::integer[])', [input.ids]);
      if (active.rowCount!==input.ids.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Every selected problem must exist and be active.' }); }
      const created = await client.query(
        `INSERT INTO public.contest
          (name,start_time,end_time,rules,organizer_id,created_by_user_id,points_per_problem,wrong_attempt_penalty_minutes,time_penalty_enabled)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING contest_id,name,start_time,end_time,rules,organizer_id,created_by_user_id,points_per_problem,wrong_attempt_penalty_minutes,time_penalty_enabled`,
        [input.name,input.startTime,input.endTime,input.rules||null,organizerId,req.user.user_id,input.points,input.wrongPenalty,req.body.time_penalty_enabled===true]
      );
      await client.query('INSERT INTO public.includes(contest_id,problem_id) SELECT $1,unnest($2::integer[])', [created.rows[0].contest_id,input.ids]);
      await client.query('COMMIT');
      res.status(201).json({ contest: created.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code==='23505') return res.status(409).json({ error: 'A contest with that name already exists.' });
      next(error);
    } finally { client.release(); }
  });

  router.put('/contests/:id', authRequired, allowRoles('Organizer','Admin'), requireOwner, async (req, res, next) => {
    const input = validateContest(req.body);
    if (input.errors.length) return res.status(400).json({ error: 'Validation failed.', details: input.errors });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const hasSubmissions = await client.query('SELECT 1 FROM public.submission WHERE contest_id=$1 LIMIT 1', [req.contest.contest_id]);
      if (hasSubmissions.rowCount) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'A contest cannot be reconfigured after submissions have been made.' }); }
      const active = await client.query('SELECT problem_id FROM public.problem WHERE is_active=TRUE AND problem_id=ANY($1::integer[])', [input.ids]);
      if (active.rowCount!==input.ids.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Every selected problem must exist and be active.' }); }
      const result = await client.query(
        `UPDATE public.contest SET name=$1,start_time=$2,end_time=$3,rules=$4,
             points_per_problem=$5,wrong_attempt_penalty_minutes=$6,time_penalty_enabled=$7
         WHERE contest_id=$8 AND start_time>CURRENT_TIMESTAMP
         RETURNING contest_id,name,start_time,end_time,rules,organizer_id,points_per_problem,wrong_attempt_penalty_minutes,time_penalty_enabled`,
        [input.name,input.startTime,input.endTime,input.rules||null,input.points,input.wrongPenalty,req.body.time_penalty_enabled===true,req.contest.contest_id]
      );
      if (!result.rowCount) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Contest cannot be edited after it starts.' }); }
      await client.query('DELETE FROM public.includes WHERE contest_id=$1', [req.contest.contest_id]);
      await client.query('INSERT INTO public.includes(contest_id,problem_id) SELECT $1,unnest($2::integer[])', [req.contest.contest_id,input.ids]);
      await client.query('COMMIT');
      res.json({ contest: result.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code==='23505') return res.status(409).json({ error: 'A contest with that name already exists.' });
      next(error);
    } finally { client.release(); }
  });

  router.post('/contests/:id/problems', authRequired, allowRoles('Organizer','Moderator','Admin'), requireProblemSetAccess, async (req, res, next) => {
    const problemId = validId(req.body.problem_id);
    if (!problemId) return res.status(400).json({ error: 'Select a valid problem.' });
    try {
      const active = await pool.query('SELECT 1 FROM public.problem WHERE problem_id=$1 AND is_active=TRUE', [problemId]);
      if (!active.rowCount) return res.status(404).json({ error: 'Active problem not found.' });
      const added = await pool.query('INSERT INTO public.includes(contest_id,problem_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING contest_id,problem_id', [req.contest.contest_id,problemId]);
      if (!added.rowCount) return res.status(409).json({ error: 'Problem is already included.' });
      res.status(201).json({ included: added.rows[0] });
    } catch (error) { next(error); }
  });

  router.delete('/contests/:id/problems/:problemId', authRequired, allowRoles('Organizer','Moderator','Admin'), requireProblemSetAccess, async (req, res, next) => {
    const problemId = validId(req.params.problemId);
    if (!problemId) return res.status(400).json({ error: 'Invalid problem ID.' });
    try {
      const used = await pool.query('SELECT 1 FROM public.submission WHERE contest_id=$1 AND problem_id=$2 LIMIT 1', [req.contest.contest_id,problemId]);
      if (used.rowCount) return res.status(409).json({ error: 'A problem with contest submissions cannot be removed.' });
      const removed = await pool.query('DELETE FROM public.includes WHERE contest_id=$1 AND problem_id=$2 RETURNING problem_id', [req.contest.contest_id,problemId]);
      if (!removed.rowCount) return res.status(404).json({ error: 'Contest problem not found.' });
      res.json({ removed: removed.rows[0] });
    } catch (error) { next(error); }
  });

  router.post('/contests/:id/register', authRequired, allowRoles('Learner'), async (req, res, next) => {
    const id = validId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid contest ID.' });
    try {
      const result = await pool.query(
        `INSERT INTO public.contest_registration(contest_id,learner_id)
         SELECT c.contest_id,l.learner_id FROM public.contest c CROSS JOIN public.learner l
         WHERE c.contest_id=$1 AND l.learner_id=$2 AND c.start_time>CURRENT_TIMESTAMP
         ON CONFLICT(contest_id,learner_id) DO NOTHING
         RETURNING contest_id,learner_id,registered_at,score,penalty`,
        [id,req.user.user_id]
      );
      if (!result.rowCount) return res.status(409).json({ error: 'Registration is closed, the account is not a Learner, or you are already registered.' });
      res.status(201).json({ registration: result.rows[0] });
    } catch (error) { next(error); }
  });

  return router;
}
