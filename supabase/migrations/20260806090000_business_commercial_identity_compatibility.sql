-- ============================================================================
-- MohandisHub — Business Commercial Identity (BCI) compatibility spine
-- (Wave 3, slice 1 — additive only)
-- ----------------------------------------------------------------------------
-- Wave 3 needs a commercial principal that the repository does not have. Today
-- `business_teams.business_id` and `business_profiles.user_id` both reference
-- `users.id`, and every commercial asset is keyed to that same account id. That
-- account is a legacy Business-account SURROGATE, not a Business Commercial
-- Identity: it is simultaneously a person's login, the financial actor and the
-- workspace owner, and it can only ever be one Business.
--
-- This migration introduces the BCI beside those structures. It rewrites
-- nothing. No existing table, column, index, trigger, policy or row is
-- modified, and no commercial asset changes owner. Legacy reads keep working
-- exactly as they did, which is the whole point of a compatibility slice.
--
--   1. THE IDENTITY. `business_commercial_identities` holds one authoritative
--      owner/controller column and nothing else that could compete with it.
--      Team membership is deliberately absent from this table and from every
--      constraint on it: `manage_team` administers a workspace, and a workspace
--      is not a commercial identity.
--
--   2. THE DETERMINISTIC ID. A legacy Business account's initial BCI id is a
--      pure function of the account id — RFC 4122 version 3, derived from a
--      fixed namespace string. Same input, same BCI, in every database, on
--      every run, forever. This is what makes the backfill idempotent without
--      an application-side "have I done this already?" query: the second insert
--      collides with the first on the PRIMARY KEY, and two concurrent inserts
--      resolve to one row for the same reason.
--
--   3. THE MAPPING. `business_commercial_identity_legacy_map` is the
--      authoritative compatibility anchor, and every rule the audit asked for
--      is a constraint rather than a convention:
--
--        * PRIMARY KEY (business_account_id) — one legacy Business principal
--          can hold at most one INITIAL BCI;
--        * UNIQUE (bci_id) — one initial BCI can belong to at most one legacy
--          Business principal, so two Businesses can never be combined;
--        * CHECK (bci_id = the deterministic id for this account) — the mapping
--          cannot point at some OTHER BCI. There is no arbitrary row to select,
--          which is what stops a repair, a retry or a race from picking one;
--        * FOREIGN KEY (bci_id, business_account_id) → (id, owner_user_id) —
--          the mapped identity's owner IS the mapped account, structurally.
--          "Owner mismatch" is not a state this schema can hold.
--
--      Between them, a second BCI for the same Business, a shared BCI across
--      two Businesses, an owner that disagrees with the mapping, and a mapping
--      to an arbitrary identity are all rejected by PostgreSQL rather than by
--      whichever code path happened to run.
--
--   4. FAIL CLOSED ON AMBIGUITY. Two legacy states cannot be resolved by
--      inference, so the migration refuses to proceed rather than guessing
--      which reading is the real one — the same posture 20260731120000 took.
--      The current production database holds neither.
--
--   5. RECONCILIATION. The backfill proves itself before it commits: counts
--      match, the mapping is one-to-one in both directions, no owner
--      disagrees, no initial BCI is orphaned, and no account carries two.
--
-- What this migration deliberately does NOT do:
--
--   * it does not make a BCI mandatory on services, jobs, advertisements,
--     plans, wallets, reservations, files or any other existing asset, and adds
--     no owner column to any of them — asset re-association is a later slice;
--   * it does not touch `business_teams`, `business_members`,
--     `business_team_roles`, `business_team_invites`, `business_team_audit_log`
--     or `business_profiles` — no ID is renumbered, no membership re-keyed, no
--     invitation or audit row rewritten;
--   * it does not grant any team member, role, permission or workspace
--     selection a commercial capability. Nothing here reads
--     `business_members`;
--   * it does not weaken or replace an RLS policy. The two new tables adopt the
--     backend-only posture every app table already has;
--   * it creates no PCI, engagement, offer, settlement, verification or
--     activation record, and no Wave 3 row of any other kind.
--
-- ----------------------------------------------------------------------------
-- ROLLBACK (idempotent; run in this order — the map depends on the identity
-- table, and both depend on the deterministic-id function):
--
--   DROP TRIGGER IF EXISTS trg_business_commercial_identities_immutable_owner
--     ON public.business_commercial_identities;
--   DROP FUNCTION IF EXISTS public.business_commercial_identities_reject_owner_change();
--
--   DROP TABLE IF EXISTS public.business_commercial_identity_legacy_map;
--   DROP TABLE IF EXISTS public.business_commercial_identities;
--
--   DROP FUNCTION IF EXISTS
--     public.business_commercial_identity_deterministic_id(UUID);
--
-- Reversal is total and loses nothing that existed before this migration: both
-- tables are new, every row in them is derived from `users`, and no row outside
-- them was written. Re-applying afterwards reproduces the identical BCI ids,
-- because they are a function of data the reversal did not touch.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. The deterministic identifier.
-- ----------------------------------------------------------------------------

