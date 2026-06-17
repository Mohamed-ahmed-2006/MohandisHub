-- Job milestone escrow wiring for publish readiness.
ALTER TABLE public.job_milestones
  ADD COLUMN IF NOT EXISTS wallet_hold_id UUID REFERENCES public.wallet_holds(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_payout_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;

ALTER TABLE public.job_milestones DROP CONSTRAINT IF EXISTS job_milestones_status_check;
ALTER TABLE public.job_milestones DROP CONSTRAINT IF EXISTS job_milestones_status_check_publish_ready;
ALTER TABLE public.job_milestones
  ADD CONSTRAINT job_milestones_status_check_publish_ready CHECK (
    status IN ('pending', 'active', 'submitted', 'approved', 'rejected', 'refunded')
  );

CREATE INDEX IF NOT EXISTS idx_job_milestones_wallet_hold
  ON public.job_milestones(wallet_hold_id)
  WHERE wallet_hold_id IS NOT NULL;
