const express = require('express');
const crypto = require('node:crypto');
const { listAvailableLanguages } = require('./judge0');
const { processSubmission } = require('./submission-routes');

function secondsRemaining(invite) {
  if (invite.status !== 'Started' || !invite.attempted_at) return 0;
  const deadlineByLimit = new Date(invite.attempted_at).getTime() + Number(invite.time_limit_minutes) * 60000;
  const deadlineByWindow = new Date(invite.end_time).getTime();
  return Math.max(0, Math.floor((Math.min(deadlineByLimit,deadlineByWindow)-Date.now())/1000));
}

module.exports = function createCandidateAssessmentRouter({ pool }) {
  const router = express.Router();

  async function finishInvite(assessmentId,candidateId) {
    const result = await pool.query(
      `UPDATE public.invites i
       SET status='Completed',
           score=CASE
             WHEN (SELECT COUNT(*) FROM public.assessment_problem ap WHERE ap.assessment_id=i.assessment_id)=0 THEN 0
             ELSE ROUND(
               100.0 * (
                 SELECT COUNT(DISTINCT s.problem_id)
                 FROM public.submission s
                 WHERE s.assessment_id=i.assessment_id
                   AND s.candidate_id=i.candidate_id
                   AND s.is_run_only=FALSE
                   AND s.execution_status='COMPLETED'
                   AND s.verdict_id=1
               ) / (SELECT COUNT(*) FROM public.assessment_problem ap WHERE ap.assessment_id=i.assessment_id)
             )::integer
           END
       WHERE i.assessment_id=$1 AND i.candidate_id=$2 AND i.status='Started'
       RETURNING status,score`,
      [assessmentId,candidateId]
    );
    return result.rows[0] || null;
  }

  async function invitationContext(req,res,next) {
    const auth = String(req.get('authorization') || '');
    const match = auth.match(/^Bearer\s+([a-f0-9]{64})$/i);
    if (!match) return res.status(401).json({ error: 'A valid invitation link is required.' });
    const tokenHash = crypto.createHash('sha256').update(match[1].toLowerCase()).digest('hex');
    try {
      const result = await pool.query(
        `SELECT i.assessment_id,i.candidate_id,i.status,i.invited_at,i.attempted_at,i.score,
                i.token_expires_at,a.title,a.description,a.start_time,a.end_time,
                a.time_limit_minutes,a.is_active,c.name AS candidate_name,c.email AS candidate_email
         FROM public.invites i
         JOIN public.assessment a ON a.assessment_id=i.assessment_id
         JOIN public.candidate c ON c.candidate_id=i.candidate_id
         WHERE i.invite_token_hash=$1`,
        [tokenHash]
      );
      if (!result.rowCount) return res.status(401).json({ error: 'Invitation link is invalid.' });
      const invite = result.rows[0];
      if (!invite.token_expires_at || new Date(invite.token_expires_at)<=new Date()) {
        return res.status(410).json({ error: 'This invitation link has expired.' });
      }
      if (!invite.is_active) return res.status(410).json({ error: 'This assessment is no longer available.' });
      if (invite.status === 'Expired') return res.status(410).json({ error: 'This invitation has expired.' });
      if (invite.status === 'Invited' && new Date(invite.end_time)<=new Date()) {
        await pool.query(
          `UPDATE public.invites SET status='Expired'
           WHERE assessment_id=$1 AND candidate_id=$2 AND status='Invited'`,
          [invite.assessment_id,invite.candidate_id]
        );
        return res.status(410).json({ error: 'The assessment window has closed.' });
      }
      if (invite.status === 'Started' && secondsRemaining(invite)<=0) {
        const completion = await finishInvite(invite.assessment_id,invite.candidate_id);
        invite.status='Completed';
        invite.score = completion?.score ?? invite.score;
      }
      req.candidateInvite=invite;
      next();
    } catch (error) { next(error); }
  }

  function requireStarted(req,res,next) {
    const invite=req.candidateInvite;
    if (invite.status!=='Started') return res.status(409).json({ error: 'Start the assessment before accessing its problems.' });
    if (secondsRemaining(invite)<=0) {
      finishInvite(invite.assessment_id,invite.candidate_id)
        .then(()=>res.status(409).json({ error: 'The assessment time limit has ended.' }))
        .catch(next);
      return;
    }
    next();
  }

  router.use(invitationContext);

  router.post('/activity', requireStarted, async (req,res,next)=>{
    const allowed=['TAB_HIDDEN','WINDOW_BLUR','COPY_ATTEMPT','PASTE_ATTEMPT'];
    const eventType=String(req.body.event_type||'').toUpperCase();
    if(!allowed.includes(eventType)) return res.status(400).json({error:'Unsupported activity indicator.'});
    const metadata={};
    if(typeof req.body.page==='string') metadata.page=req.body.page.slice(0,80);
    try {
      const invite=req.candidateInvite;
      const result=await pool.query(
        `INSERT INTO public.suspicious_activity(assessment_id,candidate_id,event_type,metadata)
         VALUES($1,$2,$3,$4::jsonb) RETURNING activity_id,detected_at`,
        [invite.assessment_id,invite.candidate_id,eventType,JSON.stringify(metadata)]
      );
      res.status(202).json({recorded:true,activity_id:result.rows[0].activity_id,detected_at:result.rows[0].detected_at});
    } catch(error){next(error);}
  });
  router.get('/me', async (req,res,next)=>{
    const invite=req.candidateInvite;
    try {
      const problemCount=await pool.query(
        'SELECT COUNT(*)::integer AS count FROM public.assessment_problem WHERE assessment_id=$1',
        [invite.assessment_id]
      );
      const canStart=invite.status==='Invited' &&
        new Date(invite.start_time)<=new Date() && new Date(invite.end_time)>new Date();
      res.json({
        candidate:{ name:invite.candidate_name,email:invite.candidate_email },
        assessment:{
          assessment_id:invite.assessment_id,title:invite.title,description:invite.description,
          start_time:invite.start_time,end_time:invite.end_time,time_limit_minutes:invite.time_limit_minutes,
          problem_count:problemCount.rows[0].count
        },
        status:invite.status,score:invite.score,can_start:canStart,
        remaining_seconds:secondsRemaining(invite)
      });
    } catch(error){ next(error); }
  });

  router.post('/start', async (req,res,next)=>{
    const invite=req.candidateInvite;
    if(invite.status==='Started') return res.json({ status:'Started',remaining_seconds:secondsRemaining(invite) });
    if(invite.status!=='Invited') return res.status(409).json({ error:'This invitation cannot be started.' });
    try {
      const result=await pool.query(
        `UPDATE public.invites i
         SET status='Started',attempted_at=CURRENT_TIMESTAMP
         FROM public.assessment a
         WHERE i.assessment_id=$1 AND i.candidate_id=$2 AND i.status='Invited'
           AND a.assessment_id=i.assessment_id AND a.is_active=TRUE
           AND a.start_time<=CURRENT_TIMESTAMP AND a.end_time>CURRENT_TIMESTAMP
           AND i.token_expires_at>CURRENT_TIMESTAMP
         RETURNING i.attempted_at,i.status`,
        [invite.assessment_id,invite.candidate_id]
      );
      if(!result.rowCount) return res.status(409).json({ error:'The assessment is not currently open for starting.' });
      invite.status='Started';invite.attempted_at=result.rows[0].attempted_at;
      res.json({ status:'Started',remaining_seconds:secondsRemaining(invite) });
    } catch(error){ next(error); }
  });

  router.get('/problems', requireStarted, async (req,res,next)=>{
    try {
      const result=await pool.query(
        `SELECT p.problem_id,p.title,p.problem_statement,p.input_format,p.output_format,
                p.constraints,p.difficulty,ap.order_no,
                COALESCE((
                  SELECT json_agg(json_build_object('test_case_id',tc.test_case_id,
                    'input_data',tc.input_data,'expected_output',tc.expected_output) ORDER BY tc.test_case_id)
                  FROM public.test_case tc
                  WHERE tc.problem_id=p.problem_id AND tc.is_hidden=FALSE
                ),'[]'::json) AS sample_tests
         FROM public.assessment_problem ap
         JOIN public.problem p ON p.problem_id=ap.problem_id
         WHERE ap.assessment_id=$1 AND p.is_active=TRUE
         ORDER BY ap.order_no`,
        [req.candidateInvite.assessment_id]
      );
      res.json({ problems:result.rows,remaining_seconds:secondsRemaining(req.candidateInvite) });
    } catch(error){ next(error); }
  });

  router.get('/problems/:id', requireStarted, async (req,res,next)=>{
    const problemId=Number(req.params.id);
    if(!Number.isSafeInteger(problemId)||problemId<=0) return res.status(400).json({ error:'Invalid problem ID.' });
    try {
      const result=await pool.query(
        `SELECT p.problem_id,p.title,p.problem_statement,p.input_format,p.output_format,p.constraints,
                p.difficulty,
                COALESCE((
                  SELECT json_agg(json_build_object('test_case_id',tc.test_case_id,
                    'input_data',tc.input_data,'expected_output',tc.expected_output) ORDER BY tc.test_case_id)
                  FROM public.test_case tc WHERE tc.problem_id=p.problem_id AND tc.is_hidden=FALSE
                ),'[]'::json) AS sample_tests
         FROM public.problem p
         JOIN public.assessment_problem ap ON ap.problem_id=p.problem_id
         WHERE ap.assessment_id=$1 AND p.problem_id=$2 AND p.is_active=TRUE`,
        [req.candidateInvite.assessment_id,problemId]
      );
      if(!result.rowCount) return res.status(404).json({ error:'Problem is not part of this assessment.' });
      res.json({ problem:result.rows[0],remaining_seconds:secondsRemaining(req.candidateInvite) });
    } catch(error){ next(error); }
  });

  router.get('/languages', requireStarted, async (req,res,next)=>{
    try { res.json({ languages:await listAvailableLanguages(pool) }); }
    catch(error){ res.status(503).json({ error:'The execution service is unavailable.' }); }
  });

  router.post('/submissions', requireStarted, async (req,res,next)=>{
    const invite=req.candidateInvite;
    const problemId=Number(req.body.problem_id);
    const languageId=Number(req.body.language_id);
    const sourceCode=typeof req.body.code==='string'?req.body.code:'';
    const action=req.body.action==='run'?'run':'submit';
    if(!Number.isSafeInteger(problemId)||problemId<=0) return res.status(400).json({ error:'Select a valid assessment problem.' });
    if(!Number.isSafeInteger(languageId)||languageId<=0) return res.status(400).json({ error:'Select a supported programming language.' });
    if(!sourceCode.trim()||sourceCode.length>50000) return res.status(400).json({ error:'Code is required and must be no longer than 50000 characters.' });
    let languages;
    try { languages=await listAvailableLanguages(pool); }
    catch(error){ return res.status(503).json({ error:'The execution service is unavailable.' }); }
    const language=languages.find(item=>item.language_id===languageId);
    if(!language) return res.status(400).json({ error:'That language version is not available on the configured execution service.' });
    try {
      const testResult=await pool.query(
        `SELECT tc.test_case_id,tc.input_data,tc.expected_output
         FROM public.test_case tc
         JOIN public.assessment_problem ap ON ap.problem_id=tc.problem_id
         WHERE ap.assessment_id=$1 AND tc.problem_id=$2
           AND ($3::boolean=FALSE OR tc.is_hidden=FALSE)
         ORDER BY tc.test_case_id`,
        [invite.assessment_id,problemId,action==='run']
      );
      if(!testResult.rowCount) return res.status(400).json({ error:'No matching test cases are configured for this action.' });
      const client=await pool.connect();
      let submission;
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1::integer,$2::integer)',[invite.candidate_id,problemId]);
        const attempt=await client.query(
          'SELECT COALESCE(MAX(attempt_number),0)::integer+1 AS next_attempt FROM public.submission WHERE candidate_id=$1 AND assessment_id=$2 AND problem_id=$3',
          [invite.candidate_id,invite.assessment_id,problemId]
        );
        const inserted=await client.query(
          `INSERT INTO public.submission
            (code,verdict_id,time_taken_ms,memory_used_kb,attempt_number,user_id,problem_id,
             language_id,assessment_id,contest_id,execution_status,is_run_only,candidate_id)
           VALUES ($1,NULL,0,0,$2,NULL,$3,$4,$5,NULL,'PENDING',$6,$7)
           RETURNING submission_id,attempt_number,submitted_at`,
          [sourceCode,attempt.rows[0].next_attempt,problemId,languageId,invite.assessment_id,action==='run',invite.candidate_id]
        );
        submission=inserted.rows[0];
        await client.query('COMMIT');
      } catch(error){ await client.query('ROLLBACK');throw error; }
      finally { client.release(); }
      setImmediate(()=>{
        processSubmission(pool,{
          submission_id:submission.submission_id,code:sourceCode,candidate_id:invite.candidate_id,
          user_id:null,contest_id:null,assessment_id:invite.assessment_id
        },testResult.rows,language).catch(async workerError=>{
          console.error('Candidate execution worker failed:',workerError.message);
          try { await pool.query(
            `UPDATE public.submission SET execution_status='FAILED',
              execution_error='The execution service could not complete this request. Please retry.'
             WHERE submission_id=$1`,[submission.submission_id]);
          } catch(databaseError){ console.error('Could not persist candidate execution failure:',databaseError.message); }
        });
      });
      res.status(202).json({ submission_id:submission.submission_id,attempt_number:submission.attempt_number,
        submitted_at:submission.submitted_at,execution_status:'PENDING',is_run_only:action==='run' });
    } catch(error){ next(error); }
  });

  router.get('/submissions', async (req,res,next)=>{
    const invite=req.candidateInvite;
    try {
      const result=await pool.query(
        `SELECT s.submission_id,s.problem_id,p.title AS problem_title,s.attempt_number,
                s.submitted_at,s.execution_status,s.is_run_only,s.time_taken_ms,s.memory_used_kb,
                v.verdict_name,l.name AS language_name,l.version AS language_version
         FROM public.submission s
         JOIN public.problem p ON p.problem_id=s.problem_id
         JOIN public.language l ON l.language_id=s.language_id
         LEFT JOIN public.verdict v ON v.verdict_id=s.verdict_id
         WHERE s.candidate_id=$1 AND s.assessment_id=$2
         ORDER BY s.submitted_at DESC LIMIT 50`,
        [invite.candidate_id,invite.assessment_id]
      );
      res.json({ submissions:result.rows });
    } catch(error){ next(error); }
  });

  router.get('/submissions/:id', async (req,res,next)=>{
    const invite=req.candidateInvite;
    const id=Number(req.params.id);
    if(!Number.isSafeInteger(id)||id<=0) return res.status(400).json({ error:'Invalid submission ID.' });
    try {
      const result=await pool.query(
        `SELECT s.submission_id,s.code,s.problem_id,p.title AS problem_title,s.attempt_number,
                s.submitted_at,s.execution_status,s.execution_error,s.is_run_only,
                s.time_taken_ms,s.memory_used_kb,v.verdict_name,l.name AS language_name,l.version AS language_version
         FROM public.submission s
         JOIN public.problem p ON p.problem_id=s.problem_id
         JOIN public.language l ON l.language_id=s.language_id
         LEFT JOIN public.verdict v ON v.verdict_id=s.verdict_id
         WHERE s.submission_id=$1 AND s.candidate_id=$2 AND s.assessment_id=$3`,
        [id,invite.candidate_id,invite.assessment_id]
      );
      if(!result.rowCount) return res.status(404).json({ error:'Submission not found.' });
      const tests=await pool.query(
        `SELECT test_case_number,status,time_taken_ms,memory_used_kb,error_message
         FROM public.submission_test_result WHERE submission_id=$1 ORDER BY test_case_number`,[id]);
      res.json({ submission:result.rows[0],test_results:tests.rows });
    } catch(error){ next(error); }
  });

  router.post('/finish', async (req,res,next)=>{
    const invite=req.candidateInvite;
    if(invite.status==='Completed') return res.json({ status:'Completed',score:invite.score });
    if(invite.status!=='Started') return res.status(409).json({ error:'This assessment has not been started.' });
    const pending = await pool.query(
      `SELECT COUNT(*)::integer AS count
       FROM public.submission
       WHERE assessment_id=$1 AND candidate_id=$2
         AND execution_status IN ('PENDING','RUNNING')`,
      [invite.assessment_id,invite.candidate_id]
    );
    if (pending.rows[0].count > 0) {
      return res.status(409).json({ error:'Wait for all running submissions to finish before submitting the assessment.' });
    }
    try {
      const completed=await finishInvite(invite.assessment_id,invite.candidate_id);
      if(!completed) return res.status(409).json({ error:'This assessment could not be completed.' });
      invite.status='Completed';invite.score=completed.score;
      res.json({ status:'Completed',score:completed.score });
    } catch(error){ next(error); }
  });

  return router;
}