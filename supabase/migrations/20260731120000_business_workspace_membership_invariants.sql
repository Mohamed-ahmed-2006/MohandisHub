-- ============================================================================
-- MohandisHub — business workspace membership and invitation invariants
-- (Wave 2G / Wave 2H)
-- ----------------------------------------------------------------------------
-- The team tables have existed since 20260318000002 (`business_teams`,
-- `business_members`) and 20260613120000 (`business_team_roles`,
-- `business_team_invites`, `business_team_audit_log`). What they never had is a
-- single structural guarantee. Every rule that mattered — one owner, a role that
-- belongs to the workspace it is assigned in, an invitation that is used once,
-- a token that is never legible — lived only in whichever code path happened to
-- run. This migration moves those rules into the database, where a forgotten
-- branch, a concurrent request or a future refactor cannot step around them.
--
-- It is deliberately additive. No membership row is rewritten, no invitation is
-- deleted, no role is dropped, and no column is removed. The only data written
-- is a classification flag on the legacy `viewer` seed (see 6 below).
--
--   1. ONE OWNER PER WORKSPACE. A partial unique index on `team_id` where
--      `role = 'owner'` makes a second owner impossible to commit, no matter how
--      many transfers race. The lower bound (never zero owners) belongs to the
--      transfer transaction, which swaps both memberships under a workspace-row
--      lock — a database constraint cannot express "at least one" without a
--      deferred, whole-table check that would serialise unrelated writes.
--
--   2. A ROLE CANNOT CROSS WORKSPACES. `business_members.role_id` referenced
--      `business_team_roles(id)` with no requirement that the role belonged to
--      the same team. A composite foreign key would be the tidier expression of
--      that, but it needs a new unique key on (id, team_id) and a replacement of
--      the existing FK — a heavier change than the rule deserves. A BEFORE
--      trigger rejects the mismatch directly, with a check_violation SQLSTATE so
--      callers can classify it.
--
--   3. THE TIER COLUMN IS DERIVED, NEVER SUPPLIED. `business_members.role` was
--      written by hand at every call site and had already drifted: the accept
--      path hard-coded `'member'` regardless of which role the invitation
--      carried. The same trigger now derives it from the assigned role, so the
--      column that the one-owner index depends on is a function of `role_id`
--      rather than of whoever wrote the INSERT. Built-in keys map to themselves;
--      every custom role maps to the `member` tier, which is what makes
--      "a custom role can never confer ownership" structural instead of
--      advisory. Custom roles still carry their own permission array — a
--      narrower capability, granted server-side, is a separate axis from tier.
--
--   4. THE BILLING IDENTITY IS IMMUTABLE. `business_teams.business_id` is the
--      account that owns this workspace's services, jobs, advertisements, wallet
--      and financial history. Ownership transfer moves the workspace OWNER
--      MEMBERSHIP, never this column: rewriting it would silently orphan every
--      historical record keyed to the original account. A trigger refuses the
--      update so no future code path can make that mistake quietly.
--
--   5. INVITATIONS. Four separate holes, closed together:
--
--        * a raw token could be stored. `token_hash` now has to be 64 lowercase
--          hex characters — the exact shape of a SHA-256 digest. Raw tokens are
--          issued as base64url, which contains characters this CHECK rejects, so
--          "the plaintext token was written to the column" is not a review
--          finding waiting to be missed but a failed INSERT;
--        * unbounded or backwards expiry. `expires_at` must be after
--          `created_at` and no more than 30 days past it;
--        * duplicate pending invitations to the same address. A partial unique
--          index on (team_id, normalised email) where status = 'pending' makes
--          the second one fail. Invitation creation first retires any pending
--          invitation that has passed its expiry to `expired`, so a stale row
--          cannot permanently block a re-invite;
--        * acceptance with no record of who accepted, and a status that could
--          disagree with `accepted_at`. `accepted_by` / `accepted_member_id`
--          link the invitation to the membership it produced, `revoked_at` /
--          `revoked_by` do the same for revocation, and CHECKs tie each status
--          to the timestamp that must accompany it.
--
--      `status = 'expired'` is only ever written by the retirement step above.
--      Expiry as SEEN by preview and acceptance is computed from `expires_at`,
--      so a GET never mutates a row.
--
--   6. THE LEGACY `viewer` SEED. Four built-in roles have been seeded into every
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
--   DROP TRIGGER IF EXISTS trg_business_teams_immutable_business
--     ON public.business_teams;
--   DROP TRIGGER IF EXISTS trg_business_members_resolve_tier
--     ON public.business_members;
--   DROP FUNCTION IF EXISTS public.business_teams_reject_business_id_change();
--   DROP FUNCTION IF EXISTS public.business_members_resolve_tier();
--
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
--     DROP COLUMN IF EXISTS revoked_by;
--
--   ALTER TABLE public.business_team_roles
--     DROP COLUMN IF EXISTS is_legacy;
--
-- Dropping `accepted_member_id` also removes its foreign key to
-- `business_members`, which is the only way to remove the column. No row in any
-- other table is touched by the reversal.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Role classification.
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

-- ----------------------------------------------------------------------------
-- 3. Exactly one owner: the upper bound, enforced structurally.
-- ----------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_members_single_owner
  ON public.business_members (team_id)
  WHERE role = 'owner';

COMMENT ON INDEX public.uq_business_members_single_owner IS
  'At most one owner membership per workspace. The lower bound is held by the ownership-transfer transaction, which swaps both memberships under a business_teams row lock.';

-- ----------------------------------------------------------------------------
-- 4. The workspace billing identity cannot move.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.business_teams_reject_business_id_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.business_id IS DISTINCT FROM OLD.business_id THEN
    RAISE EXCEPTION
      'business_teams.business_id is immutable; transfer ownership by moving the owner membership'
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

-- ----------------------------------------------------------------------------
-- 5. Invitations.
-- ----------------------------------------------------------------------------

ALTER TABLE public.business_team_invites
  ADD COLUMN IF NOT EXISTS accepted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accepted_member_id UUID REFERENCES public.business_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.business_team_invites.accepted_member_id IS
  'The membership this invitation produced. ON DELETE SET NULL so removing a member keeps the invitation history rather than deleting it.';

-- A SHA-256 digest, and nothing that could be read as a token. Raw tokens are
-- issued as base64url, whose alphabet includes characters this rejects.
DO $$
BEGIN
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
