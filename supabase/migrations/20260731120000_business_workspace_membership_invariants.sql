-- ============================================================================
-- MohandisHub — business workspace membership and invitation invariants
-- (Wave 2G-A / Wave 2H)
-- ----------------------------------------------------------------------------
-- The team tables have existed since 20260318000002 (`business_teams`,
-- `business_members`) and 20260613120000 (`business_team_roles`,
-- `business_team_invites`, `business_team_audit_log`). What they never had is a
-- single structural guarantee. Every rule that mattered — one workspace per
-- business, one owner, a role that belongs to the workspace it is assigned in,
-- an invitation that is used once, a token that is never legible — lived only in
-- whichever code path happened to run.
--
-- It is deliberately additive. No membership row is rewritten in a way that
-- loses information, no invitation is deleted, no role is dropped, and no column
-- is removed. Every value this migration writes is derived from a value the row
-- already carried.
--
--   0. PREFLIGHT. Three states cannot be repaired deterministically — a business
--      account with two workspaces, a workspace with two stored owners, and a
--      membership pointing at another workspace's role. Each is a decision about
--      which row is the real one, and a migration is the wrong place to guess.
--      The migration inspects them first and refuses to proceed rather than
--      failing halfway through with a constraint error that says nothing about
--      the data. The current production database holds none of the three.
--
--   1. ONE WORKSPACE PER BUSINESS ACCOUNT. `business_teams.business_id` had no
--      unique key, and first-access provisioning looked for a missing row before
--      inserting one. A missing row locks no gap at READ COMMITTED, so ten
--      concurrent first requests could commit ten workspaces, each with its own
--      owner, roles, invitations and audit history. The unique index makes that
--      impossible and gives the provisioning path an `ON CONFLICT` target to
--      make it idempotent instead.
--
--   2. EXACTLY ONE OWNER, at the only moment the claim can be true. A partial
--      unique index bounds owners from above; it says nothing about zero. The
--      lower bound needs to permit an ownerless INSTANT — a workspace is created
--      before its owner membership exists, and a role change is two statements —
--      while rejecting an ownerless COMMIT. That is exactly what a DEFERRABLE
--      INITIALLY DEFERRED constraint trigger expresses: the check runs once, at
--      commit, against the final state. Between them the two bound the count to
--      exactly one for every committed workspace, including against direct SQL.
--
--   3. A ROLE CANNOT CROSS WORKSPACES, and the tier column is derived rather
--      than supplied. `business_members.role` was written by hand at every call
--      site and had already drifted: the accept path hard-coded `'member'`
--      regardless of which role the invitation carried. A BEFORE trigger now
--      derives it from the assigned role, so the column the owner index depends
--      on is a function of `role_id`. Every custom role maps to the `member`
--      tier, which is what makes "a custom role cannot confer ownership"
--      structural instead of advisory. Existing rows are reconciled by the same
--      rule before the index is built, because a trigger only governs the future.
--
--   4. THE BILLING IDENTITY IS IMMUTABLE, and so is the primary role that keeps
--      it usable. `business_teams.business_id` is the account that owns this
--      workspace's services, jobs, advertisements, wallet and financial history.
--      Ownership transfer is not available (see the release note), and even when
--      it becomes available it will move a membership, never this column.
--      Separately, demoting that account away from the `business` primary role
--      would strand every asset keyed to it while the workspace still exists, so
--      the database refuses that too.
--
--   5. INVITATIONS. Backfills first, constraints second — the ordering the
--      earlier draft of this migration got wrong. The baseline revoke path wrote
--      `status = 'revoked'` at a time when no `revoked_at` column existed, so
--      validating "revoked implies a timestamp" against untouched history would
--      abort the migration on the first such row. `revoked_at` and `accepted_at`
--      are backfilled from the timestamps those rows already carry, and
--      duplicate pending invitations are retired oldest-first, before anything
--      is enforced.
--
--      `token_hash` then has to be 64 lowercase hex characters — the exact shape
--      of a SHA-256 digest. Raw tokens are issued as base64url, whose alphabet
--      this CHECK rejects, so "the plaintext token was written to the column" is
--      a failed INSERT rather than a review finding waiting to be missed.
--
--   6. THE ROLE A PERSON WAS ACTUALLY OFFERED. Deleting a custom role reassigns
--      its invitations to a replacement so the delete cannot be blocked forever
--      by history. That kept the workspace usable and lost the record of what
--      was offered. `role_name_snapshot` is written once, when the invitation is
--      created, and is never rewritten — so a revoked invitation to "Senior
--      Engineer" still reads as one after that role is gone.
--
--   7. THE LEGACY `viewer` SEED. Four built-in roles have been seeded into every
--      workspace since 20260613120000: owner, manager, member, viewer. The
--      product's built-in tiers are Owner, Admin (stored as `manager`) and
--      Member. `viewer` is none of them, and it holds no members anywhere. It is
--      classified rather than deleted: `is_legacy` marks it so the API stops
--      offering it and the UI stops presenting it as an approved tier, while any
--      row that ever pointed at it stays valid. New workspaces do not seed it.
--
-- What this migration deliberately does NOT do:
--
--   * it does not delete, merge or re-key a single membership, role, invitation
--     or audit row;
--   * it does not touch `business_teams.business_id` for any existing workspace;
--   * it does not drop the pre-existing UNIQUE(team_id, user_id) on
--     `business_members`. Removal stays a real DELETE, with the audit log and
--     the accepted invitation carrying the history, so a removed member can be
--     invited back without a soft-delete predicate to work around;
--   * it does not touch advertisements, MHC, plans, wallets, activation or any
--     financial table.
--
-- ----------------------------------------------------------------------------
-- ROLLBACK (idempotent; run in this order — triggers before their functions,
-- and every object here belongs to this migration alone):
--
--   DROP TRIGGER IF EXISTS trg_users_protect_workspace_owner_role ON public.users;
--   DROP TRIGGER IF EXISTS trg_business_teams_owner_present ON public.business_teams;
--   DROP TRIGGER IF EXISTS trg_business_members_owner_present ON public.business_members;
--   DROP TRIGGER IF EXISTS trg_business_teams_immutable_business
--     ON public.business_teams;
--   DROP TRIGGER IF EXISTS trg_business_members_resolve_tier
--     ON public.business_members;
--   DROP FUNCTION IF EXISTS public.users_protect_workspace_owner_role();
--   DROP FUNCTION IF EXISTS public.business_workspace_assert_one_owner();
--   DROP FUNCTION IF EXISTS public.business_teams_reject_business_id_change();
--   DROP FUNCTION IF EXISTS public.business_members_resolve_tier();
--
--   DROP INDEX IF EXISTS public.uq_business_teams_business_id;
--   DROP INDEX IF EXISTS public.uq_business_members_single_owner;
--   DROP INDEX IF EXISTS public.uq_business_team_invites_pending_email;
--   DROP INDEX IF EXISTS public.idx_business_team_invites_token_hash;
--
--   ALTER TABLE public.business_team_invites
--     DROP CONSTRAINT IF EXISTS chk_business_team_invites_token_hash_shape,
--     DROP CONSTRAINT IF EXISTS chk_business_team_invites_expiry_shape,
--     DROP CONSTRAINT IF EXISTS chk_business_team_invites_accepted_shape,
--     DROP CONSTRAINT IF EXISTS chk_business_team_invites_revoked_shape;
--
--   ALTER TABLE public.business_team_invites
--     DROP COLUMN IF EXISTS accepted_by,
--     DROP COLUMN IF EXISTS accepted_member_id,
--     DROP COLUMN IF EXISTS revoked_at,
--     DROP COLUMN IF EXISTS revoked_by,
--     DROP COLUMN IF EXISTS role_name_snapshot;
--
--   ALTER TABLE public.business_team_roles
--     DROP COLUMN IF EXISTS is_legacy;
--
--   COMMENT ON TABLE public.business_team_invites IS NULL;
--
-- Dropping `accepted_member_id` also removes its foreign key to
-- `business_members`, which is the only way to remove the column. The final
-- COMMENT restores the table's pre-migration state, which had none. No row in
-- any other table is touched by the reversal; the values backfilled into
-- `revoked_at`, `accepted_at` and `role_name_snapshot` disappear with their
-- columns, and `business_members.role` keeps whatever the reconciliation
-- computed — which is the value the row's own `role_id` already implied.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Preflight. Refuse loudly rather than guessing.
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  v_dupe_teams  BIGINT;
  v_dupe_owners BIGINT;
  v_cross_role  BIGINT;
