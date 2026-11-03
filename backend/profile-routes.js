const express = require('express');
const crypto = require('node:crypto');
const argon2 = require('argon2');

function legacySha256Matches(password, storedHash) {
  const stored = String(storedHash || '').trim();
  if (!/^[a-f0-9]{64}$/i.test(stored)) return false;
  const actual = crypto.createHash('sha256').update(password, 'utf8').digest();
  const expected = Buffer.from(stored, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

module.exports = function createProfileRouter({ pool, authRequired }) {
  const router = express.Router();

  router.get('/profile', authRequired, async (req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT u.user_id,u.name,u.email,u.joined_at,r.role_name,
                l.preferred_language_id,lang.name AS preferred_language_name,
                lang.version AS preferred_language_version
         FROM public.users u
         JOIN public.role r ON r.role_id=u.role_id
         LEFT JOIN public.learner l ON l.learner_id=u.user_id
         LEFT JOIN public.language lang ON lang.language_id=l.preferred_language_id
         WHERE u.user_id=$1`,
        [req.user.user_id]
      );
      if (!result.rowCount) return res.status(404).json({ error: 'Profile not found.' });
      const isLearner = req.user.role_category === 'Learner';
      const languages = isLearner
        ? await pool.query('SELECT language_id,name,version FROM public.language ORDER BY name,version')
        : { rows: [] };
      res.json({ profile: result.rows[0], languages: languages.rows });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/profile', authRequired, async (req, res, next) => {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const hasPreferred = Object.prototype.hasOwnProperty.call(req.body, 'preferred_language_id');
    const preferredRaw = req.body.preferred_language_id;
    const preferredId = preferredRaw === null || preferredRaw === '' ? null : Number(preferredRaw);

    if (!name || name.length > 100) {
      return res.status(400).json({ error: 'Name is required and must be 100 characters or fewer.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) {
      return res.status(400).json({ error: 'Enter a valid email address of 120 characters or fewer.' });
    }
    if (hasPreferred && req.user.role_category !== 'Learner') {
      return res.status(403).json({ error: 'Preferred language is available to Learner accounts only.' });
    }
    if (hasPreferred && preferredId !== null && (!Number.isSafeInteger(preferredId) || preferredId <= 0)) {
      return res.status(400).json({ error: 'Select a valid preferred language.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        'UPDATE public.users SET name=$1,email=$2 WHERE user_id=$3 RETURNING user_id,name,email,joined_at',
        [name,email,req.user.user_id]
      );
      if (!updated.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Profile not found.' });
      }
      if (hasPreferred) {
        const languageExists = preferredId === null ? true : (await client.query(
          'SELECT 1 FROM public.language WHERE language_id=$1',
          [preferredId]
        )).rowCount > 0;
        if (!languageExists) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Selected language does not exist.' });
        }
        const learner = await client.query(
          'UPDATE public.learner SET preferred_language_id=$1 WHERE learner_id=$2',
          [preferredId,req.user.user_id]
        );
        if (!learner.rowCount) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'Learner profile is not configured for this account.' });
        }
      }
      await client.query('COMMIT');
      res.json({
        profile: {
          ...updated.rows[0],
          role_name: req.user.role_name,
          preferred_language_id: hasPreferred ? preferredId : req.body.preferred_language_id
        },
        message: 'Profile updated successfully.'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') return res.status(409).json({ error: 'That email address is already in use.' });
      next(error);
    } finally {
      client.release();
    }
  });

  router.post('/profile/password', authRequired, async (req, res, next) => {
    const currentPassword = typeof req.body.current_password === 'string' ? req.body.current_password : '';
    const newPassword = typeof req.body.new_password === 'string' ? req.body.new_password : '';
    if (!currentPassword || newPassword.length < 10 || newPassword.length > 1024) {
      return res.status(400).json({ error: 'Enter your current password and a new password between 10 and 1024 characters.' });
    }
    try {
      const result = await pool.query(
        'SELECT password_hash FROM public.users WHERE user_id=$1 AND is_active=TRUE',
        [req.user.user_id]
      );
      if (!result.rowCount) return res.status(401).json({ error: 'Account is unavailable.' });
      const stored = String(result.rows[0].password_hash || '').trim();
      let valid = false;
      if (stored.startsWith('$argon2')) {
        valid = await argon2.verify(stored, currentPassword);
      } else {
        valid = legacySha256Matches(currentPassword, stored);
      }
      if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });

      const newHash = await argon2.hash(newPassword, { type: argon2.argon2id });
      await pool.query(
        'UPDATE public.users SET password_hash=$1 WHERE user_id=$2',
        [newHash,req.user.user_id]
      );

      await new Promise((resolve,reject) => {
        req.session.regenerate((error) => error ? reject(error) : resolve());
      });
      req.session.userId = req.user.user_id;
      await new Promise((resolve,reject) => {
        req.session.save((error) => error ? reject(error) : resolve());
      });
      await pool.query(
        `DELETE FROM public.user_sessions
         WHERE sess->>'userId'=$1 AND sid<>$2`,
        [String(req.user.user_id),req.sessionID]
      );
      res.json({ message: 'Password changed. Other signed-in sessions have been ended.' });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
