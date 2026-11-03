-- Migration 009: recover submissions abandoned by a stopped worker.
-- Apply after migrations 001 through 008, during a normal deployment window.
BEGIN;

ALTER TABLE public.submission
  ADD COLUMN IF NOT EXISTS worker_lease_until TIMESTAMPTZ;

-- Any RUNNING job from before lease support is treated as abandoned once
-- the worker starts, allowing it to be safely re-queued.
UPDATE public.submission
SET worker_lease_until = CURRENT_TIMESTAMP - INTERVAL '1 second'
WHERE execution_status = 'RUNNING'
  AND worker_lease_until IS NULL;

CREATE INDEX IF NOT EXISTS submission_expired_worker_lease_idx
  ON public.submission (worker_lease_until)
  WHERE execution_status = 'RUNNING';

COMMIT;
