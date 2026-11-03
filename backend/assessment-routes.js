const express = require('express');
const crypto = require('node:crypto');

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function validateAssessment(body) {
  const errors = [];
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = body.description == null ? '' : body.description;
  const startTime = typeof body.start_time === 'string' ? body.start_time : '';
  const endTime = typeof body.end_time === 'string' ? body.end_time : '';
  const start = Date.parse(startTime);
  const end = Date.parse(endTime);
  const timeLimit = Number(body.time_limit_minutes);
  const problemIds = Array.isArray(body.problem_ids) ? body.problem_ids.map(Number) : [];
  if (!title) errors.push('Assessment title is required.');
  if (title.length > 150) errors.push('Assessment title must be 150 characters or fewer.');
  if (typeof description !== 'string') errors.push('Assessment description must be text.');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) errors.push('Assessment end time must be after its start time.');
  if (!Number.isSafeInteger(timeLimit) || timeLimit < 1 || timeLimit > 1440) errors.push('Time limit must be between 1 and 1440 minutes.');
  if (!problemIds.length) errors.push('Select at least one assessment problem.');
  if (problemIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) errors.push('Problem IDs must be positive integers.');
  if (new Set(problemIds).size !== problemIds.length) errors.push('A problem can only be assigned once.');
  if (problemIds.length > 50) errors.push('An assessment can contain at most 50 problems.');
  return { errors, title, description: typeof description === 'string' ? description.trim() : '', startTime, endTime, timeLimit, problemIds };
}