BEGIN
  SELECT count(*) INTO v_dupe_teams FROM (
    SELECT business_id FROM public.business_teams
     GROUP BY business_id HAVING count(*) > 1
  ) d;
  IF v_dupe_teams > 0 THEN
    RAISE EXCEPTION
      'Refusing to migrate: % business account(s) own more than one workspace. Merge them deliberately before applying this migration.',
      v_dupe_teams
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  SELECT count(*) INTO v_dupe_owners FROM (
    SELECT team_id FROM public.business_members
     WHERE role = 'owner' GROUP BY team_id HAVING count(*) > 1
  ) d;
  IF v_dupe_owners > 0 THEN
    RAISE EXCEPTION
      'Refusing to migrate: % workspace(s) have more than one stored owner. Resolve which membership is the owner before applying this migration.',
      v_dupe_owners
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  SELECT count(*) INTO v_cross_role
    FROM public.business_members m
    JOIN public.business_team_roles r ON r.id = m.role_id
   WHERE r.team_id IS DISTINCT FROM m.team_id;
  IF v_cross_role > 0 THEN
    RAISE EXCEPTION
      'Refusing to migrate: % membership(s) reference a role from another workspace. Reassign them before applying this migration.',
      v_cross_role
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. Role classification and the offered-role snapshot.
-- ----------------------------------------------------------------------------

