-- ---------------------------------------------------------------------------
-- Advertisement ownership, re-associated onto the Commercial Identity spine.
-- ---------------------------------------------------------------------------
-- Advertisements are user-owned today: `advertisements.advertiser_id` names a
-- login account that is simultaneously the financial actor. Wave 3 moves
-- ownership to the Commercial Identity that actually owns the asset
-- (09 §4.4, 00 §14.1, INV-141, scope fence H4) and requires the move to be
-- ADDITIVE: no advertisement is re-keyed, no primary key changes, and no
-- campaign, period, charge, moderation decision or renewal record is rewritten.
--
-- So this migration adds columns beside `advertiser_id` and leaves
-- `advertiser_id` exactly where it is, populated exactly as it was. The legacy
-- column stays the compatibility anchor for the whole of Wave 3, which is what
-- keeps every historical advertisement readable while the new ownership is
-- adopted.
--
-- WHAT IS AND IS NOT DECIDED HERE
--
--   * BUSINESS advertisements are re-associated. A legacy Business account has
--     exactly one authoritative initial BCI, persisted in
--     `business_commercial_identity_legacy_map` by 20260806090000, and that map
--     — not `owner_user_id`, not "the first identity this person controls" — is
--     the anchor every assignment is made through.
--
--   * PERSONAL provider advertisements (Expert, Craftsman) are NOT touched.
--     The Personal Commercial Identity does not exist yet. Inventing one here,
--     or quietly re-reading a personal provider as a Business, would be the
--     destructive re-keying 09 §4.4 forbids. They stay `legacy_user_owned` and
--     keep working through the legacy anchor until the PCI slice.
--
--   * Nothing about pricing, billing, renewal or moderation changes. The
--     advertisement action price stays where the admin left it, and this
--     migration reads no wallet, writes no period and creates no charge.
--
-- THE INTEGRITY MODEL, AND WHY IT IS A KEY RATHER THAN A CONVENTION
--
-- A weak `owner_type TEXT` / `owner_id UUID` pair would let an advertisement
-- name any identity at all: another Business's, a natively created second
-- identity of the same owner, or one that does not exist. Every one of those is
-- an asset-mixing failure, so none of them is expressible:
--
--   * `business_commercial_identity_id` is typed, and the composite foreign key
--     `(business_commercial_identity_id, advertiser_id)` targets the legacy map
--     itself. An assignment is therefore only accepted when the named identity
--     IS the authoritative initial BCI of the advertisement's own advertiser.
--     A cross-Business identity, a same-owner NATIVE identity (never mapped)
--     and an unknown identity are all rejected by the key, in the database,
--     without a trigger or an application check being involved.
--
--   * `commercial_owner_kind` is the typed discriminator the PCI slice widens.
--     Adding `personal` alongside `business` is an additive CHECK replacement
--     plus a second typed column — not another ownership rewrite.
--
--   * `commercial_ownership_state` carries the compatibility phase explicitly,
--     so "not migrated yet" and "migrated" are different readable facts rather
--     than an inference from a NULL.
--
-- ROLLBACK (forward-only migration; this is the documented reversal):
--   DROP TRIGGER IF EXISTS trg_advertisements_immutable_commercial_owner ON public.advertisements;
--   DROP FUNCTION IF EXISTS public.advertisements_reject_commercial_owner_change();
--   DROP INDEX IF EXISTS public.idx_advertisements_commercial_identity;
--   DROP INDEX IF EXISTS public.idx_advertisements_ownership_unresolved;
--   ALTER TABLE public.advertisements
--     DROP CONSTRAINT IF EXISTS fk_advertisements_business_identity_anchor,
--     DROP CONSTRAINT IF EXISTS chk_advertisements_commercial_owner_kind,
--     DROP CONSTRAINT IF EXISTS chk_advertisements_ownership_state_pairing,
--     DROP COLUMN IF EXISTS commercial_owner_kind,
--     DROP COLUMN IF EXISTS business_commercial_identity_id,
--     DROP COLUMN IF EXISTS commercial_ownership_state,
--     DROP COLUMN IF EXISTS commercial_ownership_assigned_at;
--   ALTER TABLE public.business_commercial_identity_legacy_map
--     DROP CONSTRAINT IF EXISTS uq_business_commercial_identity_legacy_map_anchor;
-- Reversing it removes the new ownership. It removes no advertisement, no
-- period, no charge and no moderation record, because it never wrote one.
-- ---------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 0. Preconditions. The spine has to be there before an asset can point at it.
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.business_commercial_identity_legacy_map') IS NULL THEN
    RAISE EXCEPTION
      'Advertisement ownership requires the BCI compatibility spine (20260806090000).'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END $$;

