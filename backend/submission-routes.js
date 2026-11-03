const express = require('express');
const { listAvailableLanguages, executeTestCase } = require('./judge0');

function classifyVerdict(description, testNumber, message = '') {
  const text = String(description || '').toLowerCase();
  const index = Math.min(Math.max(testNumber, 1), 20);

  if (text === 'accepted') return { status: 'ACCEPTED', verdictId: 1 };
  if (text.includes('compilation error')) return { status: 'COMPILATION_ERROR', verdictId: 2 };
  if (text.includes('wrong answer')) return { status: 'WRONG_ANSWER', verdictId: 2 + index };
  if (text.includes('time limit exceeded')) return { status: 'TIME_LIMIT_EXCEEDED', verdictId: 22 + index };
  if (text.includes('memory limit exceeded') || String(message).toLowerCase().includes('memory limit exceeded')) {
    return { status: 'MEMORY_LIMIT_EXCEEDED', verdictId: 62 + index };
  }
  if (text.includes('runtime error') || text.includes('exec format error') || text.includes('output limit exceeded')) {
    return { status: 'RUNTIME_ERROR', verdictId: 42 + index };
  }
  return { status: 'SYSTEM_ERROR', verdictId: null };
}

function metricMilliseconds(value) {
  const number = Number.parseFloat(value || '0');
  return Number.isFinite(number) && number > 0 ? Math.round(number * 1000) : 0;
}

