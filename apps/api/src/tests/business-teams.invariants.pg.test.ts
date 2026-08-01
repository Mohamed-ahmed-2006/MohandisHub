import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  countRows,
  createScratchDatabase,
  pgIntegrationEnabled,
  readMigration,
  type ScratchDatabase,
} from './support/pg-scratch.js';

// ---------------------------------------------------------------------------
// The invariants the final review found missing, against a REAL PostgreSQL.
// ---------------------------------------------------------------------------
// Five claims, none of which can be demonstrated against a mocked pool because
// each is a property of what the database itself refuses:
//
//   * one workspace per business account, including when ten first requests
//     arrive together — the race that could split one business into ten teams;
//   * exactly one owner per COMMITTED workspace, which needs a lower bound the
//     partial unique index cannot express and direct SQL cannot evade;
//   * a migration that survives legitimate baseline history — revoked
//     invitations written before `revoked_at` existed, and duplicate pending
//     invitations the baseline permitted;
//   * an account that owns a workspace cannot be demoted out of the role that
//     keeps the workspace's assets reachable;
//   * an audit row that fails takes its mutation down with it.
//
// Opt-in:  RUN_PG_INTEGRATION=1 npm run test -w @mohandishub/api
// ---------------------------------------------------------------------------

let scratch: ScratchDatabase;
let pool: Pool;

vi.mock('../db/pool.js', () => ({
  getPool: () => pool,
  hasDatabaseConfig: () => true,
}));

const mail = vi.hoisted(() => ({ links: [] as string[] }));
vi.mock('../utils/send-transactional-email.js', () => ({
  sendTransactionalEmail: (message: { action?: { kind: string; url?: string } }) => {
    if (message.action?.kind === 'button' && message.action.url)
      mail.links.push(message.action.url);
    return Promise.resolve();
  },
}));

vi.setConfig({ testTimeout: 180_000, hookTimeout: 1_800_000 });

const service = async () => import('../modules/business-teams/business-teams.service.js');

/** The migration under test, applied from its own file rather than a copy. */
const MIGRATION_FILE = '20260731120000_business_workspace_membership_invariants.sql';

/**
 * The reversal documented in that migration's header.
 *
 * Used here to build a pre-migration baseline out of a fully migrated scratch
 * copy; the workspace suite asserts it is exact.
 */
const ROLLBACK_SQL = `
DROP TRIGGER IF EXISTS trg_users_protect_workspace_owner_role ON public.users;
DROP TRIGGER IF EXISTS trg_business_teams_owner_present ON public.business_teams;
DROP TRIGGER IF EXISTS trg_business_members_owner_present ON public.business_members;
DROP TRIGGER IF EXISTS trg_business_teams_immutable_business ON public.business_teams;
DROP TRIGGER IF EXISTS trg_business_members_resolve_tier ON public.business_members;
DROP FUNCTION IF EXISTS public.users_protect_workspace_owner_role();
DROP FUNCTION IF EXISTS public.business_workspace_assert_one_owner();
DROP FUNCTION IF EXISTS public.business_teams_reject_business_id_change();
DROP FUNCTION IF EXISTS public.business_members_resolve_tier();

DROP INDEX IF EXISTS public.uq_business_teams_business_id;
DROP INDEX IF EXISTS public.uq_business_members_single_owner;
DROP INDEX IF EXISTS public.uq_business_team_invites_pending_email;
DROP INDEX IF EXISTS public.idx_business_team_invites_token_hash;

ALTER TABLE public.business_team_invites
  DROP CONSTRAINT IF EXISTS chk_business_team_invites_token_hash_shape,
  DROP CONSTRAINT IF EXISTS chk_business_team_invites_expiry_shape,
  DROP CONSTRAINT IF EXISTS chk_business_team_invites_accepted_shape,
  DROP CONSTRAINT IF EXISTS chk_business_team_invites_revoked_shape;

ALTER TABLE public.business_team_invites
  DROP COLUMN IF EXISTS accepted_by,
  DROP COLUMN IF EXISTS accepted_member_id,
  DROP COLUMN IF EXISTS revoked_at,
  DROP COLUMN IF EXISTS revoked_by,
  DROP COLUMN IF EXISTS role_name_snapshot;

ALTER TABLE public.business_team_roles
  DROP COLUMN IF EXISTS is_legacy;

COMMENT ON TABLE public.business_team_invites IS NULL;
`;

let seq = 0;

