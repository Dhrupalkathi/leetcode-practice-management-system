const express = require('express');

module.exports = function createProblemDiscoveryRouter({ pool, authRequired }) {
  const router = express.Router();

  router.get('/topics', async (req, res, next) => {
    try {
      const result = await pool.query(
        'SELECT topic_id, name, description FROM public.topic ORDER BY name'
      );
      res.json({ topics: result.rows });
    } catch (error) {
      next(error);
    }
  });

  router.get('/problems', (req, res, next) => {
    const includeInactive = req.query.includeInactive === 'true';

    const sendProblems = async () => {
      try {
        const result = await pool.query(
          `SELECT p.problem_id, p.title, p.problem_statement, p.input_format,
                  p.output_format, p.constraints, p.difficulty, p.is_active,
                  p.created_at, p.created_by,
                  COALESCE((
                    SELECT json_agg(
                      json_build_object('topic_id', t.topic_id, 'name', t.name)
                      ORDER BY t.name
                    )
                    FROM public.problem_topic pt
                    JOIN public.topic t ON t.topic_id = pt.topic_id
                    WHERE pt.problem_id = p.problem_id
                  ), '[]'::json) AS topics
           FROM public.problem p
           WHERE ($1::boolean OR p.is_active = TRUE)
           ORDER BY p.problem_id`,
          [includeInactive]
        );
        res.json({ problems: result.rows });
      } catch (error) {
        next(error);
      }
    };

    if (includeInactive) return authRequired(req, res, sendProblems);
    return sendProblems();
  });

  router.get('/problems/:id', async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid problem ID.' });
    }

    try {
      const result = await pool.query(
        `SELECT p.problem_id, p.title, p.problem_statement, p.input_format,
                p.output_format, p.constraints, p.difficulty, p.is_active,
                p.created_at, p.created_by,
                COALESCE((
                  SELECT json_agg(
                    json_build_object(
                      'topic_id', t.topic_id,
                      'name', t.name,
                      'description', t.description
                    )
                    ORDER BY t.name
                  )
                  FROM public.problem_topic pt
                  JOIN public.topic t ON t.topic_id = pt.topic_id
                  WHERE pt.problem_id = p.problem_id
                ), '[]'::json) AS topics,
                COALESCE((
                  SELECT json_agg(
                    json_build_object(
                      'test_case_id', tc.test_case_id,
                      'input_data', tc.input_data,
                      'expected_output', tc.expected_output
                    )
                    ORDER BY tc.test_case_id
                  )
                  FROM public.test_case tc
                  WHERE tc.problem_id = p.problem_id
                    AND tc.is_hidden = FALSE
                ), '[]'::json) AS sample_tests
         FROM public.problem p
         WHERE p.problem_id = $1`,
        [id]
      );

      if (!result.rowCount) {
        return res.status(404).json({ error: 'Problem not found.' });
      }

      const problem = result.rows[0];
      if (!problem.is_active) {
        return authRequired(req, res, () => res.json({ problem }));
      }

      res.json({ problem });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