async function recalculateContestRegistration(pool, contestId, userId) {
  if (!contestId || !userId) return;
  await pool.query(
    `WITH first_accept AS (
       SELECT problem_id, MIN(submitted_at) AS accepted_at
       FROM public.submission
       WHERE contest_id=$1 AND user_id=$2 AND is_run_only=FALSE
         AND execution_status='COMPLETED' AND verdict_id=1
       GROUP BY problem_id
     ), score AS (
       SELECT COUNT(*)::integer * 100 AS points FROM first_accept
     ), penalty AS (
       SELECT COUNT(*)::integer * 5 AS penalty_points
       FROM public.submission s
       JOIN first_accept fa ON fa.problem_id=s.problem_id
       WHERE s.contest_id=$1 AND s.user_id=$2 AND s.is_run_only=FALSE
         AND s.execution_status='COMPLETED' AND s.verdict_id<>1
         AND s.submitted_at < fa.accepted_at
     )
     UPDATE public.contest_registration cr
     SET score=score.points, penalty=penalty.penalty_points
     FROM score, penalty
     WHERE cr.contest_id=$1 AND cr.learner_id=$2`,
    [contestId,userId]
  );
}
async function processSubmission(pool, submission, testCases, language) {
  let totalTime = 0;
  let maximumMemory = 0;
  let finalVerdictId = 1;

  try {
    await pool.query(
      "UPDATE public.submission SET execution_status='RUNNING' WHERE submission_id=$1",
      [submission.submission_id]
    );

    for (let index = 0; index < testCases.length; index += 1) {
      const testNumber = index + 1;
      const testCase = testCases[index];
      const result = await executeTestCase({
        sourceCode: submission.code,
        language,
        testCase
      });
      const description = result.status?.description || 'Unknown Judge0 status';
      const classified = classifyVerdict(description, testNumber, result.message);
      if (classified.status === 'SYSTEM_ERROR') {
        throw new Error('The execution provider returned an unsupported result.');
      }

      const timeTaken = metricMilliseconds(result.time);
      const memoryUsed = Math.max(0, Number(result.memory) || 0);
      totalTime += timeTaken;
      maximumMemory = Math.max(maximumMemory, memoryUsed);
      finalVerdictId = classified.verdictId;

      const errorMessage = classified.status === 'COMPILATION_ERROR'
        ? String(result.compile_output || result.message || '').slice(0, 1500) || null
        : null;

      await pool.query(
        `INSERT INTO public.submission_test_result
          (submission_id, test_case_number, status, time_taken_ms, memory_used_kb, error_message)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [submission.submission_id, testNumber, classified.status, timeTaken, memoryUsed, errorMessage]
      );

      if (classified.status !== 'ACCEPTED') break;
    }

    await pool.query(
      `UPDATE public.submission
       SET verdict_id=$1, time_taken_ms=$2, memory_used_kb=$3,
           execution_status='COMPLETED', execution_error=NULL
       WHERE submission_id=$4`,
      [finalVerdictId, totalTime, maximumMemory, submission.submission_id]
    );
    try {
      await recalculateContestRegistration(pool, submission.contest_id, submission.user_id);
    } catch (scoreError) {
      console.error('Contest score recalculation failed:', scoreError.message);
    }
  } catch (error) {
    console.error('Submission execution failed:', error.message);
    await pool.query(
      `UPDATE public.submission
       SET execution_status='FAILED',
           execution_error='The execution service could not complete this request. Please retry.'
       WHERE submission_id=$1`,
      [submission.submission_id]
    );
    const failedNumber = Math.max(1, (await pool.query(
      'SELECT COUNT(*)::integer AS count FROM public.submission_test_result WHERE submission_id=$1',
      [submission.submission_id]
    )).rows[0].count + 1);
    await pool.query(
      `INSERT INTO public.submission_test_result
        (submission_id, test_case_number, status, error_message)
       VALUES ($1,$2,'SYSTEM_ERROR','The execution service could not complete this test.')
       ON CONFLICT (submission_id,test_case_number) DO UPDATE
       SET status='SYSTEM_ERROR', error_message=EXCLUDED.error_message`,
      [submission.submission_id, failedNumber]
    );
  }
}

function createSubmissionRouter({ pool, authRequired, allowRoles }) {
  const router = express.Router();

  router.get('/languages', async (req, res, next) => {
    try {
      const languages = await listAvailableLanguages(pool);
      res.json({ languages });
    } catch (error) {
      next(error);
    }
  });

  router.post('/submissions', authRequired, allowRoles('Learner', 'Organizer', 'Admin'), async (req, res, next) => {
    const problemId = Number(req.body.problem_id);
    const languageId = Number(req.body.language_id);
    const sourceCode = typeof req.body.code === 'string' ? req.body.code : '';
    const action = req.body.action === 'run' ? 'run' : 'submit';
    const contestId = req.body.contest_id == null ? null : Number(req.body.contest_id);
    if (contestId !== null && (!Number.isSafeInteger(contestId) || contestId <= 0)) {
      return res.status(400).json({ error: 'Invalid contest ID.' });
    }

    if (!Number.isSafeInteger(problemId) || problemId <= 0) {
      return res.status(400).json({ error: 'Select a valid problem.' });
    }
    if (!Number.isSafeInteger(languageId) || languageId <= 0) {
      return res.status(400).json({ error: 'Select a supported programming language.' });
    }
    if (!sourceCode.trim() || sourceCode.length > 50000) {
      return res.status(400).json({ error: 'Code is required and must be no longer than 50000 characters.' });
    }

    let languages;
    try {
      languages = await listAvailableLanguages(pool);
    } catch (error) {
      return res.status(503).json({ error: 'The code execution service is unavailable. Please try again later.' });
    }
    const language = languages.find((item) => item.language_id === languageId);
    if (!language) {
      return res.status(400).json({ error: 'That language version is not available on the configured execution service.' });
    }

    try {
      const problemResult = await pool.query(
        'SELECT problem_id FROM public.problem WHERE problem_id=$1 AND is_active=TRUE',
        [problemId]
      );

      if (!problemResult.rowCount) return res.status(404).json({ error: 'Active problem not found.' });

      if (contestId !== null) {
        const eligibility = await pool.query(
          `SELECT 1
           FROM public.contest c
           JOIN public.contest_registration cr ON cr.contest_id=c.contest_id
           JOIN public.includes i ON i.contest_id=c.contest_id AND i.problem_id=$3
           WHERE c.contest_id=$1 AND cr.learner_id=$2
             AND c.start_time <= CURRENT_TIMESTAMP
             AND c.end_time > CURRENT_TIMESTAMP`,
          [contestId,req.user.user_id,problemId]
        );
        if (!eligibility.rowCount) {
          return res.status(403).json({ error: 'You must be registered and the contest must be live to submit to its problems.' });
        }
      }

      const testResult = await pool.query(
        `SELECT test_case_id, input_data, expected_output
         FROM public.test_case
         WHERE problem_id=$1 AND ($2::boolean = FALSE OR is_hidden=FALSE)
         ORDER BY test_case_id`,
        [problemId, action === 'run']
      );
      if (!testResult.rowCount) {
        return res.status(400).json({
          error: action === 'run'
            ? 'This problem has no public sample test cases to run.'
            : 'This problem has no test cases configured yet.'
        });
      }

      const client = await pool.connect();
      let submission;
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1::integer,$2::integer)', [req.user.user_id, problemId]);
        const attemptResult = await client.query(
          'SELECT COALESCE(MAX(attempt_number),0)::integer + 1 AS next_attempt FROM public.submission WHERE user_id=$1 AND problem_id=$2',
          [req.user.user_id, problemId]
        );
        const inserted = await client.query(
          `INSERT INTO public.submission
            (code, verdict_id, time_taken_ms, memory_used_kb, attempt_number,
             user_id, problem_id, language_id, assessment_id, contest_id, execution_status, is_run_only)
           VALUES ($1,NULL,0,0,$2,$3,$4,$5,NULL,$6,'PENDING',$7)
           RETURNING submission_id, attempt_number, submitted_at`,
          [sourceCode, attemptResult.rows[0].next_attempt, req.user.user_id, problemId, languageId, contestId, action === 'run']
        );
        submission = inserted.rows[0];
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      setImmediate(() => {
        processSubmission(pool, {
          submission_id: submission.submission_id,
          code: sourceCode,
          contest_id: contestId,
          user_id: req.user.user_id
        }, testResult.rows, language).catch(async (workerError) => {
          console.error('Unexpected submission worker failure:', workerError.message);
          try {
            await pool.query(
              `UPDATE public.submission
               SET execution_status='FAILED',
                   execution_error='The execution service could not complete this request. Please retry.'
               WHERE submission_id=$1`,
              [submission.submission_id]
            );
          } catch (databaseError) {
            console.error('Could not persist submission worker failure:', databaseError.message);
          }
        });
      });

      res.status(202).json({
        submission_id: submission.submission_id,
        attempt_number: submission.attempt_number,
        submitted_at: submission.submitted_at,
        execution_status: 'PENDING',
        is_run_only: action === 'run',
        contest_id: contestId
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/submissions', authRequired, async (req, res, next) => {
    const problemId = req.query.problemId ? Number(req.query.problemId) : null;
    if (problemId !== null && (!Number.isSafeInteger(problemId) || problemId <= 0)) {
      return res.status(400).json({ error: 'Invalid problem ID.' });
    }
    try {
      const result = await pool.query(
        `SELECT s.submission_id, s.problem_id, s.contest_id, p.title AS problem_title,
                s.attempt_number, s.submitted_at, s.time_taken_ms, s.memory_used_kb,
                s.execution_status, s.execution_error, s.is_run_only,
                v.verdict_name, v.result AS verdict_result,
                l.name AS language_name, l.version AS language_version
         FROM public.submission s
         JOIN public.problem p ON p.problem_id=s.problem_id
         JOIN public.language l ON l.language_id=s.language_id
         LEFT JOIN public.verdict v ON v.verdict_id=s.verdict_id
         WHERE s.user_id=$1 AND ($2::integer IS NULL OR s.problem_id=$2)
         ORDER BY s.submitted_at DESC
         LIMIT 50`,
        [req.user.user_id, problemId]
      );
      res.json({ submissions: result.rows });
    } catch (error) {
      next(error);
    }
  });

  router.get('/submissions/:id', authRequired, async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid submission ID.' });
    }
    try {
      const result = await pool.query(
        `SELECT s.submission_id, s.code, s.problem_id, s.contest_id, p.title AS problem_title,
                s.attempt_number, s.submitted_at, s.time_taken_ms, s.memory_used_kb,
                s.execution_status, s.execution_error, s.is_run_only,
                v.verdict_name, v.result AS verdict_result,
                l.name AS language_name, l.version AS language_version
         FROM public.submission s
         JOIN public.problem p ON p.problem_id=s.problem_id
         JOIN public.language l ON l.language_id=s.language_id
         LEFT JOIN public.verdict v ON v.verdict_id=s.verdict_id
         WHERE s.submission_id=$1 AND s.user_id=$2`,
        [id, req.user.user_id]
      );
      if (!result.rowCount) return res.status(404).json({ error: 'Submission not found.' });
      const tests = await pool.query(
        `SELECT test_case_number, status, time_taken_ms, memory_used_kb, error_message
         FROM public.submission_test_result
         WHERE submission_id=$1
         ORDER BY test_case_number`,
        [id]
      );
      res.json({ submission: result.rows[0], test_results: tests.rows });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = createSubmissionRouter;
module.exports.processSubmission = processSubmission;