-- The anchor the advertisement foreign key targets. Logically implied by the
-- existing UNIQUE (bci_id) — this states it as a key a foreign key can name, so
-- "the advertisement's identity is its own advertiser's initial BCI" becomes
-- structural instead of a rule somebody has to remember.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'uq_business_commercial_identity_legacy_map_anchor'
       AND conrelid = 'public.business_commercial_identity_legacy_map'::regclass
  ) THEN
    ALTER TABLE public.business_commercial_identity_legacy_map
      ADD CONSTRAINT uq_business_commercial_identity_legacy_map_anchor
      UNIQUE (bci_id, business_account_id);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. The additive ownership columns.
-- ----------------------------------------------------------------------------

ALTER TABLE public.advertisements
  ADD COLUMN IF NOT EXISTS commercial_owner_kind            TEXT,
  ADD COLUMN IF NOT EXISTS business_commercial_identity_id  UUID,
  ADD COLUMN IF NOT EXISTS commercial_ownership_state       TEXT NOT NULL
                                                            DEFAULT 'legacy_user_owned',
  ADD COLUMN IF NOT EXISTS commercial_ownership_assigned_at TIMESTAMPTZ;

COMMENT ON COLUMN public.advertisements.advertiser_id IS
  'LEGACY owner — the login account that created the campaign. Preserved unchanged for the whole Wave 3 compatibility period: it is the anchor every unmigrated read still resolves through, and it remains the account weekly billing charges.';

COMMENT ON COLUMN public.advertisements.commercial_owner_kind IS
  'Typed discriminator for the canonical commercial owner. NULL = not migrated. business = owned by a Business Commercial Identity. The PCI slice widens this to personal; it is deliberately not a free-text polymorphic tag.';

COMMENT ON COLUMN public.advertisements.business_commercial_identity_id IS
  'The owning BCI, which a composite foreign key forces to be THE authoritative initial BCI of this advertisement''s own advertiser. A second, natively created identity of the same owner is not a legal value here.';

COMMENT ON COLUMN public.advertisements.commercial_ownership_state IS
  'Compatibility phase. legacy_user_owned = still resolved through advertiser_id (every personal provider, until the PCI slice). commercial_identity_owned = re-associated. quarantined_ambiguous = fenced by an operator; resolution fails closed rather than guessing.';

COMMENT ON COLUMN public.advertisements.commercial_ownership_assigned_at IS
  'When canonical ownership was recorded. Never a campaign, billing or moderation timestamp — those are untouched by this migration.';