-- `md5()` is core PostgreSQL. pgcrypto's `digest()` would be the more obvious
-- choice, but the extension is not guaranteed to sit on the search_path of
-- every deployment this schema is replayed into, and a migration is a bad place
-- to discover that. MD5 is used here as a name-based derivation over a primary
-- key this database already holds — not as a security primitive.
--
-- The result is shaped as a proper RFC 4122 version-3 UUID, variant 10xx, so it
-- satisfies the UUID validators that already exist in the request path rather
-- than merely satisfying PostgreSQL's parser.
CREATE OR REPLACE FUNCTION public.business_commercial_identity_deterministic_id(
  p_business_account_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  -- Fixed for the lifetime of the product. Changing this string would give
  -- every existing Business a different initial BCI, which is exactly the
  -- non-determinism the compatibility spine exists to prevent.
  c_namespace CONSTANT TEXT :=
    'mohandishub:wave3:business-commercial-identity:initial:';
  v_hex TEXT;
BEGIN
  v_hex := md5(c_namespace || p_business_account_id::text);
  -- Character 13 of the undashed form is the version nibble → 3 (name-based,
  -- MD5). Character 17 is the variant nibble → 10xx, i.e. one of 8, 9, a, b.
  -- The variant is rewritten by table lookup rather than by bit arithmetic:
  -- the mapping keeps the low two bits and forces the high two, and reads as
  -- what it is without depending on a text→bit cast.
  v_hex := overlay(v_hex PLACING '3' FROM 13 FOR 1);
  v_hex := overlay(
    v_hex
    PLACING substr('89ab89ab89ab89ab', position(substr(v_hex, 17, 1) IN '0123456789abcdef'), 1)
    FROM 17 FOR 1
  );
  RETURN v_hex::uuid;
END;
$$;

COMMENT ON FUNCTION public.business_commercial_identity_deterministic_id(UUID) IS
  'The initial Business Commercial Identity id for a legacy Business account. A pure function of the account id, so the compatibility backfill is reproducible, retry-safe and race-safe without an application-side existence check.';

-- ----------------------------------------------------------------------------
-- 1. Preflight. Refuse loudly rather than guessing.
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  v_alien_workspace  BIGINT;
  v_dupe_workspace   BIGINT;
BEGIN
  -- A workspace whose billing identity is not a Business account. Migration
  -- 20260731120000 made this state unreachable going forward (a business
  -- account that owns a workspace cannot leave the `business` primary role),
  -- but it never validated the rows that already existed. Such a row is
  -- genuinely ambiguous: the workspace, its roles, its invitations and its
  -- asset keying all say "a Business operates here", and the account says it is
  -- not one. Minting a BCI would create a commercial identity for an account
  -- the product does not classify as a Business; skipping it would leave an
  -- operating workspace outside the spine. Neither is inferable, so neither is
  -- chosen.
  SELECT count(*) INTO v_alien_workspace
    FROM public.business_teams t
    JOIN public.users u ON u.id = t.business_id
   WHERE u.primary_role IS DISTINCT FROM 'business';

  IF v_alien_workspace > 0 THEN
    RAISE EXCEPTION
      'Refusing to migrate: % business workspace(s) are owned by an account whose primary role is not "business". Restore the account role, or retire the workspace, before applying this migration.',
      v_alien_workspace
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- Defence in depth. `uq_business_teams_business_id` already forbids this;
  -- asserting it here means the one-workspace-per-account premise the mapping
  -- rests on is checked rather than assumed.
  SELECT count(*) INTO v_dupe_workspace FROM (
    SELECT business_id FROM public.business_teams
     GROUP BY business_id HAVING count(*) > 1
  ) d;

  IF v_dupe_workspace > 0 THEN
    RAISE EXCEPTION
      'Refusing to migrate: % business account(s) own more than one workspace. Resolve which workspace is the real one before applying this migration.',
      v_dupe_workspace
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. The identity.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.business_commercial_identities (
  id             UUID PRIMARY KEY,
  -- The single authoritative controller. There is deliberately no second
  -- ownership source — no controller table, no membership join, no workspace
  -- column — because a second source is a second answer, and commercial
  -- authority has to have exactly one.
  owner_user_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'suspended', 'archived')),
  -- How this identity came to exist. `legacy_business_account` is the initial
  -- BCI minted for a pre-Wave-3 Business account; `native` is anything created
  -- afterwards. The two populations stay permanently distinguishable.
  origin         TEXT NOT NULL
                   CHECK (origin IN ('legacy_business_account', 'native')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- An identity that claims legacy origin must carry the deterministic id for
  -- the account it belongs to. A natively created BCI therefore cannot be
  -- passed off as somebody's initial legacy identity, and a legacy identity
  -- cannot be minted under an id nothing can reproduce.
  CONSTRAINT chk_business_commercial_identities_legacy_id_deterministic
    CHECK (
      origin <> 'legacy_business_account'
      OR id = public.business_commercial_identity_deterministic_id(owner_user_id)
    ),

  -- The target of the mapping's composite foreign key below. Redundant as a
  -- uniqueness claim (`id` is already the primary key); its job is to make
  -- "the mapped identity's owner is the mapped account" expressible as a
  -- foreign key instead of a trigger.
  CONSTRAINT uq_business_commercial_identities_id_owner UNIQUE (id, owner_user_id)
);

