-- ============================================================================
-- MohandisHub — automatic advertisement renewal (Wave 2F-B)
-- ----------------------------------------------------------------------------
-- Wave 2F-A sold advertisement weeks one at a time and left the automatic
-- renewal columns inert: `auto_renew_enabled` existed, defaulted to false, and
-- the API refused to set it because no scheduler existed. This migration adds
-- the two things that were genuinely missing, and nothing else.
--
--   1. CONSENT AUDIT. `auto_renew_enabled` on its own records a flag, not a
--      decision. A standing instruction to debit a provider's credits every
--      week has to be attributable: who turned it on, when, and against which
--      version of the terms they were shown. A CHECK makes the audit
--      structural — the flag cannot be true without it — so "no automatic
--      renewal without explicit consent" is a database property rather than a
--      code path somebody could forget.
--
--   2. A BOUNDARY EVENT LOG. `advertisement_renewal_events` records, exactly
--      once, what happened at each renewal boundary. It is doing four jobs that
--      would otherwise need four mechanisms:
--
--        * notification deduplication — one durable notification per
--          (advertisement, boundary, event), enforced by a unique index rather
--          than by application logic. Ten workers racing produce one row;
--        * the no-repeat-debit gate — a boundary that already failed carries a
--          row, so a sweep cannot re-attempt the same charge on a timer;
--        * a notification OUTBOX — `notified_at` is stamped when the in-app row
--          is written. A crash between the financial commit and the push cannot
--          lose the notification, and cannot send it twice;
--        * renewal history for the provider's screen, without exposing ledger
--          internals.
--
-- What this migration deliberately does NOT do:
--
--   * it does not enable automatic renewal anywhere. Every existing row stays
--     `auto_renew_enabled = false`; enabling is a provider action with consent,
--     never a migration side effect;
--   * it does not change `mhc_action_prices.advertisement`. The weekly price
--     stays 0, and the assertion at the bottom refuses to let a replay change
--     that. Setting a price remains a deliberate admin decision;
--   * it does not touch a single period row, charge row, ledger row or legacy
--     advertisement. `billing_model = 'legacy'` campaigns are excluded from the
--     claim index and are rejected by the service layer;
--   * it does not weaken any 2F-A constraint. `chk_ad_period_exact_week`,
--     `uq_ad_period_active`, `uq_ad_period_number`, `ad_period_no_overlap` and
--     `uq_mhc_action_charge_reference` are exactly what makes exactly-once
--     renewal true, and all of them are untouched;
--   * it adds no new `billing_status` value. A renewal that failed leaves the
--     campaign in the state it is genuinely in — `renewal_required`, the paid
--     week ended and another must be bought — and records WHY separately in
--     `auto_renew_paused_reason`. A reason is not a lifecycle state, and
--     conflating them would have made the provider's remedy (renew manually)
--     unreachable.
--
-- ----------------------------------------------------------------------------
-- ROLLBACK (tested on scratch replay copies — see
-- advertisements.automatic-renewal.pg.test.ts):
--
--   -- Newest dependants first. Nothing added AFTER this migration references
--   -- these objects today; if something does later, reverse it before this.
--   DROP TABLE IF EXISTS public.advertisement_renewal_events;
--
--   ALTER TABLE public.advertisements
--     DROP CONSTRAINT IF EXISTS chk_advertisements_auto_renew_consent,
--     DROP CONSTRAINT IF EXISTS chk_advertisements_auto_renew_paused_reason,
--     DROP CONSTRAINT IF EXISTS chk_advertisements_auto_renew_paused_shape,
--     DROP CONSTRAINT IF EXISTS chk_advertisements_last_renewal_outcome;
--
--   DROP INDEX IF EXISTS public.idx_advertisements_auto_renew_due;
--
--   ALTER TABLE public.advertisements
--     DROP COLUMN IF EXISTS auto_renew_enabled_at,
--     DROP COLUMN IF EXISTS auto_renew_enabled_by,
--     DROP COLUMN IF EXISTS auto_renew_consent_version,
--     DROP COLUMN IF EXISTS auto_renew_paused_reason,
--     DROP COLUMN IF EXISTS auto_renew_paused_at,
--     DROP COLUMN IF EXISTS last_renewal_outcome,
--     DROP COLUMN IF EXISTS last_renewal_attempt_at;
--
-- Dropping the event table destroys the record of which boundary produced which
-- outcome, and the outbox stamp that proves a notification was delivered once.
-- No FINANCIAL record is lost: `mhc_action_charges`, `transactions` and
-- `advertisement_campaign_periods` all survive and remain authoritative. Export
-- the table first in any environment that has renewed automatically.
--
-- `advertisement_renewal_events.period_id` is a foreign key onto
-- `advertisement_campaign_periods`, so this table must be dropped BEFORE the
-- 20260730120000 rollback and before step 1 of the 20260729140000 rollback.
-- Both of those headers have been extended to say so.
--
-- Both halves are idempotent and safe to run twice.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Prerequisites — fail loudly rather than half-creating a renewal log
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.advertisements') IS NULL THEN
    RAISE EXCEPTION 'public.advertisements is missing; apply 20260409123000 first.';
  END IF;
  IF to_regclass('public.advertisement_campaign_periods') IS NULL THEN
    RAISE EXCEPTION 'public.advertisement_campaign_periods is missing; apply 20260730120000 first.';
  END IF;
  IF to_regclass('public.mhc_action_prices') IS NULL THEN
    RAISE EXCEPTION 'public.mhc_action_prices is missing; apply 20260728120000 first.';
  END IF;
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'public.users is missing; apply the core migrations first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Consent audit and paused-renewal state
-- ---------------------------------------------------------------------------
ALTER TABLE public.advertisements
  ADD COLUMN IF NOT EXISTS auto_renew_enabled_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_renew_enabled_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS auto_renew_consent_version VARCHAR(20),
  ADD COLUMN IF NOT EXISTS auto_renew_paused_reason   VARCHAR(32),
  ADD COLUMN IF NOT EXISTS auto_renew_paused_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_renewal_outcome       VARCHAR(40),
  ADD COLUMN IF NOT EXISTS last_renewal_attempt_at    TIMESTAMPTZ;

