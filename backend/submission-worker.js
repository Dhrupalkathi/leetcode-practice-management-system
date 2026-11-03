const { listAvailableLanguages } = require('./judge0');
const { processSubmission } = require('./submission-routes');

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function claimNextSubmission(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Re-queue jobs whose worker disappeared. A lease is renewed while each
    // test case runs, so a live worker is not mistaken for a crashed one.
    await client.query(
      `WITH expired AS (
         SELECT submission_id
         FROM public.submission
         WHERE execution_status='RUNNING'
           AND worker_lease_until IS NOT NULL
           AND worker_lease_until < CURRENT_TIMESTAMP
         FOR UPDATE SKIP LOCKED
       )
       DELETE FROM public.submission_test_result tr
       USING expired e
       WHERE tr.submission_id=e.submission_id`
    );
    await client.query(
      `UPDATE public.submission
       SET execution_status='PENDING',worker_lease_until=NULL,
           verdict_id=NULL,time_taken_ms=0,memory_used_kb=0,
           execution_error=NULL
       WHERE execution_status='RUNNING'
         AND worker_lease_until IS NOT NULL
         AND worker_lease_until < CURRENT_TIMESTAMP`
    );
    const claimed = await client.query(
      `SELECT s.submission_id,s.code,s.problem_id,s.language_id,s.is_run_only,
              s.assessment_id,s.candidate_id,s.contest_id,s.user_id
       FROM public.submission s
       WHERE s.execution_status='PENDING'
       ORDER BY s.submitted_at,s.submission_id
       LIMIT 1
       FOR UPDATE OF s SKIP LOCKED`
    );
    if (!claimed.rowCount) {
      await client.query('COMMIT');
      return null;
    }

    const submission = claimed.rows[0];
    await client.query(
      "UPDATE public.submission SET execution_status='RUNNING',worker_lease_until=CURRENT_TIMESTAMP + INTERVAL '2 minutes' WHERE submission_id=$1",
      [submission.submission_id]
    );
    const tests = await client.query(
      `SELECT tc.test_case_id,tc.input_data,tc.expected_output
       FROM public.test_case tc
       WHERE tc.problem_id=$1
         AND ($2::boolean=FALSE OR tc.is_hidden=FALSE)
         AND ($3::integer IS NULL OR EXISTS (
           SELECT 1 FROM public.assessment_problem ap
           WHERE ap.assessment_id=$3 AND ap.problem_id=tc.problem_id
         ))
       ORDER BY tc.test_case_id`,
      [submission.problem_id,submission.is_run_only,submission.assessment_id]
    );
    await client.query('COMMIT');
    return { submission, testCases:tests.rows };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function markUnavailable(pool, submissionId, message) {
  await pool.query(
    `UPDATE public.submission
     SET execution_status='FAILED',execution_error=$1,worker_lease_until=NULL
     WHERE submission_id=$2 AND execution_status IN ('PENDING','RUNNING')`,
    [message,submissionId]
  );
}

function startSubmissionWorkers(pool) {
  const configured = Number(process.env.SUBMISSION_WORKER_CONCURRENCY || 2);
  const concurrency = Number.isInteger(configured) ? Math.max(1,Math.min(configured,8)) : 2;
  const pollMs = Math.max(150,Number(process.env.SUBMISSION_WORKER_POLL_MS || 400));
  let stopping = false;

  async function workerLoop(workerNumber) {
    while (!stopping) {
      try {
        const job = await claimNextSubmission(pool);
        if (!job) {
          await wait(pollMs);
          continue;
        }

        try {
          const languages = await listAvailableLanguages(pool);
          const language = languages.find((item) => Number(item.language_id) === Number(job.submission.language_id));
          if (!language) {
            await markUnavailable(
              pool,
              job.submission.submission_id,
              'This language version is no longer available on the configured execution service.'
            );
            continue;
          }
          await processSubmission(pool,job.submission,job.testCases,language);
        } catch (error) {
          console.error('Submission worker ' + workerNumber + ' failed:',error.message);
          await markUnavailable(
            pool,
            job.submission.submission_id,
            'The execution service could not complete this request. Please retry.'
          );
        }
      } catch (error) {
        if (!stopping) {
          console.error('Submission queue worker ' + workerNumber + ' could not claim a job:',error.message);
          await wait(Math.max(pollMs,1000));
        }
      }
    }
  }

  const workers = Array.from({length:concurrency},(_,index)=>workerLoop(index+1));
  return async function stopSubmissionWorkers() {
    stopping = true;
    await Promise.all(workers);
  };
}

module.exports = { startSubmissionWorkers };