COMMENT ON TABLE public.business_commercial_identities IS
  'Business Commercial Identity — the Wave 3 organizational commercial principal. Additive: the legacy Business account it maps from remains the compatibility anchor and keeps owning every existing asset.';

COMMENT ON COLUMN public.business_commercial_identities.owner_user_id IS
  'The canonical controlling account. The only source of commercial authority for this identity in Wave 3; business_members is never consulted.';

COMMENT ON COLUMN public.business_commercial_identities.origin IS
  'legacy_business_account = the deterministic initial identity minted by the Wave 3 compatibility backfill. native = created afterwards.';

CREATE INDEX IF NOT EXISTS idx_business_commercial_identities_owner
  ON public.business_commercial_identities (owner_user_id);

-- One owner may control several BCIs (that is the point of the model), so the
-- owner column is deliberately NOT unique. What must not move is which account
-- controls an identity: ownership transfer is an administrative process with
-- full re-verification, never an UPDATE. This mirrors the immutability already
-- enforced on `business_teams.business_id`.
CREATE OR REPLACE FUNCTION public.business_commercial_identities_reject_owner_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
    RAISE EXCEPTION
      'business_commercial_identities.owner_user_id is immutable; ownership transfer is not a self-serve operation'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_business_commercial_identities_immutable_owner
  ON public.business_commercial_identities;
