-- ============================================================================
-- MohandisHub — weekly advertisement billing periods (Wave 2F-A)
-- ----------------------------------------------------------------------------
-- Approved product decision: an advertisement is sold in WEEKS, one week at a
-- time, paid in MHC. It supersedes the flat per-campaign charge that
-- 20260729150000 wired up and that launch constraint LC-01 froze at price 0.
--
-- What changes, in one sentence: the unit of sale stops being "a campaign" and
-- becomes "a seven-day period", and each period is its own row with its own
-- price snapshot and its own idempotent MHC charge.
--
-- Why a period TABLE rather than more columns on `advertisements`:
--
--   * every period needs its OWN charge reference, so the generic charge
--     primitive can be idempotent per week rather than per campaign. Columns on
--     the campaign row can hold one charge; a renewal needs a second;
--   * a price snapshot has to survive an admin price change, and there is one
--     snapshot per week, not one per campaign;
--   * "at most one active week" and "no two weeks overlap" are database
--     invariants on a set of rows. There is no column shape that expresses them.
--
-- What this migration deliberately does NOT do:
--
--   * it does not change `mhc_action_prices.advertisement`. The value stays
--     whatever it already is (0), and the LC-01 successor constraint keeps it
--     there until Wave 2F-B ships automatic renewal, notifications and the full
--     renewal UI. Choosing a price is an admin action, not a migration;
--   * it does not backfill periods for existing advertisements, does not charge
--     them, and does not convert them to weekly billing. Every existing row
--     keeps `billing_model = 'legacy'` and is never touched by the weekly
--     billing code paths;
--   * it does not drop one legacy EGP column. `amount_paid`,
--     `daily_price_piastres`, `quoted_amount_piastres`, `wallet_hold_id` and
--     `cancellation_refund_piastres` remain the historical record of what
--     pre-MHC campaigns were actually charged and refunded;
--   * it does not enable automatic renewal. The columns for it exist so the
--     schema does not have to change again in 2F-B, but `auto_renew_enabled`
--     defaults to false, cannot be set without a bound, and no code path in this
--     wave turns it on.
--
-- The live database currently holds ZERO advertisement rows. Nothing below
-- relies on that: every backfill is expressed as a column DEFAULT or a guarded
-- UPDATE, so the migration is correct for one existing row or one million.
--
-- ----------------------------------------------------------------------------
-- ROLLBACK (tested on scratch replay copies — see advertisements.weekly-billing.pg.test.ts):
--
--   -- Newest dependants first. Nothing added AFTER this migration references
--   -- these objects today; if something does later, reverse it before this.
--   DROP TABLE IF EXISTS public.advertisement_campaign_periods;
--
--   ALTER TABLE public.advertisements
--     DROP CONSTRAINT IF EXISTS chk_advertisements_billing_model,
--     DROP CONSTRAINT IF EXISTS chk_advertisements_billing_status,
--     DROP CONSTRAINT IF EXISTS chk_advertisements_renewal_mode,
--     DROP CONSTRAINT IF EXISTS chk_advertisements_renewal_count,
--     DROP CONSTRAINT IF EXISTS chk_advertisements_maximum_weeks,
--     DROP CONSTRAINT IF EXISTS chk_advertisements_renewal_end_date,
--     DROP CONSTRAINT IF EXISTS chk_advertisements_auto_renew_bounded,
--     DROP CONSTRAINT IF EXISTS chk_advertisements_auto_renew_mode,
--     DROP CONSTRAINT IF EXISTS chk_advertisements_current_period_shape;
--
--   DROP INDEX IF EXISTS public.idx_advertisements_billing_due;
--   DROP INDEX IF EXISTS public.idx_advertisements_billing_status;
--
--   ALTER TABLE public.advertisements
--     DROP COLUMN IF EXISTS billing_model,
--     DROP COLUMN IF EXISTS billing_status,
--     DROP COLUMN IF EXISTS renewal_mode,
--     DROP COLUMN IF EXISTS auto_renew_enabled,
--     DROP COLUMN IF EXISTS maximum_weeks,
--     DROP COLUMN IF EXISTS renewal_end_date,
--     DROP COLUMN IF EXISTS current_period_starts_at,
--     DROP COLUMN IF EXISTS current_period_ends_at,
--     DROP COLUMN IF EXISTS next_renewal_at,
--     DROP COLUMN IF EXISTS renewal_count,
--     DROP COLUMN IF EXISTS manual_renewal_required;
--
-- Dropping the period table destroys the record of WHICH week each charge paid
-- for. The `mhc_action_charges` and `transactions` rows survive the DROP and
-- remain the authoritative financial history, so no financial record is lost —
-- but export the table first in any environment that has charged for a week.
--
-- `reviewed_by`, `reviewed_at` and `rejection_reason` are NOT dropped by this
-- rollback: they predate this migration (20260727100000) and this file only
-- starts writing them.
--
-- Both halves are idempotent and safe to run twice.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Prerequisites — fail loudly rather than half-creating a billing table
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.advertisements') IS NULL THEN
    RAISE EXCEPTION 'public.advertisements is missing; apply 20260409123000 first.';
  END IF;
  IF to_regclass('public.mhc_action_charges') IS NULL THEN
    RAISE EXCEPTION 'public.mhc_action_charges is missing; apply 20260729140000 first.';
  END IF;
  IF to_regclass('public.mhc_action_prices') IS NULL THEN
    RAISE EXCEPTION 'public.mhc_action_prices is missing; apply 20260728120000 first.';
  END IF;
  -- The exclusion constraint below needs gist support for a scalar column
  -- alongside a range. Already present since 20260309201500.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
    RAISE EXCEPTION 'btree_gist is missing; apply 20260309201500 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Campaign-level billing state
