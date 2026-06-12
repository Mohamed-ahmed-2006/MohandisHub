-- ============================================================================
-- Phase 1 trust operations: dispute case files and money audit support
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.reservation_dispute_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID NOT NULL REFERENCES public.reservation_disputes(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 4000),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reservation_dispute_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID NOT NULL REFERENCES public.reservation_disputes(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  upload_id UUID NOT NULL REFERENCES public.private_uploads(id) ON DELETE RESTRICT,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dispute_id, upload_id)
);

CREATE INDEX IF NOT EXISTS idx_reservation_dispute_notes_dispute_created
  ON public.reservation_dispute_notes(dispute_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reservation_dispute_evidence_dispute_created
  ON public.reservation_dispute_evidence(dispute_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_reference_created
  ON public.transactions(reference_type, reference_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_holds_reference_created
  ON public.wallet_holds(reference_type, reference_id, created_at DESC);

DO $$
DECLARE
  table_name text;
  app_tables text[] := ARRAY[
    'reservation_dispute_notes',
    'reservation_dispute_evidence'
  ];
BEGIN
  FOREACH table_name IN ARRAY app_tables LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', table_name);
    END IF;
  END LOOP;
END $$;