CREATE TRIGGER trg_business_commercial_identities_immutable_owner
  BEFORE UPDATE OF owner_user_id ON public.business_commercial_identities
  FOR EACH ROW
  EXECUTE FUNCTION public.business_commercial_identities_reject_owner_change();

-- ----------------------------------------------------------------------------
-- 3. The legacy compatibility mapping.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.business_commercial_identity_legacy_map (
  -- One legacy Business principal, one initial BCI. The primary key is the
  -- whole guarantee, and it is also the ON CONFLICT target that makes the
  -- backfill converge under retry and under concurrency.
  business_account_id  UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  bci_id               UUID NOT NULL,
  -- Whether this row was written by the compatibility migration or by a later
  -- runtime path. Internal provenance: never projected through an API.
  created_by_migration BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One initial BCI belongs to one legacy Business principal. Without this,
  -- two Businesses could be silently pointed at the same commercial identity.
  CONSTRAINT uq_business_commercial_identity_legacy_map_bci UNIQUE (bci_id),

  -- The mapping is not free to choose. It must be THE deterministic identity
  -- for this account, which is what removes "pick a row" from every repair,
  -- retry and race.
  CONSTRAINT chk_business_commercial_identity_legacy_map_deterministic
    CHECK (bci_id = public.business_commercial_identity_deterministic_id(business_account_id)),

  -- ...and that identity's owner is this account. Structural, so an owner
  -- mismatch is not a state the database can hold.
  CONSTRAINT fk_business_commercial_identity_legacy_map_identity
    FOREIGN KEY (bci_id, business_account_id)
    REFERENCES public.business_commercial_identities (id, owner_user_id)
    ON DELETE CASCADE
);

COMMENT ON TABLE public.business_commercial_identity_legacy_map IS
  'Authoritative legacy Business account → initial BCI mapping. One row per legacy Business principal, forever; later BCIs the same owner controls are never mapped here.';

COMMENT ON COLUMN public.business_commercial_identity_legacy_map.created_by_migration IS
  'Provenance for audit. Internal only — never exposed through an API response.';

-- ----------------------------------------------------------------------------
-- 4. Deterministic backfill.
-- ----------------------------------------------------------------------------

-- Every account the product classifies as a Business receives exactly one
-- initial BCI. Deactivated accounts are included deliberately: a BCI is a
-- commercial identity with its own lifecycle column, `users.is_active` is a
-- login fact, and conflating them would leave a reactivated Business without
-- the identity its assets are meant to hang off. The deterministic id means
-- minting it now and minting it later produce the same row either way.
INSERT INTO public.business_commercial_identities (id, owner_user_id, status, origin)
SELECT public.business_commercial_identity_deterministic_id(u.id),
       u.id,
       'active',
       'legacy_business_account'
  FROM public.users u
 WHERE u.primary_role = 'business'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.business_commercial_identity_legacy_map
  (business_account_id, bci_id, created_by_migration)
SELECT u.id,
       public.business_commercial_identity_deterministic_id(u.id),
       true
  FROM public.users u
 WHERE u.primary_role = 'business'