-- ----------------------------------------------------------------------------
-- 2. Integrity. Every asset-mixing failure is made unrepresentable.
-- ----------------------------------------------------------------------------
-- Guarded individually so a re-run is a no-op: ALTER TABLE ... ADD CONSTRAINT
-- has no IF NOT EXISTS, and a migration that cannot be replayed is a migration
-- that cannot be retried after a partial failure.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_advertisements_commercial_owner_kind'
       AND conrelid = 'public.advertisements'::regclass
  ) THEN
    -- The discriminator and the typed reference agree, in both directions.
    -- Stated with explicit IS NULL tests because
    -- `(kind = 'business') = (id IS NOT NULL)` evaluates to NULL — and therefore
    -- PASSES — whenever the kind is NULL.
    ALTER TABLE public.advertisements
      ADD CONSTRAINT chk_advertisements_commercial_owner_kind CHECK (
        (commercial_owner_kind IS NULL AND business_commercial_identity_id IS NULL)
        OR (commercial_owner_kind = 'business' AND business_commercial_identity_id IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_advertisements_ownership_state_pairing'
       AND conrelid = 'public.advertisements'::regclass
  ) THEN
    -- The state is not decorative: it must agree with what the row actually
    -- holds, so a row cannot claim to be migrated without an owner, or hold an
    -- owner while claiming it is not.
    ALTER TABLE public.advertisements
      ADD CONSTRAINT chk_advertisements_ownership_state_pairing CHECK (
        (commercial_ownership_state = 'commercial_identity_owned'
          AND commercial_owner_kind IS NOT NULL
          AND commercial_ownership_assigned_at IS NOT NULL)
        OR (commercial_ownership_state IN ('legacy_user_owned', 'quarantined_ambiguous')
          AND commercial_owner_kind IS NULL
          AND commercial_ownership_assigned_at IS NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_advertisements_business_identity_anchor'
       AND conrelid = 'public.advertisements'::regclass
  ) THEN
    -- The whole no-asset-mixing guarantee, as one key.
    --
    -- The target is the legacy MAP, not the identity table. Targeting
    -- `business_commercial_identities (id, owner_user_id)` would only prove the
    -- identity belongs to the same person — which a natively created second
    -- identity also does. Targeting the map proves it is the ONE identity that
    -- this legacy Business's assets belong to.
    --
    -- MATCH SIMPLE (the default) is what lets an unmigrated row hold NULL and
    -- pass. ON DELETE NO ACTION rather than RESTRICT so that deleting a Business
    -- account still works: `advertiser_id` and the map row both cascade from
    -- `users`, and NO ACTION is checked once the statement has finished
    -- cascading. CASCADE is deliberately NOT used — removing a mapping row must
    -- never be able to delete somebody's advertisements.
    ALTER TABLE public.advertisements
      ADD CONSTRAINT fk_advertisements_business_identity_anchor
        FOREIGN KEY (business_commercial_identity_id, advertiser_id)
        REFERENCES public.business_commercial_identity_legacy_map (bci_id, business_account_id)
        ON UPDATE RESTRICT ON DELETE NO ACTION;
  END IF;
END $$;

-- Assignment happens once. Re-pointing an advertisement at a different identity
-- is a reassociation operation, and Wave 3 defines none — so it is refused here
-- rather than left to whoever writes the next UPDATE. Clearing an assignment is
-- refused for the same reason: it would silently return an asset to legacy
-- ownership. This mirrors the owner immutability the BCI spine already carries.
CREATE OR REPLACE FUNCTION public.advertisements_reject_commercial_owner_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.business_commercial_identity_id IS NOT NULL
     AND NEW.business_commercial_identity_id IS DISTINCT FROM OLD.business_commercial_identity_id
  THEN
    RAISE EXCEPTION
      'advertisements.business_commercial_identity_id is immutable once assigned; Wave 3 defines no advertisement reassociation'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_advertisements_immutable_commercial_owner ON public.advertisements;
CREATE TRIGGER trg_advertisements_immutable_commercial_owner
  BEFORE UPDATE OF business_commercial_identity_id ON public.advertisements
  FOR EACH ROW
  EXECUTE FUNCTION public.advertisements_reject_commercial_owner_change();

-- ----------------------------------------------------------------------------
-- 3. The historical record, fingerprinted BEFORE anything is written.
-- ----------------------------------------------------------------------------
-- Every legacy column of every advertisement, positionally (a composite ROW
-- rendering preserves NULLs as empty positions, so a value moving between two
-- columns still changes the fingerprint). Section 6 recomputes it and refuses to
-- commit if a single byte of advertisement history moved.
--
-- `updated_at` is included deliberately: `advertisements` carries no updated_at
-- trigger, so a changed value would mean something wrote a column this migration
-- must not write.

DROP TABLE IF EXISTS advertisement_ownership_precheck;
CREATE TEMP TABLE advertisement_ownership_precheck AS
SELECT count(*)::BIGINT                                                   AS total,
       coalesce(md5(string_agg(f.legacy::text, '|' ORDER BY f.id)), '-')  AS history
  FROM (
    SELECT a.id,
           ROW(a.advertiser_id, a.status, a.billing_model, a.billing_status,
               a.amount_paid, a.starts_at, a.expires_at, a.created_at, a.updated_at,
               a.reviewed_by, a.reviewed_at, a.rejection_reason, a.admin_status_reason,
               a.admin_price_override, a.admin_forced_starts_at, a.admin_forced_expires_at,
               a.renewal_mode, a.renewal_count, a.auto_renew_enabled,
               a.current_period_starts_at, a.current_period_ends_at, a.next_renewal_at,
               a.manual_renewal_required, a.destination_provider_id, a.destination_service_id,
               a.client_idempotency_key, a.impressions, a.clicks) AS legacy
      FROM public.advertisements a
  ) f;

-- ----------------------------------------------------------------------------
-- 4. Backfill. Business advertisements, through the authoritative map only.
-- ----------------------------------------------------------------------------
-- Driven entirely from `business_commercial_identity_legacy_map`. `users` is not
-- joined and `primary_role` is not re-derived: the map is the authoritative
-- record of which accounts are legacy Business principals and which identity
-- each one's assets belong to, and consulting a second source would be a second
-- answer.
--
-- Idempotent by predicate: `business_commercial_identity_id IS NULL` means a
-- second run updates nothing. Concurrency-safe because the UPDATE takes a row
-- lock per advertisement and the request path stamps the identical value through
-- the identical map lookup — a row written by either one is skipped by the other.
UPDATE public.advertisements a
   SET commercial_owner_kind            = 'business',
       business_commercial_identity_id  = m.bci_id,
       commercial_ownership_state       = 'commercial_identity_owned',
       commercial_ownership_assigned_at = now()
  FROM public.business_commercial_identity_legacy_map m
 WHERE m.business_account_id = a.advertiser_id
   AND a.business_commercial_identity_id IS NULL
   AND a.commercial_ownership_state = 'legacy_user_owned';

-- ----------------------------------------------------------------------------
-- 5. Indexes.
-- ----------------------------------------------------------------------------

-- "Everything this identity owns." Partial, because the unmigrated majority of
-- a pre-Wave-3 table has nothing to say about identity ownership.
CREATE INDEX IF NOT EXISTS idx_advertisements_commercial_identity
  ON public.advertisements (business_commercial_identity_id)
  WHERE business_commercial_identity_id IS NOT NULL;

-- "What has not been re-associated yet, and what has been fenced." The
-- reconciliation query for the PCI slice, and the operator's quarantine list.
CREATE INDEX IF NOT EXISTS idx_advertisements_ownership_unresolved
  ON public.advertisements (commercial_ownership_state, advertiser_id)
  WHERE commercial_ownership_state <> 'commercial_identity_owned';

-- ----------------------------------------------------------------------------
-- 6. Reconciliation. The backfill proves itself before it commits.
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  v_total            BIGINT;
  v_distinct_ids     BIGINT;
  v_before_total     BIGINT;
  v_before_history   TEXT;
  v_after_history    TEXT;
  v_business_ads     BIGINT;
  v_assigned         BIGINT;
  v_wrong_identity   BIGINT;
  v_owner_mismatch   BIGINT;
  v_native_identity  BIGINT;
  v_orphan_identity  BIGINT;
  v_personal_touched BIGINT;
  v_state_conflict   BIGINT;
BEGIN
  SELECT total, history INTO v_before_total, v_before_history
    FROM advertisement_ownership_precheck;

  SELECT count(*), count(DISTINCT id) INTO v_total, v_distinct_ids
    FROM public.advertisements;

  -- Nothing was created and nothing was removed.
  IF v_total <> v_before_total THEN
    RAISE EXCEPTION
      'Advertisement ownership reconciliation failed: % advertisement(s) before the backfill, % after.',
      v_before_total, v_total
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF v_total <> v_distinct_ids THEN
    RAISE EXCEPTION
      'Advertisement ownership reconciliation failed: % advertisement(s) but % distinct id(s).',
      v_total, v_distinct_ids
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- Every legacy column of every advertisement is byte-identical, which covers
  -- the primary keys, the billing history, the moderation record and the renewal
  -- state in one assertion.
  SELECT coalesce(md5(string_agg(f.legacy::text, '|' ORDER BY f.id)), '-') INTO v_after_history
    FROM (
      SELECT a.id,
             ROW(a.advertiser_id, a.status, a.billing_model, a.billing_status,
                 a.amount_paid, a.starts_at, a.expires_at, a.created_at, a.updated_at,
                 a.reviewed_by, a.reviewed_at, a.rejection_reason, a.admin_status_reason,
                 a.admin_price_override, a.admin_forced_starts_at, a.admin_forced_expires_at,
                 a.renewal_mode, a.renewal_count, a.auto_renew_enabled,
                 a.current_period_starts_at, a.current_period_ends_at, a.next_renewal_at,
                 a.manual_renewal_required, a.destination_provider_id, a.destination_service_id,
                 a.client_idempotency_key, a.impressions, a.clicks) AS legacy
        FROM public.advertisements a
    ) f;

  IF v_after_history IS DISTINCT FROM v_before_history THEN
    RAISE EXCEPTION
      'Advertisement ownership reconciliation failed: an existing advertisement column changed (% -> %).',
      v_before_history, v_after_history
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- The population that MUST be migrated: an advertisement whose advertiser is a
  -- legacy Business principal, defined by the authoritative map.
  SELECT count(*) INTO v_business_ads
    FROM public.advertisements a
    JOIN public.business_commercial_identity_legacy_map m
      ON m.business_account_id = a.advertiser_id;

  SELECT count(*) INTO v_assigned
    FROM public.advertisements
   WHERE commercial_ownership_state = 'commercial_identity_owned';

  IF v_business_ads <> v_assigned THEN
    RAISE EXCEPTION
      'Advertisement ownership reconciliation failed: % Business advertisement(s) but % assigned to a commercial identity.',
      v_business_ads, v_assigned
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- Every assigned advertisement points at ITS OWN advertiser's authoritative
  -- initial BCI. The composite foreign key already makes anything else
  -- unrepresentable; this restates the invariant so a future change that weakens
  -- the key fails here instead of in production.
  SELECT count(*) INTO v_wrong_identity
    FROM public.advertisements a
    LEFT JOIN public.business_commercial_identity_legacy_map m
           ON m.business_account_id = a.advertiser_id
   WHERE a.business_commercial_identity_id IS NOT NULL
     AND a.business_commercial_identity_id IS DISTINCT FROM m.bci_id;

  IF v_wrong_identity > 0 THEN
    RAISE EXCEPTION
      'Advertisement ownership reconciliation failed: % advertisement(s) do not point at their advertiser''s initial BCI.',
      v_wrong_identity
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- No advertisement points at another Business's identity.
  SELECT count(*) INTO v_owner_mismatch
    FROM public.advertisements a
    JOIN public.business_commercial_identities b
      ON b.id = a.business_commercial_identity_id
   WHERE b.owner_user_id IS DISTINCT FROM a.advertiser_id;

  IF v_owner_mismatch > 0 THEN
    RAISE EXCEPTION
      'Advertisement ownership reconciliation failed: % advertisement(s) point at an identity owned by a different account.',
      v_owner_mismatch
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- ...and none was captured by a same-owner NATIVE identity. One owner may
  -- control several BCIs; only the mapped one inherits that Business's legacy
  -- assets, and this is the assertion that says so out loud.
  SELECT count(*) INTO v_native_identity
    FROM public.advertisements a
    JOIN public.business_commercial_identities b
      ON b.id = a.business_commercial_identity_id
   WHERE b.origin <> 'legacy_business_account';

  IF v_native_identity > 0 THEN
    RAISE EXCEPTION
      'Advertisement ownership reconciliation failed: % advertisement(s) were assigned to a natively created identity.',
      v_native_identity
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  SELECT count(*) INTO v_orphan_identity
    FROM public.advertisements a
    LEFT JOIN public.business_commercial_identities b
           ON b.id = a.business_commercial_identity_id
   WHERE a.business_commercial_identity_id IS NOT NULL
     AND b.id IS NULL;

  IF v_orphan_identity > 0 THEN
    RAISE EXCEPTION
      'Advertisement ownership reconciliation failed: % advertisement(s) name a commercial identity that does not exist.',
      v_orphan_identity
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- Personal providers were not reinterpreted as Businesses. An advertisement
  -- whose advertiser has no legacy Business mapping must still be exactly where
  -- it started.
  SELECT count(*) INTO v_personal_touched
    FROM public.advertisements a
    LEFT JOIN public.business_commercial_identity_legacy_map m
           ON m.business_account_id = a.advertiser_id
   WHERE m.business_account_id IS NULL
     AND (a.commercial_ownership_state <> 'legacy_user_owned'
          OR a.commercial_owner_kind IS NOT NULL
          OR a.business_commercial_identity_id IS NOT NULL);

  IF v_personal_touched > 0 THEN
    RAISE EXCEPTION
      'Advertisement ownership reconciliation failed: % non-Business advertisement(s) were given commercial identity ownership.',
      v_personal_touched
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  SELECT count(*) INTO v_state_conflict
    FROM public.advertisements
   WHERE (commercial_ownership_state = 'commercial_identity_owned')
      <> (business_commercial_identity_id IS NOT NULL);

  IF v_state_conflict > 0 THEN
    RAISE EXCEPTION
      'Advertisement ownership reconciliation failed: % advertisement(s) carry a state their ownership columns contradict.',
      v_state_conflict
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RAISE NOTICE
    'Advertisement ownership: % advertisement(s) total, % re-associated to an initial BCI, legacy history unchanged (%).',
    v_total, v_assigned, v_after_history;
END $$;

DROP TABLE IF EXISTS advertisement_ownership_precheck;

-- ----------------------------------------------------------------------------
-- 7. Security posture.
-- ----------------------------------------------------------------------------
-- `advertisements` is a backend-only table reached exclusively through the API's
-- service role; it has never carried RLS or a browser-role grant, and this
-- migration issues neither a GRANT nor a policy. The new ownership columns
-- inherit that posture, so no browser role acquires a route to mutate ownership.
-- The one write path is the API, and the one legal transition — NULL to the
-- advertiser's own mapped identity — is the one the trigger above allows.