function invitationUrl(token) {
  const base = String(process.env.APP_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
  return base + '/assessment.html#token=' + token;
}

module.exports = function createAssessmentRouter({ pool, authRequired, allowRoles }) {
  const router = express.Router();

  async function organizationScope(user) {
    if (user.role_category === 'Admin') return { admin: true, organizationId: null };
    if (user.role_category !== 'Organizer' || !user.organizer_id) return null;
    const result = await pool.query(
      'SELECT organization_id FROM public.organizer WHERE organizer_id=$1',
      [user.organizer_id]
    );
    return result.rowCount ? { admin: false, organizationId: result.rows[0].organization_id } : null;
  }

  async function canAccessAssessment(user, assessmentId) {
    const scope = await organizationScope(user);
    if (!scope) return false;
    const result = await pool.query(
      'SELECT organization_id FROM public.assessment WHERE assessment_id=$1',
      [assessmentId]
    );
    if (!result.rowCount) return false;
    return scope.admin || Number(result.rows[0].organization_id) === Number(scope.organizationId);
  }

  router.get('/organizations', authRequired, allowRoles('Organizer', 'Admin'), async (req, res, next) => {
    try {
      const scope = await organizationScope(req.user);
      if (!scope) return res.status(403).json({ error: 'An organization profile is required.' });
      const result = scope.admin
        ? await pool.query('SELECT organization_id,org_name,contact_email FROM public.organization ORDER BY org_name')
        : await pool.query('SELECT organization_id,org_name,contact_email FROM public.organization WHERE organization_id=$1', [scope.organizationId]);
      res.json({ organizations: result.rows });
    } catch (error) { next(error); }
  });

  router.get('/assessments', authRequired, allowRoles('Organizer', 'Admin'), async (req, res, next) => {
    try {
      const scope = await organizationScope(req.user);
      if (!scope) return res.status(403).json({ error: 'An organization profile is required.' });
      const result = await pool.query(
        `SELECT a.assessment_id,a.title,a.description,a.start_time,a.end_time,
                a.time_limit_minutes,a.is_active,a.organization_id,
                o.org_name AS organization_name,
                (SELECT COUNT(*)::integer FROM public.assessment_problem ap WHERE ap.assessment_id=a.assessment_id) AS problem_count,
                (SELECT COUNT(*)::integer FROM public.invites i WHERE i.assessment_id=a.assessment_id) AS candidate_count,
                CASE WHEN CURRENT_TIMESTAMP<a.start_time THEN 'UPCOMING'
                     WHEN CURRENT_TIMESTAMP<a.end_time THEN 'LIVE' ELSE 'ENDED' END AS assessment_status
         FROM public.assessment a
         LEFT JOIN public.organization o ON o.organization_id=a.organization_id
         WHERE ($1::boolean OR a.organization_id=$2)
         ORDER BY a.start_time DESC,a.assessment_id DESC`,
        [scope.admin,scope.organizationId]
      );
      res.json({ assessments: result.rows });
    } catch (error) { next(error); }
  });

  router.post('/assessments', authRequired, allowRoles('Organizer', 'Admin'), async (req, res, next) => {
    const input = validateAssessment(req.body);
    if (input.errors.length) return res.status(400).json({ error: 'Validation failed.', details: input.errors });
    try {
      const scope = await organizationScope(req.user);
      if (!scope) return res.status(403).json({ error: 'An organization profile is required.' });
      const organizationId = scope.admin ? positiveId(req.body.organization_id) : scope.organizationId;
      if (!organizationId) return res.status(400).json({ error: 'Select an organization for this assessment.' });
      if (scope.admin) {
        const org = await pool.query('SELECT 1 FROM public.organization WHERE organization_id=$1', [organizationId]);
        if (!org.rowCount) return res.status(400).json({ error: 'Organization not found.' });
      }
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
          `INSERT INTO public.assessment
            (title,description,start_time,end_time,time_limit_minutes,is_active,organization_id,created_by_user_id)
           VALUES ($1,$2,$3,$4,$5,TRUE,$6,$7)
           RETURNING assessment_id,title,description,start_time,end_time,time_limit_minutes,is_active,organization_id`,
          [input.title,input.description || null,input.startTime,input.endTime,input.timeLimit,organizationId,req.user.user_id]
        );
        const assessment = created.rows[0];
        await client.query(
          'INSERT INTO public.assessment_problem (assessment_id,problem_id,order_no) SELECT $1,problem_id,ordinality::integer FROM unnest($2::integer[]) WITH ORDINALITY AS x(problem_id,ordinality)',
          [assessment.assessment_id,input.problemIds]
        );
        await client.query('COMMIT');
        res.status(201).json({ assessment, problem_count: input.problemIds.length });
      } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') return res.status(409).json({ error: 'Assessment data conflicts with an existing record.' });
        next(error);
      } finally { client.release(); }
    } catch (error) { next(error); }
  });

  router.get('/assessments/:id', authRequired, allowRoles('Organizer', 'Admin'), async (req, res, next) => {
    const assessmentId = positiveId(req.params.id);
    if (!assessmentId) return res.status(400).json({ error: 'Invalid assessment ID.' });
    try {
      if (!await canAccessAssessment(req.user,assessmentId)) return res.status(404).json({ error: 'Assessment not found.' });
      const [assessment,problems,candidates] = await Promise.all([
        pool.query(
          `SELECT a.assessment_id,a.title,a.description,a.start_time,a.end_time,a.time_limit_minutes,
                  a.is_active,a.organization_id,o.org_name AS organization_name,
                  CASE WHEN CURRENT_TIMESTAMP<a.start_time THEN 'UPCOMING'
                       WHEN CURRENT_TIMESTAMP<a.end_time THEN 'LIVE' ELSE 'ENDED' END AS assessment_status
           FROM public.assessment a LEFT JOIN public.organization o ON o.organization_id=a.organization_id
           WHERE a.assessment_id=$1`,[assessmentId]),
        pool.query(
          `SELECT p.problem_id,p.title,p.difficulty,ap.order_no
           FROM public.assessment_problem ap JOIN public.problem p ON p.problem_id=ap.problem_id
           WHERE ap.assessment_id=$1 ORDER BY ap.order_no`,[assessmentId]),
        pool.query(
          `SELECT c.candidate_id,c.name,c.email,i.invited_at,i.status,i.attempted_at,i.score
           FROM public.invites i JOIN public.candidate c ON c.candidate_id=i.candidate_id
           WHERE i.assessment_id=$1 ORDER BY i.invited_at DESC`,[assessmentId])
      ]);
      if (!assessment.rowCount) return res.status(404).json({ error: 'Assessment not found.' });
      res.json({ assessment: assessment.rows[0], problems: problems.rows, candidates: candidates.rows });
    } catch (error) { next(error); }
  });

  router.put('/assessments/:id', authRequired, allowRoles('Organizer', 'Admin'), async (req, res, next) => {
    const assessmentId = positiveId(req.params.id);
    if (!assessmentId) return res.status(400).json({ error: 'Invalid assessment ID.' });
    const input = validateAssessment(req.body);
    if (input.errors.length) return res.status(400).json({ error: 'Validation failed.', details: input.errors });
    try {
      if (!await canAccessAssessment(req.user,assessmentId)) return res.status(404).json({ error: 'Assessment not found.' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const updated = await client.query(
          `UPDATE public.assessment
           SET title=$1,description=$2,start_time=$3,end_time=$4,time_limit_minutes=$5
           WHERE assessment_id=$6 AND start_time>CURRENT_TIMESTAMP
           RETURNING assessment_id,title,description,start_time,end_time,time_limit_minutes,is_active,organization_id`,
          [input.title,input.description || null,input.startTime,input.endTime,input.timeLimit,assessmentId]);
        if (!updated.rowCount) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'Assessment not found or has already started.' });
        }
        const active = await client.query(
          'SELECT problem_id FROM public.problem WHERE is_active=TRUE AND problem_id=ANY($1::integer[])',
          [input.problemIds]);
        if (active.rowCount !== input.problemIds.length) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Every selected problem must exist and be active.' });
        }
        await client.query('DELETE FROM public.assessment_problem WHERE assessment_id=$1',[assessmentId]);
        await client.query(
          'INSERT INTO public.assessment_problem (assessment_id,problem_id,order_no) SELECT $1,problem_id,ordinality::integer FROM unnest($2::integer[]) WITH ORDINALITY AS x(problem_id,ordinality)',
          [assessmentId,input.problemIds]);
        await client.query('COMMIT');
        res.json({ assessment: updated.rows[0], problem_count: input.problemIds.length });
      } catch (error) {
        await client.query('ROLLBACK');
        next(error);
      } finally { client.release(); }
    } catch (error) { next(error); }
  });

  router.post('/assessments/:id/invitations', authRequired, allowRoles('Organizer', 'Admin'), async (req, res, next) => {
    const assessmentId = positiveId(req.params.id);
    if (!assessmentId) return res.status(400).json({ error: 'Invalid assessment ID.' });
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!name || name.length>100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>120) {
      return res.status(400).json({ error: 'Enter a candidate name and valid email address.' });
    }
    try {
      if (!await canAccessAssessment(req.user,assessmentId)) return res.status(404).json({ error: 'Assessment not found.' });
      const scheduled = await pool.query(
        'SELECT end_time,start_time,is_active FROM public.assessment WHERE assessment_id=$1',[assessmentId]);
      if (!scheduled.rowCount || !scheduled.rows[0].is_active) return res.status(404).json({ error: 'Assessment is unavailable.' });
      if (new Date(scheduled.rows[0].start_time) <= new Date()) return res.status(409).json({ error: 'Invitations can only be created before the assessment starts.' });
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const expiry = new Date(new Date(scheduled.rows[0].end_time).getTime()+3*24*60*60*1000);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const candidate = await client.query(
          `INSERT INTO public.candidate (name,email) VALUES ($1,$2)
           ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name
           RETURNING candidate_id,name,email`,[name,email]);
        const invitation = await client.query(
          `INSERT INTO public.invites
            (assessment_id,candidate_id,invited_at,status,attempted_at,score,invite_token_hash,token_expires_at)
           VALUES ($1,$2,CURRENT_TIMESTAMP,'Invited',NULL,NULL,$3,$4)
           ON CONFLICT (assessment_id,candidate_id) DO UPDATE SET
             invited_at=CURRENT_TIMESTAMP,status='Invited',attempted_at=NULL,score=NULL,
             invite_token_hash=EXCLUDED.invite_token_hash,token_expires_at=EXCLUDED.token_expires_at
           RETURNING assessment_id,candidate_id,invited_at,status,token_expires_at`,
          [assessmentId,candidate.rows[0].candidate_id,tokenHash,expiry]);
        await client.query('COMMIT');
        res.status(201).json({
          invitation: invitation.rows[0],
          candidate: candidate.rows[0],
          invitation_url: invitationUrl(token),
          note: 'This invitation link is shown only once. Share it with the candidate using your approved communication channel.'
        });
      } catch (error) {
        await client.query('ROLLBACK');
        next(error);
      } finally { client.release(); }
    } catch (error) { next(error); }
  });

  router.get('/assessments/:id/report', authRequired, allowRoles('Organizer', 'Admin'), async (req, res, next) => {
    const assessmentId = positiveId(req.params.id);
    if (!assessmentId) return res.status(400).json({ error: 'Invalid assessment ID.' });
    try {
      if (!await canAccessAssessment(req.user,assessmentId)) return res.status(404).json({ error: 'Assessment not found.' });
      const assessment = await pool.query(
        'SELECT assessment_id,title,start_time,end_time FROM public.assessment WHERE assessment_id=$1',[assessmentId]);
      if (!assessment.rowCount) return res.status(404).json({ error: 'Assessment not found.' });
      if (new Date(assessment.rows[0].end_time)>new Date()) return res.status(403).json({ error: 'Post-assessment reports are available after the assessment closes.' });
      const result = await pool.query(
        `SELECT c.candidate_id,c.name,c.email,i.status,i.invited_at,i.attempted_at,i.score,
                COUNT(s.submission_id)::integer AS submission_count,
                COUNT(s.submission_id) FILTER (WHERE s.verdict_id=1)::integer AS accepted_submissions,
                COUNT(DISTINCT s.problem_id) FILTER (WHERE s.verdict_id=1)::integer AS solved_problems,
                COALESCE(SUM(s.time_taken_ms),0)::bigint AS total_execution_time_ms,
                COALESCE(STRING_AGG(DISTINCT l.name || ' ' || l.version, ', '),'') AS languages_used
         FROM public.invites i JOIN public.candidate c ON c.candidate_id=i.candidate_id
         LEFT JOIN public.submission s ON s.assessment_id=i.assessment_id AND s.candidate_id=i.candidate_id AND s.is_run_only=FALSE AND s.execution_status='COMPLETED'
         LEFT JOIN public.language l ON l.language_id=s.language_id
         WHERE i.assessment_id=$1
         GROUP BY c.candidate_id,c.name,c.email,i.status,i.invited_at,i.attempted_at,i.score
         ORDER BY i.score DESC NULLS LAST,c.name`,[assessmentId]);
      res.json({ assessment: assessment.rows[0], candidates: result.rows });
    } catch (error) { next(error); }
  });

  return router;
};