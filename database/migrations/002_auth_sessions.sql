-- Migration 002: PostgreSQL-backed sessions and modern password storage.
-- VARCHAR widening preserves existing 64-character SHA-256 demo hashes.
BEGIN;
ALTER TABLE public.users
  ALTER COLUMN password_hash TYPE VARCHAR(255)
  USING BTRIM(password_hash::text);
CREATE TABLE IF NOT EXISTS public.user_sessions (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS user_sessions_expire_idx
  ON public.user_sessions (expire);
COMMIT;
