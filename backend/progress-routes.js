const express = require('express');

module.exports = function createProgressRouter({ pool, authRequired, allowRoles }) {
  const router = express.Router();

  router.get('/progress/me', authRequired, allowRoles('Learner'), async (req, res, next) => {
    const userId = req.user.user_id;

    try {
      const [
        summaryResult,
        streakResult,
        activityResult,
        topicResult,
        languageResult,
        recentResult
      ] = await Promise.all([
        pool.query(
          `SELECT
             COUNT(*) FILTER (
               WHERE is_run_only = FALSE AND execution_status = 'COMPLETED'
             )::integer AS completed_submissions,
             COUNT(*) FILTER (
               WHERE is_run_only = FALSE
                 AND execution_status = 'COMPLETED'
                 AND verdict_id = 1
             )::integer AS accepted_submissions,
             COUNT(DISTINCT problem_id) FILTER (
               WHERE is_run_only = FALSE AND execution_status = 'COMPLETED'
             )::integer AS attempted_problems,
             COUNT(DISTINCT problem_id) FILTER (
               WHERE is_run_only = FALSE
                 AND execution_status = 'COMPLETED'
                 AND verdict_id = 1
             )::integer AS solved_problems,
             COUNT(*) FILTER (
               WHERE is_run_only = FALSE
                 AND execution_status IN ('PENDING', 'RUNNING')
             )::integer AS active_submissions,
             COALESCE(SUM(time_taken_ms) FILTER (
               WHERE is_run_only = FALSE AND execution_status = 'COMPLETED'
             ), 0)::bigint AS total_execution_time_ms
           FROM public.submission
           WHERE user_id = $1 AND assessment_id IS NULL AND contest_id IS NULL`,
          [userId]
        ),
        pool.query(
          `WITH RECURSIVE practice_days AS (
             SELECT DISTINCT submitted_at::date AS practice_day
             FROM public.submission
             WHERE user_id = $1
               AND assessment_id IS NULL AND contest_id IS NULL
               AND is_run_only = FALSE
               AND execution_status = 'COMPLETED'
           ),
           streak(practice_day, length) AS (
             SELECT latest.practice_day, 1
             FROM (SELECT MAX(practice_day) AS practice_day FROM practice_days) latest
             WHERE latest.practice_day >= CURRENT_DATE - 1
             UNION ALL
             SELECT previous.practice_day, streak.length + 1
             FROM streak
             JOIN practice_days previous
               ON previous.practice_day = streak.practice_day - 1
           )
           SELECT COALESCE(MAX(length), 0)::integer AS current_streak
           FROM streak`,
          [userId]
        ),
        pool.query(
          `WITH days AS (
             SELECT generate_series(
               CURRENT_DATE - INTERVAL '29 days',
               CURRENT_DATE,
               INTERVAL '1 day'
             )::date AS activity_day
           ),
           counts AS (
             SELECT submitted_at::date AS activity_day,
                    COUNT(*)::integer AS submissions,
                    COUNT(*) FILTER (WHERE verdict_id = 1)::integer AS accepted
             FROM public.submission
             WHERE user_id = $1
               AND assessment_id IS NULL AND contest_id IS NULL
               AND is_run_only = FALSE
               AND execution_status = 'COMPLETED'
               AND submitted_at >= CURRENT_DATE - INTERVAL '29 days'
             GROUP BY submitted_at::date
           )
           SELECT days.activity_day,
                  COALESCE(counts.submissions, 0)::integer AS submissions,
                  COALESCE(counts.accepted, 0)::integer AS accepted
           FROM days
           LEFT JOIN counts USING (activity_day)
           ORDER BY days.activity_day`,
          [userId]
        ),
        pool.query(
          `SELECT t.topic_id, t.name,
                  COUNT(DISTINCT s.problem_id) FILTER (
                    WHERE s.is_run_only = FALSE
                      AND s.execution_status = 'COMPLETED'
                  )::integer AS attempted_problems,
                  COUNT(DISTINCT s.problem_id) FILTER (
                    WHERE s.is_run_only = FALSE
                      AND s.execution_status = 'COMPLETED'
                      AND s.verdict_id = 1
                  )::integer AS solved_problems,
                  COUNT(s.submission_id) FILTER (
                    WHERE s.is_run_only = FALSE
                      AND s.execution_status = 'COMPLETED'
                  )::integer AS submissions
           FROM public.topic t
           JOIN public.problem_topic pt ON pt.topic_id = t.topic_id
           JOIN public.problem p ON p.problem_id = pt.problem_id
           JOIN public.submission s ON s.problem_id = p.problem_id
           WHERE s.user_id = $1
             AND s.assessment_id IS NULL AND s.contest_id IS NULL AND s.contest_id IS NULL
           GROUP BY t.topic_id, t.name
           HAVING COUNT(s.submission_id) FILTER (
             WHERE s.is_run_only = FALSE
               AND s.execution_status = 'COMPLETED'
           ) > 0
           ORDER BY solved_problems DESC, submissions DESC, t.name
           LIMIT 12`,
          [userId]
        ),
        pool.query(
          `SELECT l.language_id, l.name, l.version,
                  COUNT(*)::integer AS submissions,
                  COUNT(*) FILTER (WHERE s.verdict_id = 1)::integer AS accepted
           FROM public.submission s
           JOIN public.language l ON l.language_id = s.language_id
           WHERE s.user_id = $1
             AND s.assessment_id IS NULL AND s.contest_id IS NULL AND s.contest_id IS NULL
             AND s.is_run_only = FALSE
             AND s.execution_status = 'COMPLETED'
           GROUP BY l.language_id, l.name, l.version
           ORDER BY submissions DESC, l.name
           LIMIT 6`,
          [userId]
        ),
        pool.query(
          `SELECT s.submission_id, s.problem_id, p.title AS problem_title,
                  s.attempt_number, s.submitted_at, s.execution_status,
                  s.is_run_only, v.verdict_name,
                  l.name AS language_name, l.version AS language_version
           FROM public.submission s
           JOIN public.problem p ON p.problem_id = s.problem_id
           JOIN public.language l ON l.language_id = s.language_id
           LEFT JOIN public.verdict v ON v.verdict_id = s.verdict_id
           WHERE s.user_id = $1 AND s.assessment_id IS NULL AND s.contest_id IS NULL AND s.contest_id IS NULL
           ORDER BY s.submitted_at DESC, s.submission_id DESC
           LIMIT 8`,
          [userId]
        )
      ]);

      const summary = summaryResult.rows[0];
      const completed = Number(summary.completed_submissions || 0);
      const accepted = Number(summary.accepted_submissions || 0);
      const attempts = Number(summary.attempted_problems || 0);

      res.json({
        summary: {
          completed_submissions: completed,
          accepted_submissions: accepted,
          attempted_problems: attempts,
          solved_problems: Number(summary.solved_problems || 0),
          active_submissions: Number(summary.active_submissions || 0),
          current_streak: Number(streakResult.rows[0].current_streak || 0),
          acceptance_rate: completed ? Number((accepted * 100 / completed).toFixed(1)) : 0,
          solve_rate: attempts
            ? Number((Number(summary.solved_problems || 0) * 100 / attempts).toFixed(1))
            : 0,
          total_execution_time_ms: Number(summary.total_execution_time_ms || 0)
        },
        daily_activity: activityResult.rows,
        topic_performance: topicResult.rows,
        language_usage: languageResult.rows,
        recent_activity: recentResult.rows
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