COMMENT ON COLUMN public.advertisements.auto_renew_enabled_at IS
  'When the advertiser consented to automatic weekly renewal. '
  'chk_advertisements_auto_renew_consent makes this NOT NULL whenever '
  'auto_renew_enabled is true, so the flag cannot exist without the consent '
  'record behind it. Retained after the advertiser turns automatic renewal off: '
  'an audit trail that is erased is not an audit trail.';
COMMENT ON COLUMN public.advertisements.auto_renew_enabled_by IS
  'The account that consented. Always the advertiser — no admin route enables '
  'automatic renewal on a provider''s behalf.';
COMMENT ON COLUMN public.advertisements.auto_renew_consent_version IS
  'Which version of the automatic-renewal terms the advertiser accepted, so a '
  'later wording change is distinguishable from the one they agreed to. '
  'Deliberately NOT an IP address or a user agent: nothing about this decision '
  'needs to identify a device, and the existing audit standard does not collect '
  'them for provider self-service actions.';
COMMENT ON COLUMN public.advertisements.auto_renew_paused_reason IS
  'Why the scheduler stopped renewing this campaign automatically: '
  'insufficient_credits, pricing_unavailable, max_weeks_reached or '
  'end_date_reached. NULL means the scheduler may act. This is the gate that '
  'stops a failed boundary from being retried on a timer — clearing it is an '
  'explicit advertiser action, never a sweep.';
COMMENT ON COLUMN public.advertisements.last_renewal_outcome IS
  'What the most recent renewal attempt did, for display. The authoritative, '
  'deduplicated record is advertisement_renewal_events.';