const seedUser = async (
  params: { role?: string; email?: string } = {},
): Promise<{ userId: string; email: string }> => {
  seq += 1;
  const email = params.email ?? `inv${seq}-${Date.now().toString(36)}@test.local`;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, display_name, primary_role, email_verified_at)
     VALUES ($1, 'x', $2, $3, now())
     RETURNING id`,
    [email.toLowerCase(), `User ${seq}`, params.role ?? 'customer'],
  );
  return { userId: rows[0]!.id, email };
};

const teamCountFor = (businessId: string) =>
  countRows(pool, `SELECT count(*)::text c FROM business_teams WHERE business_id = $1`, [
    businessId,
  ]);

const ownerCount = (teamId: string) =>
  countRows(
    pool,
    `SELECT count(*)::text c FROM business_members WHERE team_id = $1 AND role = 'owner'`,
    [teamId],
  );

beforeAll(async () => {
  if (!pgIntegrationEnabled()) return;
  scratch = await createScratchDatabase('bizinv');
  pool = scratch.pool;
}, 1_800_000);

afterAll(async () => {
  if (scratch) await scratch.drop();
}, 300_000);

beforeEach(async () => {
  if (!pgIntegrationEnabled()) return;
  // Teams take everything with them by cascade. Deleting memberships first
  // would strip a live workspace of its owner, which the deferred one-owner
  // trigger correctly refuses — the teardown has to remove the workspace rather
  // than hollow it out. Invitations go first because their `role_id` foreign key
  // is ON DELETE RESTRICT.
  await pool.query(`DELETE FROM business_team_audit_log`);
  await pool.query(`DELETE FROM business_team_invites`);
  await pool.query(`DELETE FROM business_teams`);
});

// ===========================================================================
// One workspace per business account.
// ===========================================================================

describe.skipIf(!pgIntegrationEnabled())('workspace initialization', () => {
  it('creates ONE workspace when ten first-access requests arrive together', async () => {
    const business = await seedUser({ role: 'business' });
    const svc = await service();

    // The exact shape of the race the review found: ten concurrent
    // `GET /api/business-teams/me` for an account that has never opened the
    // team screen. Every one of them used to observe no row and insert.
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        svc.resolveContext({ id: business.userId, role: 'business' }),
      ),
    );

    expect(await teamCountFor(business.userId)).toBe(1);
    const teamId = results[0]!.teamId;
    // All ten callers succeeded, and all ten are looking at the same workspace.
    expect(results).toHaveLength(10);
    expect(new Set(results.map((r) => r.teamId)).size).toBe(1);
    expect(await ownerCount(teamId)).toBe(1);
    for (const context of results) {
      expect(context.isOwner).toBe(true);
      expect(context.memberId).not.toBeNull();
    }

    // One workspace, one owner, one set of built-in roles.
    expect(
      await countRows(pool, `SELECT count(*)::text c FROM business_team_roles WHERE team_id = $1`, [
        teamId,
      ]),
    ).toBe(3);
    // And exactly one provisioning audit row, not ten.
    expect(
      await countRows(
        pool,
        `SELECT count(*)::text c FROM business_team_audit_log
          WHERE team_id = $1 AND action = 'business_team.workspace.provision'`,
        [teamId],
      ),
    ).toBe(1);
  }, 300_000);

  it('refuses a second workspace for the same account, whatever writes it', async () => {
    const business = await seedUser({ role: 'business' });
    const svc = await service();
    await svc.resolveContext({ id: business.userId, role: 'business' });

    await expect(
      pool.query(`INSERT INTO business_teams (business_id, name) VALUES ($1, 'Second')`, [
        business.userId,
      ]),
    ).rejects.toMatchObject({ code: '23505' });
    expect(await teamCountFor(business.userId)).toBe(1);
  });

  it('is idempotent across repeated first access, not just concurrent', async () => {
    const business = await seedUser({ role: 'business' });
    const svc = await service();

    const first = await svc.resolveContext({ id: business.userId, role: 'business' });
    const second = await svc.resolveContext({ id: business.userId, role: 'business' });
    const third = await svc.getOverview({ id: business.userId, role: 'business' });

    expect(second.teamId).toBe(first.teamId);
    expect(third.team.id).toBe(first.teamId);
    expect(await teamCountFor(business.userId)).toBe(1);
    // A page load is not a history entry: only the transaction that created
    // the workspace wrote one.
    expect(
      await countRows(
        pool,
        `SELECT count(*)::text c FROM business_team_audit_log WHERE team_id = $1`,
        [first.teamId],
      ),
    ).toBe(1);
  });
});

// ===========================================================================
// Exactly one owner at commit.
// ===========================================================================

describe.skipIf(!pgIntegrationEnabled())('exactly one owner at commit', () => {
  const workspace = async () => {
    const business = await seedUser({ role: 'business' });
    const svc = await service();
    const context = await svc.resolveContext({ id: business.userId, role: 'business' });
    return { business, teamId: context.teamId, svc };
  };

  it('creates a workspace and its owner atomically', async () => {
    const { teamId } = await workspace();
    // The workspace row and its owner membership are inserted in one
    // transaction, which the deferred trigger judges only at commit.
    expect(await ownerCount(teamId)).toBe(1);
  });

  it('refuses a committed workspace with no owner', async () => {
    // A workspace created without one. The INSERT itself succeeds — an
    // immediate constraint could not permit this instant — and the COMMIT is
    // what fails.
    const business = await seedUser({ role: 'business' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO business_teams (business_id, name) VALUES ($1, 'Ownerless')`,
        [business.userId],
      );
      await expect(client.query('COMMIT')).rejects.toMatchObject({ code: '23000' });
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
    expect(await teamCountFor(business.userId)).toBe(0);
  });

  it('rejects owner removal by direct SQL', async () => {
    const { teamId } = await workspace();
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM business_members WHERE team_id = $1 AND role = 'owner'`,
      [teamId],
    );

    // Not through the endpoint, which refuses it for its own reasons — straight
    // at the table.
    await expect(
      pool.query(`DELETE FROM business_members WHERE id = $1`, [rows[0]!.id]),
    ).rejects.toMatchObject({ code: '23000' });
    expect(await ownerCount(teamId)).toBe(1);
  });

  it('rejects owner demotion by direct SQL', async () => {
    const { teamId } = await workspace();
    const { rows: owner } = await pool.query<{ id: string }>(
      `SELECT id FROM business_members WHERE team_id = $1 AND role = 'owner'`,
      [teamId],
    );
    const { rows: memberRole } = await pool.query<{ id: string }>(
      `SELECT id FROM business_team_roles WHERE team_id = $1 AND role_key = 'member'`,
      [teamId],
    );

    await expect(
      pool.query(`UPDATE business_members SET role_id = $2 WHERE id = $1`, [
        owner[0]!.id,
        memberRole[0]!.id,
      ]),
    ).rejects.toMatchObject({ code: '23000' });
    expect(await ownerCount(teamId)).toBe(1);
  });

  it('rejects a second owner immediately, and zero owners at commit', async () => {
    const { teamId } = await workspace();
    const other = await seedUser({ role: 'expert' });
    const { rows: ownerRole } = await pool.query<{ id: string }>(
      `SELECT id FROM business_team_roles WHERE team_id = $1 AND role_key = 'owner'`,
      [teamId],
    );

    // Upper bound: the partial unique index, checked immediately.
    await expect(
      pool.query(`INSERT INTO business_members (team_id, user_id, role_id) VALUES ($1, $2, $3)`, [
        teamId,
        other.userId,
        ownerRole[0]!.id,
      ]),
    ).rejects.toMatchObject({ code: '23505' });

    expect(await ownerCount(teamId)).toBe(1);
  });

  it('permits an ownerless instant inside a transaction that ends with one owner', async () => {
    // The reason the lower bound has to be deferred: a legitimate transaction
    // may pass through zero owners as long as it does not commit there.
    const { teamId } = await workspace();
    const successor = await seedUser({ role: 'expert' });
    const { rows: ownerRole } = await pool.query<{ id: string }>(
      `SELECT id FROM business_team_roles WHERE team_id = $1 AND role_key = 'owner'`,
      [teamId],
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM business_members WHERE team_id = $1 AND role = 'owner'`, [
        teamId,
      ]);
      await client.query(
        `INSERT INTO business_members (team_id, user_id, role_id) VALUES ($1, $2, $3)`,
        [teamId, successor.userId, ownerRole[0]!.id],
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    expect(await ownerCount(teamId)).toBe(1);
  });

  it('holds under concurrent membership mutations', async () => {
    const { business, teamId, svc } = await workspace();
    const ownerActor = { id: business.userId, role: 'business' };
    const { rows: memberRole } = await pool.query<{ id: string }>(
      `SELECT id FROM business_team_roles WHERE team_id = $1 AND role_key = 'member'`,
      [teamId],
    );

    const members: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      const person = await seedUser({ role: 'expert' });
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO business_members (team_id, user_id, role_id) VALUES ($1, $2, $3) RETURNING id`,
        [teamId, person.userId, memberRole[0]!.id],
      );
      members.push(rows[0]!.id);
    }

    // Eight removals and eight role updates racing each other. None of them
    // touches the owner, and the invariant is checked at each commit.
    await Promise.allSettled([
      ...members.map((id) => svc.removeMember(ownerActor, id)),
      ...members.map((id) => svc.updateMemberRole(ownerActor, id, { roleId: memberRole[0]!.id })),
    ]);

    expect(await ownerCount(teamId)).toBe(1);
  }, 300_000);
});

// ===========================================================================
// The workspace owner's account role.
// ===========================================================================

describe.skipIf(!pgIntegrationEnabled())('workspace owner account role', () => {
  it('refuses to demote an account that owns a workspace', async () => {
    const business = await seedUser({ role: 'business' });
    const svc = await service();
    await svc.resolveContext({ id: business.userId, role: 'business' });

    for (const role of ['customer', 'expert', 'craftsman']) {
      await expect(
        pool.query(`UPDATE users SET primary_role = $2 WHERE id = $1`, [business.userId, role]),
      ).rejects.toMatchObject({ code: '23000' });
    }

    const { rows } = await pool.query<{ primary_role: string }>(
      `SELECT primary_role FROM users WHERE id = $1`,
      [business.userId],
    );
    expect(rows[0]!.primary_role).toBe('business');
  });

  it('leaves every other account role change alone', async () => {
    // An invited member's account role is not the workspace's business, and a
    // business account with no workspace is free to change.
    const member = await seedUser({ role: 'expert' });
    await pool.query(`UPDATE users SET primary_role = 'craftsman' WHERE id = $1`, [member.userId]);

    const unprovisioned = await seedUser({ role: 'business' });
    await pool.query(`UPDATE users SET primary_role = 'customer' WHERE id = $1`, [
      unprovisioned.userId,
    ]);

    const { rows } = await pool.query<{ id: string; primary_role: string }>(
      `SELECT id, primary_role FROM users WHERE id = ANY($1::uuid[])`,
      [[member.userId, unprovisioned.userId]],
    );
    expect(rows.find((r) => r.id === member.userId)!.primary_role).toBe('craftsman');
    expect(rows.find((r) => r.id === unprovisioned.userId)!.primary_role).toBe('customer');
  });

  it('does not change an invited member account role on acceptance', async () => {
    const business = await seedUser({ role: 'business' });
    const svc = await service();
    const context = await svc.resolveContext({ id: business.userId, role: 'business' });
    const { rows: role } = await pool.query<{ id: string }>(
      `SELECT id FROM business_team_roles WHERE team_id = $1 AND role_key = 'manager'`,
      [context.teamId],
    );

    const invitee = await seedUser({ role: 'craftsman' });
    mail.links.length = 0;
    await svc.createInvite({ id: business.userId }, { email: invitee.email, roleId: role[0]!.id });
    const token = new URL(mail.links.at(-1)!).searchParams.get('token')!;
    await svc.acceptInvite({ id: invitee.userId }, token);

    const { rows } = await pool.query<{ primary_role: string }>(
      `SELECT primary_role FROM users WHERE id = $1`,
      [invitee.userId],
    );
    // Admin in the workspace, craftsman as an account.
    expect(rows[0]!.primary_role).toBe('craftsman');
    const workspaces = await svc.listWorkspaces({ id: invitee.userId, role: 'craftsman' });
    expect(workspaces.workspaces[0]?.tier).toBe('admin');
  });
});

// ===========================================================================
// Audit atomicity.
// ===========================================================================

describe.skipIf(!pgIntegrationEnabled())('audit atomicity', () => {
  it('rolls the mutation back when its audit row cannot be written', async () => {
    const business = await seedUser({ role: 'business' });
    const svc = await service();
    const context = await svc.resolveContext({ id: business.userId, role: 'business' });
    const { rows: role } = await pool.query<{ id: string }>(
      `SELECT id FROM business_team_roles WHERE team_id = $1 AND role_key = 'member'`,
      [context.teamId],
    );

    const person = await seedUser({ role: 'expert' });
    const { rows: member } = await pool.query<{ id: string }>(
      `INSERT INTO business_members (team_id, user_id, role_id) VALUES ($1, $2, $3) RETURNING id`,
      [context.teamId, person.userId, role[0]!.id],
    );

    // Make the audit insert fail for real, at the database, rather than by
    // mocking the function that writes it — the claim is that the two share a
    // transaction, and only the database can demonstrate that.
    await pool.query(
      `ALTER TABLE business_team_audit_log
         ADD CONSTRAINT tmp_audit_always_fails CHECK (action IS NULL) NOT VALID`,
    );
    try {
      await expect(
        svc.removeMember({ id: business.userId, role: 'business' }, member[0]!.id),
      ).rejects.toThrow();

      // The membership is still there: the audit failure took the removal with it.
      expect(
        await countRows(pool, `SELECT count(*)::text c FROM business_members WHERE id = $1`, [
          member[0]!.id,
        ]),
      ).toBe(1);
    } finally {
      await pool.query(
        `ALTER TABLE business_team_audit_log DROP CONSTRAINT tmp_audit_always_fails`,
      );
    }

    // And with the constraint gone, the same call commits both.
    await svc.removeMember({ id: business.userId, role: 'business' }, member[0]!.id);
    expect(
      await countRows(pool, `SELECT count(*)::text c FROM business_members WHERE id = $1`, [
        member[0]!.id,
      ]),
    ).toBe(0);
    expect(
      await countRows(
        pool,
        `SELECT count(*)::text c FROM business_team_audit_log
          WHERE team_id = $1 AND action = 'business_team.member.remove'`,
        [context.teamId],
      ),
    ).toBe(1);
  });
});

// ===========================================================================
// Migration compatibility with legitimate baseline history.
// ===========================================================================

describe.skipIf(!pgIntegrationEnabled())('migration compatibility', () => {
  /**
   * A database in the state this migration will actually meet.
   *
   * Built by taking a fully migrated scratch copy back through the rollback the
   * migration header documents, which removes exactly this migration's objects
   * and leaves everything before it standing. What is left is the baseline
   * schema — `business_team_invites` with no `revoked_at`, no pending-uniqueness
   * index and no shape checks — which is where the legacy rows go.
   */
  const baselineCopy = async (label: string) => {
    const copy = await createScratchDatabase(label);
    await copy.exec(ROLLBACK_SQL);
    return copy;
  };

  it('backfills revoked invitations that predate the revoked_at column', async () => {
    const copy = await baselineCopy('bizmig');
    try {
      const { rows: user } = await copy.pool.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, display_name, primary_role)
         VALUES ('legacy-owner@test.local', 'x', 'Legacy', 'business') RETURNING id`,
      );
      const { rows: team } = await copy.pool.query<{ id: string }>(
        `INSERT INTO business_teams (business_id, name) VALUES ($1, 'Legacy') RETURNING id`,
        [user[0]!.id],
      );
      const { rows: role } = await copy.pool.query<{ id: string }>(
        `INSERT INTO business_team_roles (team_id, name, role_key, built_in, permissions)
         VALUES ($1, 'Member', 'member', true, '[]'::jsonb) RETURNING id`,
        [team[0]!.id],
      );
      await copy.pool.query(
        `INSERT INTO business_members (team_id, user_id, role, role_id)
         VALUES ($1, $2, 'owner', $3)`,
        [team[0]!.id, user[0]!.id, role[0]!.id],
      );

      // Exactly what the baseline revoke path wrote: a status, an updated_at,
      // and no timestamp column to put a revocation time in.
      await copy.pool.query(
        `INSERT INTO business_team_invites
           (team_id, email, role_id, token_hash, status, created_at, updated_at, expires_at)
         VALUES
           ($1, 'revoked-one@test.local', $2, repeat('a', 64), 'revoked',
            now() - INTERVAL '20 days', now() - INTERVAL '18 days', now() - INTERVAL '13 days'),
           ($1, 'revoked-two@test.local', $2, repeat('b', 64), 'revoked',
            now() - INTERVAL '10 days', now() - INTERVAL '10 days', now() - INTERVAL '3 days'),
           ($1, 'accepted-one@test.local', $2, repeat('c', 64), 'accepted',
            now() - INTERVAL '9 days', now() - INTERVAL '8 days', now() - INTERVAL '2 days')`,
        [team[0]!.id, role[0]!.id],
      );
      // And the duplicate pending invitations the baseline also permitted.
      await copy.pool.query(
        `INSERT INTO business_team_invites
           (team_id, email, role_id, token_hash, status, created_at, expires_at)
         VALUES
           ($1, 'dupe@test.local', $2, repeat('d', 64), 'pending',
            now() - INTERVAL '5 days', now() + INTERVAL '2 days'),
           ($1, 'Dupe@Test.local', $2, repeat('e', 64), 'pending',
            now() - INTERVAL '1 day', now() + INTERVAL '6 days')`,
        [team[0]!.id, role[0]!.id],
      );

      const before = await countRows(
        copy.pool,
        `SELECT count(*)::text c FROM business_team_invites`,
        [],
      );
      expect(before).toBe(5);

      // The migration, applied for real from its own file, against that history.
      await copy.exec(readMigration(MIGRATION_FILE));

      // Nothing was deleted.
      expect(
        await countRows(copy.pool, `SELECT count(*)::text c FROM business_team_invites`, []),
      ).toBe(5);

      // Every revoked row now carries a deterministic timestamp taken from the
      // row's own history, and the shape check it would previously have failed
      // now holds.
      const { rows: revoked } = await copy.pool.query<{
        email: string;
        revoked_at: Date | null;
        created_at: Date;
        updated_at: Date | null;
      }>(
        `SELECT email, revoked_at, created_at, updated_at FROM business_team_invites
          WHERE status = 'revoked' ORDER BY email`,
      );
      expect(revoked).toHaveLength(2);
      for (const row of revoked) {
        expect(row.revoked_at).not.toBeNull();
        expect(row.revoked_at?.getTime()).toBe(row.updated_at?.getTime());
      }
      // The row revoked in the same breath it was created lands on its own
      // creation time, which is the right answer rather than a coincidence.
      expect(revoked[1]!.revoked_at?.getTime()).toBe(revoked[1]!.created_at.getTime());

      // The backfill COALESCEs to `created_at`, which the baseline schema makes
      // unreachable — `updated_at` is NOT NULL. Asserted so the fallback is
      // known to be belt-and-braces rather than load-bearing.
      const { rows: nullable } = await copy.pool.query<{ is_nullable: string }>(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_name = 'business_team_invites' AND column_name = 'updated_at'`,
      );
      expect(nullable[0]!.is_nullable).toBe('NO');

      // The accepted row keeps its own timestamp and satisfies its check.
      const { rows: accepted } = await copy.pool.query<{ accepted_at: Date | null }>(
        `SELECT accepted_at FROM business_team_invites WHERE status = 'accepted'`,
      );
      expect(accepted[0]!.accepted_at).not.toBeNull();

      // The duplicate pending pair is reconciled newest-wins, and the loser is
      // retired rather than removed.
      const { rows: dupes } = await copy.pool.query<{ email: string; status: string }>(
        `SELECT email, status FROM business_team_invites
          WHERE lower(btrim(email)) = 'dupe@test.local' ORDER BY created_at`,
      );
      expect(dupes.map((d) => d.status)).toEqual(['expired', 'pending']);

      // Every new constraint is now in place over that data.
      const { rows: present } = await copy.pool.query<{ n: string }>(
        `SELECT count(*)::text n FROM pg_constraint
          WHERE conname LIKE 'chk_business_team_invites_%_shape'`,
      );
      expect(present[0]!.n).toBe('4');
      expect(
        (
          await copy.pool.query<{ t: string | null }>(
            `SELECT to_regclass('public.uq_business_team_invites_pending_email')::text t`,
          )
        ).rows[0]!.t,
      ).toBe('uq_business_team_invites_pending_email');
    } finally {
      await copy.drop();
    }
  }, 900_000);

  it('refuses to run when a business account already owns two workspaces', async () => {
    const copy = await baselineCopy('bizdupe');
    try {
      const { rows: user } = await copy.pool.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, display_name, primary_role)
         VALUES ('split@test.local', 'x', 'Split', 'business') RETURNING id`,
      );
      // The exact damage the provisioning race could have done before the unique
      // index existed. Which of the two is the real workspace is a decision, and
      // a migration is the wrong place to guess.
      await copy.pool.query(
        `INSERT INTO business_teams (business_id, name) VALUES ($1, 'One'), ($1, 'Two')`,
        [user[0]!.id],
      );

      await expect(copy.exec(readMigration(MIGRATION_FILE))).rejects.toThrow(
        /more than one workspace/i,
      );

      // And it stopped before touching anything.
      expect(await countRows(copy.pool, `SELECT count(*)::text c FROM business_teams`, [])).toBe(2);
    } finally {
      await copy.drop();
    }
  }, 900_000);
});