-- ---------------------------------------------------------------------------
-- Three questions were previously conflated into `advertisements.status`:
-- has an admin reviewed this?, may it be billed?, and is a paid week running?
-- `status` keeps the first (it is what moderation and the review queue read),
-- `billing_status` answers the second and third together, and the period table
-- is the record of the third.
--
-- The pairing is deliberately unambiguous:
--
--   status          billing_status      meaning
--   --------------  ------------------  ----------------------------------------
--   pending_review  pending_review      submitted, unreviewed, never charged
--   rejected        rejected            refused by an admin, never charged
--   scheduled       awaiting_start      approved, starts in the future, unpaid
--   scheduled       awaiting_credits    approved, but the charge found no credits
--   active          active              a paid seven-day week is running
--   expired         renewal_required    the paid week ended; manual renewal needed
--   cancelled       cancelled           cancelled; no further week may be bought
--   (any)           legacy              pre-weekly campaign, never billed by MHC
--
-- "approved but out of credits" and "not yet reviewed" are therefore different
-- rows in two different columns, which is the property the product decision
-- required.
ALTER TABLE public.advertisements
  ADD COLUMN IF NOT EXISTS billing_model            VARCHAR(20)   NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS billing_status           VARCHAR(32)   NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS renewal_mode             VARCHAR(20)   NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS auto_renew_enabled       BOOLEAN       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS maximum_weeks            INTEGER,
  ADD COLUMN IF NOT EXISTS renewal_end_date         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_period_starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_period_ends_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_renewal_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS renewal_count            INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manual_renewal_required  BOOLEAN       NOT NULL DEFAULT false;

COMMENT ON COLUMN public.advertisements.billing_model IS
  'legacy = campaign predates weekly billing and is NEVER charged or renewed by '
  'the weekly code paths. weekly = sold in seven-day MHC periods. Defaults to '
  'legacy so no existing or accidentally-inserted row is ever billed.';
COMMENT ON COLUMN public.advertisements.billing_status IS
  'Billing lifecycle, independent of moderation `status`. See the matrix in '
  '20260730120000_advertisement_weekly_billing.sql.';
COMMENT ON COLUMN public.advertisements.renewal_mode IS
  'manual = the advertiser buys each week deliberately. automatic is RESERVED '
  'for Wave 2F-B; no scheduler exists yet, so nothing sets it.';
COMMENT ON COLUMN public.advertisements.auto_renew_enabled IS
  'Reserved for Wave 2F-B. Cannot be true without maximum_weeks or '
  'renewal_end_date, and the API rejects enabling it (AUTO_RENEWAL_NOT_AVAILABLE) '
  'while no renewal scheduler exists.';
COMMENT ON COLUMN public.advertisements.maximum_weeks IS
  'Optional cap on how many seven-day periods this campaign may ever buy, '
  'counted as period_number. NULL = uncapped.';
COMMENT ON COLUMN public.advertisements.renewal_end_date IS
  'Optional wall-clock boundary: no period may end after this instant.';
COMMENT ON COLUMN public.advertisements.current_period_starts_at IS
  'Mirror of the currently active advertisement_campaign_periods row, so the '
  'serving query needs no join. The period table stays authoritative.';
COMMENT ON COLUMN public.advertisements.next_renewal_at IS
  'When the running week ends and a renewal becomes possible. Informational in '
  'this wave — nothing acts on it until the 2F-B scheduler exists.';
COMMENT ON COLUMN public.advertisements.manual_renewal_required IS
  'True once a paid week has expired and the advertiser must buy another for the '
  'campaign to serve again.';