ALTER TABLE public.business_team_roles
  ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.business_team_roles.is_legacy IS
  'Built-in role kept for historical compatibility but no longer offered as an approved product tier (currently: viewer).';

-- The viewer seed, wherever it exists, becomes legacy. Nothing else is touched,
-- and a role that a workspace has since given members is still perfectly usable.
UPDATE public.business_team_roles
   SET is_legacy = true
 WHERE built_in = true
   AND role_key = 'viewer'
   AND is_legacy = false;

ALTER TABLE public.business_team_invites
  ADD COLUMN IF NOT EXISTS role_name_snapshot TEXT;

COMMENT ON COLUMN public.business_team_invites.role_name_snapshot IS
  'The role name as it read when the invitation was issued. Written once and never rewritten, so deleting a custom role cannot silently change what a historical invitation says was offered.';

-- Existing invitations get the name their role carries today. It is the best
-- available answer for history written before the column existed, and it is
-- exactly what the API was already displaying for those rows.
UPDATE public.business_team_invites i
   SET role_name_snapshot = r.name
  FROM public.business_team_roles r
 WHERE r.id = i.role_id
   AND i.role_name_snapshot IS NULL;

-- ----------------------------------------------------------------------------
-- 2. Membership tier: derived from the assigned role, and confined to the
--    workspace that role belongs to.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.business_members_resolve_tier()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_role_team UUID;
  v_role_key  TEXT;
  v_built_in  BOOLEAN;