ON CONFLICT (business_account_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 5. Reconciliation. The backfill proves itself before it commits.
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  v_legacy_accounts BIGINT;
  v_initial_bcis    BIGINT;
  v_mappings        BIGINT;
  v_unmapped        BIGINT;
  v_orphan_bci      BIGINT;
  v_owner_mismatch  BIGINT;
  v_non_determin    BIGINT;
  v_multi_bci       BIGINT;
  v_shared_bci      BIGINT;
BEGIN
  SELECT count(*) INTO v_legacy_accounts
    FROM public.users WHERE primary_role = 'business';

  SELECT count(*) INTO v_initial_bcis
    FROM public.business_commercial_identities
   WHERE origin = 'legacy_business_account';

  SELECT count(*) INTO v_mappings
    FROM public.business_commercial_identity_legacy_map;

  IF v_legacy_accounts <> v_mappings THEN
    RAISE EXCEPTION
      'BCI reconciliation failed: % legacy Business account(s) but % mapping(s).',
      v_legacy_accounts, v_mappings
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF v_legacy_accounts <> v_initial_bcis THEN
    RAISE EXCEPTION
      'BCI reconciliation failed: % legacy Business account(s) but % initial BCI(s).',
      v_legacy_accounts, v_initial_bcis
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- No valid legacy Business is left without an identity.
  SELECT count(*) INTO v_unmapped
    FROM public.users u
    LEFT JOIN public.business_commercial_identity_legacy_map m
           ON m.business_account_id = u.id
   WHERE u.primary_role = 'business'
     AND m.business_account_id IS NULL;

  IF v_unmapped > 0 THEN
    RAISE EXCEPTION
      'BCI reconciliation failed: % legacy Business account(s) have no initial BCI.',
      v_unmapped
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- ...and no initial identity is left without the Business it was minted for.
  SELECT count(*) INTO v_orphan_bci
    FROM public.business_commercial_identities b
    LEFT JOIN public.business_commercial_identity_legacy_map m ON m.bci_id = b.id
   WHERE b.origin = 'legacy_business_account'
     AND m.bci_id IS NULL;

  IF v_orphan_bci > 0 THEN
    RAISE EXCEPTION
      'BCI reconciliation failed: % initial BCI(s) map to no legacy Business account.',
      v_orphan_bci
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- The composite foreign key already makes this unreachable. Asserting it
  -- states the invariant in the migration that depends on it, so a future
  -- change that weakens the key fails here rather than in production.
  SELECT count(*) INTO v_owner_mismatch
    FROM public.business_commercial_identity_legacy_map m
    JOIN public.business_commercial_identities b ON b.id = m.bci_id
   WHERE b.owner_user_id IS DISTINCT FROM m.business_account_id;

  IF v_owner_mismatch > 0 THEN
    RAISE EXCEPTION
      'BCI reconciliation failed: % mapping(s) name an owner the identity does not have.',
      v_owner_mismatch
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  SELECT count(*) INTO v_non_determin
    FROM public.business_commercial_identity_legacy_map m
   WHERE m.bci_id
         IS DISTINCT FROM public.business_commercial_identity_deterministic_id(m.business_account_id);

  IF v_non_determin > 0 THEN
    RAISE EXCEPTION
      'BCI reconciliation failed: % mapping(s) do not hold the deterministic identity for their account.',
      v_non_determin
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- Duplicates, from both directions. Both are held down by keys; both are
  -- asserted because "no Business has two initial BCIs" and "no initial BCI is
  -- shared by two Businesses" are the two claims this whole slice makes.
  SELECT count(*) INTO v_multi_bci FROM (
    SELECT business_account_id
      FROM public.business_commercial_identity_legacy_map
     GROUP BY business_account_id HAVING count(*) > 1
  ) d;

  IF v_multi_bci > 0 THEN
    RAISE EXCEPTION
      'BCI reconciliation failed: % Business account(s) carry more than one initial BCI.',
      v_multi_bci
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  SELECT count(*) INTO v_shared_bci FROM (
    SELECT bci_id
      FROM public.business_commercial_identity_legacy_map
     GROUP BY bci_id HAVING count(*) > 1
  ) d;

  IF v_shared_bci > 0 THEN
    RAISE EXCEPTION
      'BCI reconciliation failed: % initial BCI(s) are mapped to more than one Business account.',
      v_shared_bci
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RAISE NOTICE
    'BCI compatibility: % legacy Business account(s) reconciled to % initial BCI(s), one to one.',
    v_legacy_accounts, v_initial_bcis;
END $$;

-- ----------------------------------------------------------------------------
-- 6. The backend-only posture every app table already carries.
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  table_name TEXT;
  new_tables TEXT[] := ARRAY[
    'business_commercial_identities',
    'business_commercial_identity_legacy_map'
  ];
BEGIN
  FOREACH table_name IN ARRAY new_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', table_name);
  END LOOP;
END $$;