DO $$
BEGIN
  -- Explicit consent, expressed structurally. No code path can set the flag
  -- without recording who agreed and when, because the row would not commit.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_advertisements_auto_renew_consent') THEN
    ALTER TABLE public.advertisements
      ADD CONSTRAINT chk_advertisements_auto_renew_consent
      CHECK (
        auto_renew_enabled = false
        OR (auto_renew_enabled_at IS NOT NULL AND auto_renew_enabled_by IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_advertisements_auto_renew_paused_reason') THEN
    ALTER TABLE public.advertisements
      ADD CONSTRAINT chk_advertisements_auto_renew_paused_reason
      CHECK (auto_renew_paused_reason IS NULL OR auto_renew_paused_reason IN (
        'insufficient_credits', 'pricing_unavailable',
        'max_weeks_reached', 'end_date_reached'
      ));
  END IF;

  -- Half a pause is never meaningful: a reason without a time, or a time
  -- without a reason, would leave the scheduler gate ambiguous.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_advertisements_auto_renew_paused_shape') THEN
    ALTER TABLE public.advertisements
      ADD CONSTRAINT chk_advertisements_auto_renew_paused_shape
      CHECK ((auto_renew_paused_reason IS NULL) = (auto_renew_paused_at IS NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_advertisements_last_renewal_outcome') THEN
    ALTER TABLE public.advertisements
      ADD CONSTRAINT chk_advertisements_last_renewal_outcome
      CHECK (last_renewal_outcome IS NULL OR last_renewal_outcome IN (
        'succeeded', 'insufficient_credits', 'pricing_unavailable',
        'max_weeks_reached', 'end_date_reached'
      ));
  END IF;
END $$;

-- "Which automatic campaigns are due for a renewal right now?" — the scheduler's
-- candidate read, and the only query that drives an automatic charge.
--
-- Partial on exactly the rows that can ever be candidates: weekly billing,
-- consented automatic renewal, and not paused. A legacy campaign, a manual
-- campaign, a cancelled campaign and a campaign whose last boundary failed are
-- all outside the index, so none of them can be reached by the sweep even if a
-- predicate were later loosened by mistake.
CREATE INDEX IF NOT EXISTS idx_advertisements_auto_renew_due
  ON public.advertisements (billing_status, current_period_ends_at)
  WHERE billing_model = 'weekly'
    AND auto_renew_enabled = true
    AND renewal_mode = 'automatic'
    AND auto_renew_paused_reason IS NULL;

-- ---------------------------------------------------------------------------
-- 2. The boundary event log
-- ---------------------------------------------------------------------------
-- One row per (advertisement, renewal boundary, kind of thing that happened).
--
-- "Boundary" is `boundary_period_number`: the period number the campaign was
-- trying to buy. The first week is boundary 1; the first renewal is boundary 2.
-- Using the period NUMBER rather than a timestamp is what makes the identity
-- stable — a worker that runs three hours late is still acting on boundary 4,
-- and cannot be tricked into treating a retry as a new boundary by the clock.
CREATE TABLE IF NOT EXISTS public.advertisement_renewal_events (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- CASCADE, matching advertisement_campaign_periods: an event is a detail of
  -- the campaign. The financial record is the mhc_action_charges row, which is
  -- ON DELETE RESTRICT from users and survives an advertisement being deleted.
  advertisement_id       UUID          NOT NULL REFERENCES public.advertisements(id) ON DELETE CASCADE,
  advertiser_id          UUID          NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  boundary_period_number INTEGER       NOT NULL CHECK (boundary_period_number >= 1),
  event_type             VARCHAR(48)   NOT NULL,
  -- The week this event produced, when it produced one. SET NULL rather than
  -- CASCADE so deleting a period cannot silently delete the record that it was
  -- ever bought.
  period_id              UUID          REFERENCES public.advertisement_campaign_periods(id) ON DELETE SET NULL,
  -- Small, non-sensitive facts a screen needs: the price that was charged, the
  -- boundary that was reached. Never a balance, never an identifier belonging
  -- to anybody but the advertiser, never a ledger internal.
  detail                 JSONB         NOT NULL DEFAULT '{}'::jsonb,
  -- The OUTBOX stamp. Set when the durable in-app notification row exists.
  -- NULL means "committed but not yet delivered", which is exactly the state a
  -- crash between the financial commit and the push leaves behind, and exactly
  -- what the redelivery sweep claims.
  notified_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT chk_ad_renewal_event_type
    CHECK (event_type IN (
      'initial_activated',
      'renewal_succeeded',
      'renewal_failed_insufficient_credits',
      'renewal_failed_pricing_unavailable',
      'manual_renewal_required',
      'auto_renew_stopped_max_weeks',
      'auto_renew_stopped_end_date',
      'renewal_reminder',
      'auto_renew_enabled',
      'auto_renew_disabled'
    ))
);

COMMENT ON TABLE public.advertisement_renewal_events IS
  'One row per advertisement renewal boundary outcome. Simultaneously the '
  'notification deduplication identity, the gate that stops a failed boundary '
  'being retried on a timer, the notification outbox, and the provider-facing '
  'renewal history. NOT money — the financial records are mhc_action_charges '
  'and transactions.';
COMMENT ON COLUMN public.advertisement_renewal_events.boundary_period_number IS
  'The period number this event concerns — the week the campaign was trying to '
  'buy. Stable under a late or retried worker, unlike a timestamp.';
COMMENT ON COLUMN public.advertisement_renewal_events.notified_at IS
  'When the durable in-app notification for this event was written. Claimed '
  'with UPDATE ... WHERE notified_at IS NULL RETURNING, so exactly one worker '
  'delivers even when several sweep the same row.';
COMMENT ON COLUMN public.advertisement_renewal_events.advertiser_id IS
  'Denormalised owner, so the redelivery sweep can address a notification '
  'without joining advertisements, and so an event can never be delivered to '
  'anyone but the campaign''s own advertiser.';

-- ---------------------------------------------------------------------------
-- 3. Exactly-once identity
-- ---------------------------------------------------------------------------
-- The whole deduplication guarantee, in one index. Ten workers that all decide
-- boundary 4 failed for lack of credits produce ONE row; nine of them get a
-- 23505, roll their transaction back, and notify nobody.
--
-- The predicate is an explicit ALLOW-LIST rather than an exclusion, so a future
-- event type is non-deduplicated only by a deliberate decision to leave it out.
-- The two configuration acknowledgements are outside it on purpose: turning
-- automatic renewal off and on again within one week is a real sequence of two
-- advertiser decisions, and suppressing the second acknowledgement would be
-- wrong. They are made idempotent instead by only being written when the stored
-- configuration actually changes.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_renewal_event_boundary
  ON public.advertisement_renewal_events (advertisement_id, boundary_period_number, event_type)
  WHERE event_type IN (
    'initial_activated',
    'renewal_succeeded',
    'renewal_failed_insufficient_credits',
    'renewal_failed_pricing_unavailable',
    'manual_renewal_required',
    'auto_renew_stopped_max_weeks',
    'auto_renew_stopped_end_date',
    'renewal_reminder'
  );

-- Provider-facing history, newest first.
CREATE INDEX IF NOT EXISTS idx_ad_renewal_events_advertisement
  ON public.advertisement_renewal_events (advertisement_id, created_at DESC);

-- "Which events have been committed but not yet delivered?" — the outbox sweep.
-- Partial, so a delivered event costs nothing to keep forever.
CREATE INDEX IF NOT EXISTS idx_ad_renewal_events_undelivered
  ON public.advertisement_renewal_events (created_at)
  WHERE notified_at IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Backend-only access posture
-- ---------------------------------------------------------------------------
-- Same lockdown as every billing-adjacent table since 20260610132000: the API
-- service role is the only reader, and no PostgREST client ever sees this.
DO $$
BEGIN
  IF to_regclass('public.advertisement_renewal_events') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.advertisement_renewal_events ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON TABLE public.advertisement_renewal_events FROM anon, authenticated';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Assert the end state
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  enabled_count INTEGER;
  ad_price      NUMERIC;
BEGIN
  -- Nothing may start renewing automatically because this file was deployed.
  -- Consent is a provider action; a migration cannot give it on their behalf.
  SELECT count(*) INTO enabled_count
  FROM public.advertisements
  WHERE auto_renew_enabled;
  IF enabled_count > 0 THEN
    RAISE EXCEPTION '% advertisement(s) have automatic renewal enabled; it must be opt-in with recorded consent', enabled_count;
  END IF;

  -- The log starts empty. A backfilled "event" would be a claim that something
  -- happened at a boundary that was never reached.
  IF EXISTS (SELECT 1 FROM public.advertisement_renewal_events) THEN
    RAISE EXCEPTION 'advertisement_renewal_events must start empty; an event records a real boundary outcome, not a backfill';
  END IF;

  -- Nothing may become weekly-billed by migration, restated here because this
  -- file is the one that makes weekly billing chargeable without a human.
  IF EXISTS (SELECT 1 FROM public.advertisements WHERE billing_model <> 'legacy' AND billing_model <> 'weekly') THEN
    RAISE EXCEPTION 'unexpected advertisements.billing_model value';
  END IF;

  -- The weekly price stays where the admin left it. Shipping automatic renewal
  -- is what UNBLOCKS a non-zero price; it is not the act of setting one.
  SELECT mhc_price INTO ad_price
  FROM public.mhc_action_prices
  WHERE action_key = 'advertisement';
  IF ad_price IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'advertisement weekly price is % — this migration must not change it', ad_price;
  END IF;
END $$;