BEGIN
  -- `role_id` is nullable because the pre-existing foreign key is ON DELETE SET
  -- NULL. A membership in that state keeps whatever tier it already had; the API
  -- treats it as the base member tier.
  IF NEW.role_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT team_id, role_key, built_in
    INTO v_role_team, v_role_key, v_built_in
    FROM public.business_team_roles
   WHERE id = NEW.role_id;

  IF v_role_team IS NULL THEN
    RAISE EXCEPTION 'business_members.role_id % does not exist', NEW.role_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_role_team IS DISTINCT FROM NEW.team_id THEN
    RAISE EXCEPTION
      'business_members.role_id % belongs to workspace %, not workspace %',
      NEW.role_id, v_role_team, NEW.team_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Built-in keys are the tier. Everything else — every custom role — is a
  -- member, which is what stops a custom role from ever conferring ownership.
  NEW.role := CASE
    WHEN v_built_in AND v_role_key IN ('owner', 'manager', 'member', 'viewer')
      THEN v_role_key
    ELSE 'member'
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_business_members_resolve_tier ON public.business_members;
CREATE TRIGGER trg_business_members_resolve_tier
  BEFORE INSERT OR UPDATE OF role_id, team_id, role ON public.business_members
  FOR EACH ROW
  EXECUTE FUNCTION public.business_members_resolve_tier();

-- Reconcile existing rows by the same rule, so the owner index below is built
-- over a column that already means what the trigger will keep it meaning. The
-- preflight has already established that no membership points at another
-- workspace's role, so this can only ever correct a tier, never move a member.
UPDATE public.business_members m
   SET role = CASE
     WHEN r.built_in AND r.role_key IN ('owner', 'manager', 'member', 'viewer')
       THEN r.role_key
     ELSE 'member'
   END
  FROM public.business_team_roles r
 WHERE r.id = m.role_id
   AND m.role IS DISTINCT FROM CASE
     WHEN r.built_in AND r.role_key IN ('owner', 'manager', 'member', 'viewer')
       THEN r.role_key
     ELSE 'member'
   END;

-- Constraint triggers protect future writes, but PostgreSQL does not run a new
-- constraint trigger against rows that already exist. Validate the reconciled
-- baseline explicitly so applying this migration can never commit a workspace
-- that starts out ownerless (or with ownership hidden by tier drift).
DO $$
DECLARE
  v_invalid_owner_count BIGINT;
BEGIN
  SELECT count(*) INTO v_invalid_owner_count
    FROM (
      SELECT t.id
        FROM public.business_teams t
        LEFT JOIN public.business_members m
          ON m.team_id = t.id
         AND m.role = 'owner'
       GROUP BY t.id
      HAVING count(m.id) <> 1
    ) invalid_workspaces;

  IF v_invalid_owner_count > 0 THEN
    RAISE EXCEPTION
      'Refusing to migrate: % workspace(s) do not have exactly one owner after membership-tier reconciliation. Repair ownership deliberately before applying this migration.',
      v_invalid_owner_count
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. One workspace per business account.
-- ----------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_teams_business_id
  ON public.business_teams (business_id);

COMMENT ON INDEX public.uq_business_teams_business_id IS
  'One workspace per business account. Also the ON CONFLICT target that makes first-access provisioning idempotent under concurrency.';

-- ----------------------------------------------------------------------------
-- 4. Exactly one owner per committed workspace.
-- ----------------------------------------------------------------------------

-- The upper bound: immediate, so a second owner cannot even be written.
CREATE UNIQUE INDEX IF NOT EXISTS uq_business_members_single_owner
  ON public.business_members (team_id)
  WHERE role = 'owner';

COMMENT ON INDEX public.uq_business_members_single_owner IS
  'At most one owner membership per workspace, checked immediately. The lower bound is the deferred constraint trigger below.';

-- The lower bound: deferred, so a transaction may pass through an ownerless
-- instant — creating a workspace before its owner exists, or moving the owner
-- membership in two statements — and is judged only on what it commits.
CREATE OR REPLACE FUNCTION public.business_workspace_assert_one_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_row     JSONB;
  v_team    UUID;
  v_owners  BIGINT;