-- Existing rows: the DEFAULTs above already made every one of them
-- `legacy`/`legacy`. This UPDATE exists for the case a column was added by an
-- earlier partial run without the default, and is a no-op otherwise.
UPDATE public.advertisements
SET billing_model = 'legacy'
WHERE billing_model IS DISTINCT FROM 'legacy';

UPDATE public.advertisements
SET billing_status = 'legacy'
WHERE billing_model = 'legacy'
  AND billing_status IS DISTINCT FROM 'legacy';

-- Constraints added AFTER the backfill so a legacy row can never fail them.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_advertisements_billing_model') THEN
    ALTER TABLE public.advertisements
      ADD CONSTRAINT chk_advertisements_billing_model
      CHECK (billing_model IN ('legacy', 'weekly'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_advertisements_billing_status') THEN
    ALTER TABLE public.advertisements
      ADD CONSTRAINT chk_advertisements_billing_status
      CHECK (billing_status IN (
        'legacy', 'pending_review', 'rejected', 'awaiting_start',
        'awaiting_credits', 'active', 'renewal_required', 'cancelled'
      ));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_advertisements_renewal_mode') THEN
    ALTER TABLE public.advertisements
      ADD CONSTRAINT chk_advertisements_renewal_mode
      CHECK (renewal_mode IN ('manual', 'automatic'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_advertisements_renewal_count') THEN
    ALTER TABLE public.advertisements
      ADD CONSTRAINT chk_advertisements_renewal_count
      CHECK (renewal_count >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_advertisements_maximum_weeks') THEN
    ALTER TABLE public.advertisements
      ADD CONSTRAINT chk_advertisements_maximum_weeks
      CHECK (maximum_weeks IS NULL OR (maximum_weeks >= 1 AND maximum_weeks <= 520));
  END IF;

  -- A renewal boundary in the past is a configuration mistake, not a campaign.
  -- Compared against created_at rather than now() so the constraint is
  -- deterministic and a valid row cannot silently become invalid with time.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_advertisements_renewal_end_date') THEN
    ALTER TABLE public.advertisements
      ADD CONSTRAINT chk_advertisements_renewal_end_date
      CHECK (renewal_end_date IS NULL OR renewal_end_date > created_at);
  END IF;

  -- Automatic renewal must be BOUNDED. An unbounded standing instruction to
  -- charge a wallet every week is exactly the shape a provider cannot audit.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_advertisements_auto_renew_bounded') THEN
    ALTER TABLE public.advertisements
      ADD CONSTRAINT chk_advertisements_auto_renew_bounded
      CHECK (
        auto_renew_enabled = false
        OR maximum_weeks IS NOT NULL
        OR renewal_end_date IS NOT NULL
      );
  END IF;

  -- ...and consistent with the declared mode, so no row claims to renew
  -- automatically while sitting in manual mode.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_advertisements_auto_renew_mode') THEN
    ALTER TABLE public.advertisements
      ADD CONSTRAINT chk_advertisements_auto_renew_mode
      CHECK (auto_renew_enabled = false OR renewal_mode = 'automatic');
  END IF;

  -- Half a period window is never meaningful.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_advertisements_current_period_shape') THEN
    ALTER TABLE public.advertisements
      ADD CONSTRAINT chk_advertisements_current_period_shape
      CHECK (
        (current_period_starts_at IS NULL) = (current_period_ends_at IS NULL)
        AND (current_period_ends_at IS NULL OR current_period_ends_at > current_period_starts_at)
      );
  END IF;
END $$;

-- Read paths the weekly billing code and the admin queue actually use.
-- Partial on `weekly`, because a legacy campaign is never a candidate for either.
CREATE INDEX IF NOT EXISTS idx_advertisements_billing_status
  ON public.advertisements (billing_status, created_at)
  WHERE billing_model = 'weekly';

-- "Which approved campaigns are due to start, and which running weeks are due
-- to end?" — the two queries the 2F-B scheduler will run, and the ones the
-- lazy expiry sweep runs today.
CREATE INDEX IF NOT EXISTS idx_advertisements_billing_due
  ON public.advertisements (billing_status, current_period_ends_at, starts_at)
  WHERE billing_model = 'weekly'
    AND billing_status IN ('awaiting_start', 'active');

-- ---------------------------------------------------------------------------
-- 2. The seven-day period
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.advertisement_campaign_periods (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- CASCADE, matching advertisements.advertiser_id: a period is a detail of the
  -- campaign, not an independent financial record. The financial record is the
  -- `mhc_action_charges` row, which is ON DELETE RESTRICT from `users` and
  -- survives an advertisement being deleted.
  advertisement_id       UUID          NOT NULL REFERENCES public.advertisements(id) ON DELETE CASCADE,
  -- 1 for the first week, then one per renewal. Also the maximum_weeks counter.
  period_number          INTEGER       NOT NULL CHECK (period_number >= 1),
  starts_at              TIMESTAMPTZ   NOT NULL,
  ends_at                TIMESTAMPTZ   NOT NULL,
  -- What the week ACTUALLY cost, frozen at charge time. An admin price change
  -- must never rewrite this; it is the only record of the agreed price for a
  -- zero-price week, which writes no charge row at all.
  mhc_price_snapshot     NUMERIC(14,2) NOT NULL CHECK (mhc_price_snapshot >= 0),
  -- The generic charge that paid for this week. NULL for a zero-price week,
  -- where nothing moved and the primitive deliberately writes no row.
  action_charge_id       UUID          REFERENCES public.mhc_action_charges(id) ON DELETE RESTRICT,
  status                 VARCHAR(20)   NOT NULL DEFAULT 'scheduled',
  renewal_source         VARCHAR(20)   NOT NULL,
  client_idempotency_key UUID,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT chk_ad_period_status
    CHECK (status IN ('scheduled', 'active', 'expired', 'cancelled', 'failed')),

  -- 'initial' and 'manual' are the only sources this wave writes. 'automatic'
  -- is reserved for 2F-B; 'legacy' exists so a historical campaign could be
  -- converted deliberately without inventing a value later.
  CONSTRAINT chk_ad_period_renewal_source
    CHECK (renewal_source IN ('initial', 'manual', 'automatic', 'legacy')),

  -- One period is EXACTLY seven times 24 hours. Written in hours, not days:
  -- `timestamptz + interval '7 days'` adds seven CALENDAR days in the session
  -- time zone, which is 167 or 169 hours across a DST boundary. Hour intervals
  -- are absolute, so this is the same duration everywhere on Earth.
  CONSTRAINT chk_ad_period_exact_week
    CHECK (ends_at = starts_at + interval '168 hours'),

  -- A charge exists only where a price was actually paid, and a paid week always
  -- points at its charge. Rules out both "charged but unlinked" and "linked but
  -- free", either of which would break reconciliation.
  CONSTRAINT chk_ad_period_charge_shape
    CHECK (
      (mhc_price_snapshot = 0 AND action_charge_id IS NULL)
      OR (mhc_price_snapshot > 0 AND action_charge_id IS NOT NULL)
    )
);

COMMENT ON TABLE public.advertisement_campaign_periods IS
  'One paid seven-day advertisement week. The unit of sale for weekly '
  'advertisement billing: its id is the reference the MHC charge is idempotent '
  'against, and its mhc_price_snapshot is the immutable record of what that week '
  'cost. NOT money — MHC is a platform credit.';
COMMENT ON COLUMN public.advertisement_campaign_periods.mhc_price_snapshot IS
  'MHC actually charged for this week, frozen at charge time. Admin price '
  'changes affect future periods only and never rewrite this value.';
COMMENT ON COLUMN public.advertisement_campaign_periods.action_charge_id IS
  'The mhc_action_charges row that paid for this week. NULL for a zero-price '
  'week, which moves no credits and writes no charge.';
COMMENT ON COLUMN public.advertisement_campaign_periods.renewal_source IS
  'How this week was bought: initial (first week, at approval or when a future '
  'start became due) or manual (advertiser renewed). automatic is reserved for '
  'Wave 2F-B and is never written by this wave.';
COMMENT ON COLUMN public.advertisement_campaign_periods.client_idempotency_key IS
  'Client-provided UUID (Idempotency-Key header) on a manual renewal. Scoped to '
  'the advertisement, so two advertisers cannot collide.';

-- ---------------------------------------------------------------------------
-- 3. Period uniqueness — enforced by the database, not by application logic
-- ---------------------------------------------------------------------------
-- The natural key. Ten concurrent renewals all compute the same next
-- period_number, so nine of them collide here even if every other guard failed.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_period_number
  ON public.advertisement_campaign_periods (advertisement_id, period_number);

-- "At most one week is running per campaign." Partial, so expired and cancelled
-- weeks accumulate as history without blocking the next one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_period_active
  ON public.advertisement_campaign_periods (advertisement_id)
  WHERE status = 'active';

-- One week per charge, and one charge per week. Together with
-- uq_mhc_action_charge_reference (which stops a second charge against the same
-- period id) this makes a double charge impossible from either direction.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_period_action_charge
  ON public.advertisement_campaign_periods (action_charge_id)
  WHERE action_charge_id IS NOT NULL;

-- Retried manual renewal reaches the week it already bought.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_period_idempotency
  ON public.advertisement_campaign_periods (advertisement_id, client_idempotency_key)
  WHERE client_idempotency_key IS NOT NULL;

-- Weeks may not overlap. `'[)'` bounds make consecutive weeks — [t, t+168h) then
-- [t+168h, t+336h) — adjacent rather than overlapping, which is exactly what a
-- renewal produces. Cancelled and failed weeks are excluded: a cancelled week
-- releases the window it no longer occupies, and a failed week never held one.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ad_period_no_overlap'
  ) THEN
    ALTER TABLE public.advertisement_campaign_periods
      ADD CONSTRAINT ad_period_no_overlap
      EXCLUDE USING gist (
        advertisement_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
      )
      WHERE (status IN ('scheduled', 'active', 'expired'));
  END IF;
END $$;

-- Read paths.
CREATE INDEX IF NOT EXISTS idx_ad_periods_advertisement
  ON public.advertisement_campaign_periods (advertisement_id, period_number DESC);

-- "Which running weeks have ended?" — the expiry sweep, and the 2F-B scheduler.
CREATE INDEX IF NOT EXISTS idx_ad_periods_due_expiry
  ON public.advertisement_campaign_periods (ends_at)
  WHERE status = 'active';

CREATE TRIGGER set_advertisement_campaign_periods_updated_at
  BEFORE UPDATE ON public.advertisement_campaign_periods
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Backend-only access posture
-- ---------------------------------------------------------------------------
-- Same lockdown as every financial-adjacent table since 20260610132000: the API
-- service role is the only reader, and no PostgREST client ever sees this.
DO $$
BEGIN
  IF to_regclass('public.advertisement_campaign_periods') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.advertisement_campaign_periods ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON TABLE public.advertisement_campaign_periods FROM anon, authenticated';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Re-label the advertisement action price as a WEEKLY price
-- ---------------------------------------------------------------------------
-- Same row, same key, same value — a different unit. `mhc_action_prices` has no
-- duration dimension, and it does not need one: the duration is fixed at one
-- week by chk_ad_period_exact_week, so "price per action" and "price per week"
-- are the same number. This is what resolves the first half of LC-01 (flat
-- per-campaign pricing) rather than working around it.
--
-- The value is NOT set here. It stays at whatever it already is; see the
-- assertion in section 6.
INSERT INTO public.mhc_action_prices (action_key, name, mhc_price, is_active)
VALUES ('advertisement', 'Advertisement week', 0, true)
ON CONFLICT (action_key) DO UPDATE
  SET name = 'Advertisement week',
      is_active = true,
      updated_at = now();

COMMENT ON COLUMN public.advertisements.amount_paid IS
  'LEGACY (EGP). Historic wallet-funded ad payments only. Weekly campaigns are '
  'charged in MHC per seven-day period; see advertisement_campaign_periods.';

-- ---------------------------------------------------------------------------
-- 6. Assert the end state
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  non_legacy INTEGER;
  ad_price   NUMERIC;
BEGIN
  -- Nothing may become weekly-billed by migration. Conversion is a deliberate
  -- act on a specific campaign, never a side effect of deploying this file.
  SELECT count(*) INTO non_legacy
  FROM public.advertisements
  WHERE billing_model <> 'legacy';
  IF non_legacy > 0 THEN
    RAISE EXCEPTION '% existing advertisement(s) became weekly-billed by migration; must be opt-in', non_legacy;
  END IF;

  -- No period may exist yet, so no existing campaign can have been charged
  -- retroactively for a week it already ran.
  IF EXISTS (SELECT 1 FROM public.advertisement_campaign_periods) THEN
    RAISE EXCEPTION 'advertisement_campaign_periods must start empty; a period is a purchase, not a backfill';
  END IF;

  -- Nothing may be auto-renewing while no renewal scheduler exists.
  IF EXISTS (SELECT 1 FROM public.advertisements WHERE auto_renew_enabled) THEN
    RAISE EXCEPTION 'auto_renew_enabled must be false everywhere until Wave 2F-B ships a renewal scheduler';
  END IF;

  -- LC-01 successor: the weekly price stays where the admin left it, and this
  -- migration is not the thing that turns advertising into a paid product.
  SELECT mhc_price INTO ad_price
  FROM public.mhc_action_prices
  WHERE action_key = 'advertisement';
  IF ad_price IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'advertisement weekly price is % — must stay 0 until Wave 2F-B is reviewed and merged', ad_price;
  END IF;
END $$;