// ===========================================================================
// Workspace access for invited and multi-workspace accounts.
// ===========================================================================

describe.skipIf(!pgIntegrationEnabled())('workspace access', () => {
  /** A provisioned workspace plus a helper to invite somebody into it. */
  const workspaceWith = async (name: string) => {
    const business = await seedUser({ role: 'business' });
    const svc = await service();
    const context = await svc.resolveContext({ id: business.userId, role: 'business' });
    await pool.query(`UPDATE business_teams SET name = $2 WHERE id = $1`, [context.teamId, name]);

    const roleIdFor = async (key: string) => {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM business_team_roles WHERE team_id = $1 AND role_key = $2`,
        [context.teamId, key],
      );
      return rows[0]!.id;
    };

    const invite = async (email: string, roleKey: string) => {
      mail.links.length = 0;
      await svc.createInvite({ id: business.userId }, { email, roleId: await roleIdFor(roleKey) });
      return new URL(mail.links.at(-1)!).searchParams.get('token')!;
    };

    return { business, teamId: context.teamId, svc, roleIdFor, invite };
  };

  it('gives an invited non-business account a workspace it can actually open', async () => {
    const alpha = await workspaceWith('Alpha Ltd');
    const svc = alpha.svc;
    // A craftsman: the account role that the previous frontend used to decide
    // whether the team panel existed at all.
    const invitee = await seedUser({ role: 'craftsman' });

    const token = await alpha.invite(invitee.email, 'member');
    const result = await svc.acceptInvite({ id: invitee.userId }, token);

    // The acceptance answer names a workspace, and that workspace opens.
    expect(result.teamId).toBe(alpha.teamId);
    const list = await svc.listWorkspaces({ id: invitee.userId, role: 'craftsman' });
    expect(list.workspaces.map((w) => w.teamId)).toEqual([alpha.teamId]);
    expect(list.defaultTeamId).toBe(alpha.teamId);

    const overview = await svc.getOverview(
      { id: invitee.userId, role: 'craftsman' },
      result.teamId,
    );
    expect(overview.team.id).toBe(alpha.teamId);
    expect(overview.viewer.tier).toBe('member');
    // A member sees the workspace and no administration.
    expect(overview.viewer.allowedActions.inviteMembers).toBe(false);
  });

  it('lets an account belonging to two workspaces select between them', async () => {
    const alpha = await workspaceWith('Alpha Ltd');
    const beta = await workspaceWith('Beta Ltd');
    const svc = alpha.svc;
    const person = await seedUser({ role: 'expert' });

    await svc.acceptInvite({ id: person.userId }, await alpha.invite(person.email, 'member'));
    await svc.acceptInvite({ id: person.userId }, await beta.invite(person.email, 'manager'));

    const list = await svc.listWorkspaces({ id: person.userId, role: 'expert' });
    expect(list.workspaces).toHaveLength(2);
    expect(new Set(list.workspaces.map((w) => w.teamId))).toEqual(
      new Set([alpha.teamId, beta.teamId]),
    );

    // Each selection resolves that workspace's own standing, not the other's.
    const inAlpha = await svc.getOverview({ id: person.userId, role: 'expert' }, alpha.teamId);
    const inBeta = await svc.getOverview({ id: person.userId, role: 'expert' }, beta.teamId);
    expect(inAlpha.team.name).toBe('Alpha Ltd');
    expect(inAlpha.viewer.tier).toBe('member');
    expect(inBeta.team.name).toBe('Beta Ltd');
    expect(inBeta.viewer.tier).toBe('admin');
    expect(inBeta.viewer.allowedActions.inviteMembers).toBe(true);
  });

  it('refuses a workspace the caller does not belong to, and one that does not exist', async () => {
    const alpha = await workspaceWith('Alpha Ltd');
    const beta = await workspaceWith('Beta Ltd');
    const svc = alpha.svc;
    const person = await seedUser({ role: 'expert' });
    await svc.acceptInvite({ id: person.userId }, await alpha.invite(person.email, 'member'));

    // Beta is real, and not theirs.
    await expect(
      svc.getOverview({ id: person.userId, role: 'expert' }, beta.teamId),
    ).rejects.toMatchObject({ code: 'WORKSPACE_NOT_ACCESSIBLE' });
    // A workspace that does not exist gets the identical answer, so the
    // selector never confirms that a team id is real.
    await expect(
      svc.getOverview(
        { id: person.userId, role: 'expert' },
        '00000000-0000-4000-8000-000000000000',
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_NOT_ACCESSIBLE' });

    // And a business account cannot reach another workspace by naming it either.
    await expect(
      svc.getOverview({ id: alpha.business.userId, role: 'business' }, beta.teamId),
    ).rejects.toMatchObject({ code: 'WORKSPACE_NOT_ACCESSIBLE' });
  });

  it('denies a removed member the workspace immediately, in list and in selection', async () => {
    const alpha = await workspaceWith('Alpha Ltd');
    const svc = alpha.svc;
    const person = await seedUser({ role: 'expert' });
    await svc.acceptInvite({ id: person.userId }, await alpha.invite(person.email, 'member'));

    const { rows: member } = await pool.query<{ id: string }>(
      `SELECT id FROM business_members WHERE team_id = $1 AND user_id = $2`,
      [alpha.teamId, person.userId],
    );
    await svc.removeMember({ id: alpha.business.userId, role: 'business' }, member[0]!.id);

    const list = await svc.listWorkspaces({ id: person.userId, role: 'expert' });
    expect(list.workspaces).toEqual([]);
    expect(list.defaultTeamId).toBeNull();
    await expect(
      svc.getOverview({ id: person.userId, role: 'expert' }, alpha.teamId),
    ).rejects.toMatchObject({ code: 'WORKSPACE_NOT_ACCESSIBLE' });
  });

  it('does not provision a workspace for an account that named a foreign one', async () => {
    const beta = await workspaceWith('Beta Ltd');
    const svc = beta.svc;
    // A business account that has never opened its own team screen, asking for
    // a workspace it does not belong to. It must not be handed one, and must
    // not have one created as a side effect.
    const outsider = await seedUser({ role: 'business' });

    await expect(
      svc.getOverview({ id: outsider.userId, role: 'business' }, beta.teamId),
    ).rejects.toMatchObject({ code: 'WORKSPACE_NOT_ACCESSIBLE' });
    expect(await teamCountFor(outsider.userId)).toBe(0);
  });
});

// ===========================================================================
// Seats and the offered-role snapshot.
// ===========================================================================

describe.skipIf(!pgIntegrationEnabled())('seats and role history', () => {
  const workspace = async () => {
    const business = await seedUser({ role: 'business' });
    const svc = await service();
    const context = await svc.resolveContext({ id: business.userId, role: 'business' });
    const roleIdFor = async (key: string) => {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM business_team_roles WHERE team_id = $1 AND role_key = $2`,
        [context.teamId, key],
      );
      return rows[0]!.id;
    };
    return { business, teamId: context.teamId, svc, roleIdFor };
  };

  it('enforces the plan maxTeamSlots entitlement when one is configured', async () => {
    const { business, teamId, svc, roleIdFor } = await workspace();
    const roleId = await roleIdFor('member');

    // The entitlement already existed in `plan_limits`; nothing new is invented
    // here. Two seats: the owner, plus one.
    const { rows: plan } = await pool.query<{ id: string }>(
      `INSERT INTO plans (slug, name, price, currency, billing_cycle, allowed_roles,
                          is_active, plan_limits)
       VALUES ('seat-test-' || gen_random_uuid()::text, 'Seat test', 0, 'EGP', 'monthly',
               ARRAY['business']::text[], true, '{"maxTeamSlots": 2}'::jsonb)
       RETURNING id`,
    );
    await pool.query(`UPDATE users SET plan_id = $2 WHERE id = $1`, [business.userId, plan[0]!.id]);

    const actor = { id: business.userId, role: 'business' };
    // Seat two: a pending invitation counts, so the workspace cannot queue its
    // way past the limit.
    await svc.createInvite(actor, { email: 'seat-two@test.local', roleId });
    await expect(
      svc.createInvite(actor, { email: 'seat-three@test.local', roleId }),
    ).rejects.toMatchObject({ code: 'TEAM_SEAT_LIMIT_REACHED' });

    // Revoking frees the seat again.
    const { rows: invite } = await pool.query<{ id: string }>(
      `SELECT id FROM business_team_invites WHERE team_id = $1 AND status = 'pending'`,
      [teamId],
    );
    await svc.revokeInvite(actor, invite[0]!.id);
    await expect(
      svc.createInvite(actor, { email: 'seat-three@test.local', roleId }),
    ).resolves.toBeDefined();
  });

  it('falls back to a technical ceiling when no plan configures seats', async () => {
    // Launch sells no team seats: every plan leaves `maxTeamSlots` unset. The
    // ceiling that applies is a relay guard, not a price boundary, so an
    // ordinary team never meets it.
    const { business, svc, roleIdFor } = await workspace();
    const roleId = await roleIdFor('member');

    const { rows } = await pool.query<{ slots: string | null }>(
      `SELECT p.plan_limits ->> 'maxTeamSlots' AS slots
         FROM users u LEFT JOIN plans p ON p.id = u.plan_id WHERE u.id = $1`,
      [business.userId],
    );
    expect(rows[0]?.slots ?? null).toBeNull();

    for (let i = 0; i < 5; i += 1) {
      await expect(
        svc.createInvite(
          { id: business.userId, role: 'business' },
          { email: `bulk-${i}@test.local`, roleId },
        ),
      ).resolves.toBeDefined();
    }
  }, 300_000);

  it('keeps the role a person was actually offered after that role is deleted', async () => {
    const { business, teamId, svc } = await workspace();
    const actor = { id: business.userId, role: 'business' };

    await svc.createRole(actor, { name: 'Senior Engineer', permissions: ['manage_team'] });
    const { rows: custom } = await pool.query<{ id: string }>(
      `SELECT id FROM business_team_roles WHERE team_id = $1 AND built_in = false`,
      [teamId],
    );
    await svc.createInvite(actor, { email: 'historic@test.local', roleId: custom[0]!.id });

    const { rows: replacement } = await pool.query<{ id: string }>(
      `SELECT id FROM business_team_roles WHERE team_id = $1 AND role_key = 'member'`,
      [teamId],
    );
    await svc.deleteRole(actor, custom[0]!.id, { replacementRoleId: replacement[0]!.id });

    // The role is gone — deletion is never permanently blocked by history —
    // and the invitation still reads as what it offered.
    expect(
      await countRows(pool, `SELECT count(*)::text c FROM business_team_roles WHERE id = $1`, [
        custom[0]!.id,
      ]),
    ).toBe(0);

    const overview = await svc.getOverview(actor);
    const historic = overview.invites.find((i) => i.email === 'historic@test.local');
    expect(historic?.roleName).toBe('Senior Engineer');

    const { rows: stored } = await pool.query<{
      role_id: string;
      role_name_snapshot: string | null;
    }>(`SELECT role_id, role_name_snapshot FROM business_team_invites WHERE team_id = $1`, [
      teamId,
    ]);
    // The pointer moved so the delete could proceed; the snapshot did not.
    expect(stored[0]!.role_id).toBe(replacement[0]!.id);
    expect(stored[0]!.role_name_snapshot).toBe('Senior Engineer');
  });

  it('refuses to store a permission no endpoint enforces', async () => {
    const { business, teamId, svc } = await workspace();

    await svc.createRole(
      { id: business.userId, role: 'business' },
      // Requested with a reserved value. It is filtered before storage rather
      // than kept and reported as working.
      { name: 'Ops', permissions: ['manage_team', 'view_wallet'] },
    );

    const { rows } = await pool.query<{ permissions: string[] }>(
      `SELECT permissions FROM business_team_roles WHERE team_id = $1 AND built_in = false`,
      [teamId],
    );
    expect(rows[0]!.permissions).toEqual(['manage_team']);
  });

  it('preserves a reserved permission an existing role already carries', async () => {
    const { business, teamId, svc } = await workspace();
    const actor = { id: business.userId, role: 'business' };

    // A role configured before Wave 2G-A split enforced from stored.
    const { rows: legacy } = await pool.query<{ id: string }>(
      `INSERT INTO business_team_roles (team_id, name, role_key, built_in, permissions)
       VALUES ($1, 'Legacy Ops', 'custom_legacy', false,
               '["manage_team","manage_services","view_analytics"]'::jsonb)
       RETURNING id`,
      [teamId],
    );

    const overview = await svc.getOverview(actor);
    const role = overview.roles.find((r) => r.id === legacy[0]!.id);
    expect(role?.permissions).toEqual(['manage_team']);
    expect(role?.reservedPermissions.sort()).toEqual(['manage_services', 'view_analytics']);

    // Editing the role does not silently strip what it was carrying.
    await svc.updateRole(actor, legacy[0]!.id, { name: 'Legacy Ops', permissions: [] });
    const { rows: after } = await pool.query<{ permissions: string[] }>(
      `SELECT permissions FROM business_team_roles WHERE id = $1`,
      [legacy[0]!.id],
    );
    expect([...after[0]!.permissions].sort()).toEqual(['manage_services', 'view_analytics']);
  });
});