BEGIN
  -- OLD and NEW are not both assigned, and which one carries the workspace
  -- differs per table, so the column name arrives as a trigger argument and the
  -- record is read as JSON rather than by field.
  IF TG_OP = 'DELETE' THEN
    v_row := to_jsonb(OLD);
  ELSE
    v_row := to_jsonb(NEW);
  END IF;

  v_team := (v_row ->> TG_ARGV[0])::uuid;
  IF v_team IS NULL THEN
    RETURN NULL;
  END IF;

  -- A workspace that no longer exists has no invariant left to satisfy. This is
  -- the ON DELETE CASCADE path: deleting a team, or the account that owns it,
  -- removes the memberships too, and none of that should be blocked.
  IF NOT EXISTS (SELECT 1 FROM public.business_teams WHERE id = v_team) THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO v_owners
    FROM public.business_members
   WHERE team_id = v_team AND role = 'owner';

  IF v_owners <> 1 THEN
    RAISE EXCEPTION
      'business workspace % must have exactly one owner at commit (found %)',
      v_team, v_owners
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_business_members_owner_present ON public.business_members;
CREATE CONSTRAINT TRIGGER trg_business_members_owner_present
  AFTER INSERT OR UPDATE OR DELETE ON public.business_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.business_workspace_assert_one_owner('team_id');

DROP TRIGGER IF EXISTS trg_business_teams_owner_present ON public.business_teams;
CREATE CONSTRAINT TRIGGER trg_business_teams_owner_present
  AFTER INSERT ON public.business_teams
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.business_workspace_assert_one_owner('id');

-- ----------------------------------------------------------------------------
-- 5. The workspace billing identity cannot move, and cannot be stranded.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.business_teams_reject_business_id_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.business_id IS DISTINCT FROM OLD.business_id THEN
    RAISE EXCEPTION
      'business_teams.business_id is immutable; a workspace cannot be moved to another account'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_business_teams_immutable_business ON public.business_teams;
CREATE TRIGGER trg_business_teams_immutable_business
  BEFORE UPDATE OF business_id ON public.business_teams
  FOR EACH ROW
  EXECUTE FUNCTION public.business_teams_reject_business_id_change();

-- Every service, job, advertisement, booking, subscription and ledger row of a
-- business workspace is keyed to the account in `business_teams.business_id`,
-- and reaching most of them still requires that account's `business` primary
-- role. Demoting it would leave the workspace standing and its assets
-- unreachable — a silent orphaning that no workspace role can undo. The account
-- can still be deactivated or deleted, which removes the workspace with it.
CREATE OR REPLACE FUNCTION public.users_protect_workspace_owner_role()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.primary_role IS DISTINCT FROM OLD.primary_role
     AND OLD.primary_role = 'business'
     AND EXISTS (SELECT 1 FROM public.business_teams WHERE business_id = NEW.id)
  THEN
    RAISE EXCEPTION
      'account % owns a business workspace and cannot leave the business primary role while it exists',
      NEW.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_protect_workspace_owner_role ON public.users;
CREATE TRIGGER trg_users_protect_workspace_owner_role
  BEFORE UPDATE OF primary_role ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.users_protect_workspace_owner_role();

-- ----------------------------------------------------------------------------
-- 6. Invitations — backfills first, then the constraints they satisfy.
-- ----------------------------------------------------------------------------

ALTER TABLE public.business_team_invites
  ADD COLUMN IF NOT EXISTS accepted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accepted_member_id UUID REFERENCES public.business_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.business_team_invites.accepted_member_id IS
  'The membership this invitation produced. ON DELETE SET NULL so removing a member keeps the invitation history rather than deleting it.';

-- The baseline revoke path was a single UPDATE setting status and `updated_at`,
-- at a time when `revoked_at` did not exist. Those rows are legitimate history
-- and the moment they were revoked is the moment they were last updated, so that
-- is what the backfill uses — falling back to `created_at` on the rows old
-- enough to predate a reliable `updated_at`.
UPDATE public.business_team_invites
   SET revoked_at = COALESCE(updated_at, created_at)
 WHERE status = 'revoked'
   AND revoked_at IS NULL;

