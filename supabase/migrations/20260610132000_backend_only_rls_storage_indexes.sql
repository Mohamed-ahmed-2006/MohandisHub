-- ============================================================================
-- MohandisHub - backend-only Supabase posture, storage policies, and indexes
-- ============================================================================
-- The browser must use the API. The API uses the service-role key, which bypasses
-- RLS; anon/authenticated roles should not read/write app tables directly.
-- ============================================================================

DO $$
DECLARE
  table_name text;
  app_tables text[] := ARRAY[
    'users',
    'refresh_tokens',
    'customer_profiles',
    'expert_profiles',
    'business_profiles',
    'craftsman_profiles',
    'verification_requests',
    'identity_documents',
    'academic_records',
    'admin_reviews',
    'verification_codes',
    'otp_rate_limits',
    'wallets',
    'transactions',
    'wallet_holds',
    'deposit_requests',
    'withdrawal_requests',
    'user_payout_preferences',
    'plans',
    'plan_subscriptions',
    'user_plan_usage_counters',
    'app_settings',
    'app_settings_wallet_audit',
    'services',
    'service_categories',
    'needs',
    'bids',
    'bookings',
    'availability_slots',
    'reviews',
    'review_reports',
    'review_disputes',
    'jobs',
    'job_applications',
    'job_application_messages',
    'job_milestones',
    'job_submissions',
    'conversations',
    'messages',
    'bid_messages',
    'notifications',
    'reservation_profiles',
    'reservation_slots',
    'reservations',
    'reservation_location_proposals',
    'reservation_checkin_codes',
    'reservation_call_sessions',
    'reservation_call_participants',
    'reservation_disputes',
    'reservation_events',
    'reservation_action_idempotency',
    'reservation_action_failures',
    'private_uploads',
    'support_tickets',
    'support_ticket_messages',
    'favorites',
    'business_teams',
    'business_members',
    'coupons',
    'retention_sweep_log',
    'admin_moderation_log',
    'advertisement_plans',
    'ad_pricing_rules',
    'advertisements',
    'price_negotiations',
    'price_negotiation_rounds',
    'audit_log'
  ];
BEGIN
  FOREACH table_name IN ARRAY app_tables LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', table_name);
    END IF;
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;

DO $$
DECLARE
  policy_name text;
BEGIN
  BEGIN
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'Skipping storage.objects RLS enablement: migration role is not owner.';
  END;

  FOR policy_name IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
  LOOP
    BEGIN
      EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', policy_name);
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'Skipping storage.objects policy drop for %: migration role is not owner.', policy_name;
    END;
  END LOOP;
END $$;

DO $$
BEGIN
  CREATE POLICY "Public uploads are readable"
    ON storage.objects
    FOR SELECT
    TO anon, authenticated
    USING (bucket_id = 'uploads');

  COMMENT ON POLICY "Public uploads are readable" ON storage.objects
    IS 'Only the public uploads bucket is browser-readable. Upload writes and verification-docs access are backend/service-role only.';
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'Storage policy "Public uploads are readable" already exists.';
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping storage.objects policy creation: migration role is not owner.';
END $$;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_revoked_expires
  ON public.refresh_tokens(user_id, revoked_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_verification_codes_lookup_unexpired
  ON public.verification_codes(user_id, channel, destination, expires_at DESC)
  WHERE verified_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_desc
  ON public.messages(conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_resource_created
  ON public.audit_log(resource_type, resource_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deposit_requests_review_queue
  ON public.deposit_requests(status, provider, created_at DESC)
  WHERE status IN ('pending', 'pending_review', 'underpaid');

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_review_queue
  ON public.withdrawal_requests(status, provider, created_at DESC)
  WHERE status IN ('pending', 'processing', 'admin_review');

CREATE INDEX IF NOT EXISTS idx_reservations_pending_expiry
  ON public.reservations(created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_reservation_disputes_open_created
  ON public.reservation_disputes(created_at DESC)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_reservation_action_failures_open_created
  ON public.reservation_action_failures(created_at DESC)
  WHERE resolved_at IS NULL;

ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_type_check_publish_ready;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_type_check_publish_ready CHECK (
    type IN ('deposit', 'withdrawal', 'payment', 'refund', 'adjustment', 'bonus', 'commission', 'release', 'hold', 'reversal')
  ) NOT VALID;

ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_status_check_publish_ready;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_status_check_publish_ready CHECK (
    status IN ('pending', 'completed', 'failed', 'cancelled', 'reversed')
  ) NOT VALID;

ALTER TABLE public.wallet_holds DROP CONSTRAINT IF EXISTS wallet_holds_status_check_publish_ready;
ALTER TABLE public.wallet_holds
  ADD CONSTRAINT wallet_holds_status_check_publish_ready CHECK (
    status IN ('held', 'released', 'captured', 'cancelled')
  ) NOT VALID;

ALTER TABLE public.deposit_requests DROP CONSTRAINT IF EXISTS deposit_requests_provider_status_check_publish_ready;
ALTER TABLE public.deposit_requests
  ADD CONSTRAINT deposit_requests_provider_status_check_publish_ready CHECK (
    status IN ('pending', 'paid', 'expired', 'failed', 'cancelled', 'pending_review', 'rejected', 'completed', 'underpaid')
  ) NOT VALID;

ALTER TABLE public.withdrawal_requests DROP CONSTRAINT IF EXISTS withdrawal_requests_status_check_publish_ready;
ALTER TABLE public.withdrawal_requests
  ADD CONSTRAINT withdrawal_requests_status_check_publish_ready CHECK (
    status IN ('pending', 'pending_verification', 'processing', 'finished', 'failed', 'rejected', 'cancelled', 'blocked', 'awaiting_transfer', 'admin_review')
  ) NOT VALID;
