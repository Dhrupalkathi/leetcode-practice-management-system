const express = require('express');

function currentStreak(activityDates, today) {
  const active = new Set(activityDates.map((row) => row.activity_date));
  const todayDate = new Date(today + 'T00:00:00.000Z');
  const yesterdayDate = new Date(todayDate);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterday = yesterdayDate.toISOString().slice(0, 10);
  let cursor = active.has(today) ? today : active.has(yesterday) ? yesterday : null;
  let streak = 0;
  while (cursor && active.has(cursor)) {
    streak += 1;
    const previous = new Date(cursor + 'T00:00:00.000Z');
    previous.setUTCDate(previous.getUTCDate() - 1);
    cursor = previous.toISOString().slice(0, 10);
  }
  return streak;
}

module.exports = function createDashboardRouter({ pool, authRequired, allowRoles }) {
  const router = express.Router();

  router.get('/dashboard/me', authRequired, allowRoles('Learner'), async (req, res, next) => {
    try {
      const [summaryResult, topicResult, activityResult, datesResult, recentResult, todayResult] = await Promise.all([
        pool.query(
          `SELECT
             COUNT(*) FILTER (WHERE s.is_run_only = FALSE)::integer AS total_submissions,
             COUNT(*) FILTER (WHERE s.is_run_only = FALSE AND s.execution_status = 'COMPLETED')::integer AS evaluated_submissions,
             COUNT(*) FILTER (WHERE s.is_run_only = FALSE AND s.execution_status = 'COMPLETED' AND v.result = 'PASSED')::integer AS accepted_submissions,
             COUNT(DISTINCT s.problem_id) FILTER (WHERE s.is_run_only = FALSE AND s.execution_status = 'COMPLETED' AND v.result = 'PASSED')::integer AS solved_problems,
             COUNT(DISTINCT s.problem_id) FILTER (WHERE s.is_run_only = FALSE AND s.execution_status = 'COMPLETED')::integer AS attempted_problems,
             COALESCE(ROUND(AVG(s.time_taken_ms) FILTER (WHERE s.is_run_only = FALSE AND s.execution_status = 'COMPLETED' AND v.result = 'PASSED')), 0)::integer AS average_accepted_time_ms
           FROM public.submission s
           LEFT JOIN public.verdict v ON v.verdict_id = s.verdict_id
           WHERE s.user_id = $1`,
          [req.user.user_id]
        ),
        pool.query(
          `WITH per_problem AS (
             SELECT s.problem_id,
                    BOOL_OR(v.result = 'PASSED') AS solved
             FROM public.submission s
             LEFT JOIN public.verdict v ON v.verdict_id = s.verdict_id
             WHERE s.user_id = $1
               AND s.is_run_only = FALSE
               AND s.execution_status = 'COMPLETED'
             GROUP BY s.problem_id
           )
           SELECT t.topic_id, t.name,
                  COUNT(DISTINCT pp.problem_id)::integer AS attempted_problems,
                  COUNT(DISTINCT pp.problem_id) FILTER (WHERE pp.solved)::integer AS solved_problems,
                  CASE WHEN COUNT(DISTINCT pp.problem_id) = 0 THEN 0
                       ELSE ROUND(100.0 * COUNT(DISTINCT pp.problem_id) FILTER (WHERE pp.solved) / COUNT(DISTINCT pp.problem_id), 1)
                  END AS solve_rate
           FROM per_problem pp
           JOIN public.problem_topic pt ON pt.problem_id = pp.problem_id
           JOIN public.topic t ON t.topic_id = pt.topic_id
           GROUP BY t.topic_id, t.name
           ORDER BY solved_problems DESC, attempted_problems DESC, t.name`,
          [req.user.user_id]
        ),
        pool.query(
          `WITH daily AS (
             SELECT submitted_at::date AS activity_date, COUNT(*)::integer AS submissions
             FROM public.submission
             WHERE user_id = $1 AND is_run_only = FALSE
               AND submitted_at::date >= CURRENT_DATE - INTERVAL '29 days'
             GROUP BY submitted_at::date
           )
           SELECT TO_CHAR(days.day, 'YYYY-MM-DD') AS activity_date,
                  COALESCE(daily.submissions, 0)::integer AS submissions
           FROM GENERATE_SERIES(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, INTERVAL '1 day') AS days(day)
           LEFT JOIN daily ON daily.activity_date = days.day::date
           ORDER BY days.day`,
          [req.user.user_id]
        ),
        pool.query(
          `SELECT DISTINCT submitted_at::date::text AS activity_date
           FROM public.submission
           WHERE user_id = $1 AND is_run_only = FALSE
           ORDER BY activity_date DESC`,
          [req.user.user_id]
        ),
        pool.query(
          `SELECT s.submission_id, s.problem_id, p.title AS problem_title,
                  s.attempt_number, s.submitted_at, s.execution_status,
                  s.time_taken_ms, s.memory_used_kb, s.is_run_only,
                  v.verdict_name, l.name AS language_name, l.version AS language_version
           FROM public.submission s
           JOIN public.problem p ON p.problem_id = s.problem_id
           JOIN public.language l ON l.language_id = s.language_id
           LEFT JOIN public.verdict v ON v.verdict_id = s.verdict_id
           WHERE s.user_id = $1 AND s.is_run_only = FALSE
           ORDER BY s.submitted_at DESC
           LIMIT 8`,
          [req.user.user_id]
        ),
        pool.query('SELECT CURRENT_DATE::text AS today')
      ]);

      const summary = summaryResult.rows[0];
      const evaluated = Number(summary.evaluated_submissions || 0);
      const accepted = Number(summary.accepted_submissions || 0);
      const successRate = evaluated === 0 ? 0 : Math.round((accepted / evaluated) * 1000) / 10;

      res.json({
        summary: {
          total_submissions: Number(summary.total_submissions || 0),
          evaluated_submissions: evaluated,
          accepted_submissions: accepted,
          solved_problems: Number(summary.solved_problems || 0),
          attempted_problems: Number(summary.attempted_problems || 0),
          success_rate: successRate,
          average_accepted_time_ms: Number(summary.average_accepted_time_ms || 0),
          current_streak: currentStreak(datesResult.rows, todayResult.rows[0].today)
        },
        topic_performance: topicResult.rows,
        activity: activityResult.rows,
        recent_submissions: recentResult.rows
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