-- The mirror image, for symmetry rather than because the baseline is known to
-- have produced it: the baseline accept path did set `accepted_at`.
UPDATE public.business_team_invites
   SET accepted_at = COALESCE(updated_at, created_at)
 WHERE status = 'accepted'
   AND accepted_at IS NULL;

-- A timestamp that belongs to a status the row does not have would fail the
-- checks below just as surely as a missing one.
UPDATE public.business_team_invites
   SET revoked_at = NULL
 WHERE status <> 'revoked' AND revoked_at IS NOT NULL;

UPDATE public.business_team_invites
   SET accepted_at = NULL
 WHERE status <> 'accepted' AND accepted_at IS NOT NULL;

-- The baseline permitted several pending invitations to the same address. The
-- newest is the one a recipient would have been sent last, so the older ones are
-- retired to `expired` rather than deleted: the rows, their tokens' digests and
-- their audit trail all survive, and only the claim that they are still live is
-- withdrawn.
UPDATE public.business_team_invites
   SET status = 'expired', updated_at = now()
 WHERE id IN (
   SELECT id FROM (
     SELECT id,
            row_number() OVER (
              PARTITION BY team_id, lower(btrim(email))
              ORDER BY created_at DESC, id DESC
            ) AS rn
       FROM public.business_team_invites
      WHERE status = 'pending'
   ) ranked
    WHERE rn > 1
 );

DO $$
BEGIN
  -- A SHA-256 digest, and nothing that could be read as a token. Raw tokens are
  -- issued as base64url, whose alphabet includes characters this rejects.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_business_team_invites_token_hash_shape'
       AND conrelid = 'public.business_team_invites'::regclass
  ) THEN
    ALTER TABLE public.business_team_invites
      ADD CONSTRAINT chk_business_team_invites_token_hash_shape
      CHECK (token_hash ~ '^[0-9a-f]{64}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_business_team_invites_expiry_shape'
       AND conrelid = 'public.business_team_invites'::regclass
  ) THEN
    ALTER TABLE public.business_team_invites
      ADD CONSTRAINT chk_business_team_invites_expiry_shape
      CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '30 days');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_business_team_invites_accepted_shape'
       AND conrelid = 'public.business_team_invites'::regclass
  ) THEN
    ALTER TABLE public.business_team_invites
      ADD CONSTRAINT chk_business_team_invites_accepted_shape
      CHECK ((status = 'accepted') = (accepted_at IS NOT NULL));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_business_team_invites_revoked_shape'
       AND conrelid = 'public.business_team_invites'::regclass
  ) THEN
    ALTER TABLE public.business_team_invites
      ADD CONSTRAINT chk_business_team_invites_revoked_shape
      CHECK ((status = 'revoked') = (revoked_at IS NOT NULL));
  END IF;
END $$;

-- One live invitation per address per workspace. The email is normalised the
-- same way the users table stores it, so a differently-cased re-invite collides
-- with the pending row rather than creating a second one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_business_team_invites_pending_email
  ON public.business_team_invites (team_id, lower(btrim(email)))
  WHERE status = 'pending';

-- Acceptance looks an invitation up by digest on every attempt, including the
-- ten that arrive at once. `token_hash` already carries a UNIQUE constraint and
-- therefore an index; this expression index exists only for the FOR UPDATE
-- lookup that also filters on status, and is cheap.
CREATE INDEX IF NOT EXISTS idx_business_team_invites_token_hash
  ON public.business_team_invites (token_hash, status);

COMMENT ON TABLE public.business_team_invites IS
  'Business workspace invitations. Only a SHA-256 digest of the token is ever stored; the raw token exists in the recipient''s email and nowhere else.';
