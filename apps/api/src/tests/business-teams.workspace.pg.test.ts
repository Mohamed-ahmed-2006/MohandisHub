import { createHash } from 'node:crypto';

import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  countRows,
  createScratchDatabase,
  pgIntegrationEnabled,
  type ScratchDatabase,
} from './support/pg-scratch.js';

// ---------------------------------------------------------------------------
// Business workspace membership and invitations, against a REAL PostgreSQL.
// ---------------------------------------------------------------------------
// Almost every claim in Wave 2G/2H is a claim about rows under concurrency:
// "one owner however many transfers race", "ten accepts create one membership",
// "a revoke and an accept cannot both win", "a role from another workspace is
// refused". None of those can be demonstrated against a mocked pool — they are
// properties of actual FOR UPDATE blocking, actual partial unique indexes,
// actual triggers and actual MVCC visibility at READ COMMITTED.
//
// The suite builds a disposable database by replaying every migration, so it
// also proves the repository can build this schema from nothing.
//
// Opt-in:  RUN_PG_INTEGRATION=1 npm run test -w @mohandishub/api
// ---------------------------------------------------------------------------

let scratch: ScratchDatabase;
let pool: Pool;

vi.mock('../db/pool.js', () => ({
  getPool: () => pool,
  hasDatabaseConfig: () => true,
}));

// The invitation email is the ONLY place the raw token exists after creation,
// so the suite reads it back out of the delivered message rather than reaching
// into the service. `vi.hoisted` because a `vi.mock` factory is hoisted above
// every other statement in the module.
const mail = vi.hoisted(() => ({ links: [] as string[] }));
vi.mock('../utils/send-transactional-email.js', () => ({
  sendTransactionalEmail: (message: { action?: { kind: string; url?: string } }) => {
    if (message.action?.kind === 'button' && message.action.url) {
      mail.links.push(message.action.url);
    }
    return Promise.resolve();
  },
}));

// A remote server plus four other PostgreSQL suites competing for connections
// makes vitest's 5-second default meaningless here.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 1_800_000 });

const service = async () => import('../modules/business-teams/business-teams.service.js');

type Seeded = { userId: string; email: string };

let seq = 0;

/** An account, created from nothing. `primary_role` is the ACCOUNT role. */
const seedUser = async (params: { role?: string; email?: string } = {}): Promise<Seeded> => {
  seq += 1;
  const email = params.email ?? `u${seq}-${Date.now().toString(36)}@test.local`;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, display_name, primary_role, email_verified_at)
     VALUES ($1, 'x', $2, $3, now())
     RETURNING id`,
    [email.toLowerCase(), `User ${seq}`, params.role ?? 'customer'],
  );
  return { userId: rows[0]!.id, email };
};

/** A provisioned workspace owned by a fresh business account. */
const seedWorkspace = async (): Promise<{
  owner: Seeded;
  teamId: string;
  roleIdFor: (key: string) => Promise<string>;
}> => {
  const owner = await seedUser({ role: 'business' });
  const svc = await service();
  const context = await svc.resolveContext({ id: owner.userId, role: 'business' });
  return {
    owner,
    teamId: context.teamId,
    roleIdFor: async (key: string) => {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM business_team_roles WHERE team_id = $1 AND role_key = $2`,
        [context.teamId, key],
      );
      return rows[0]!.id;
    },
  };
};

/** Invite an address and read the raw token straight back out of the email. */
const inviteAndCaptureToken = async (params: {
  actorId: string;
  email: string;
  roleId: string;
}): Promise<{ token: string; inviteId: string }> => {
  const svc = await service();
  mail.links.length = 0;
  await svc.createInvite({ id: params.actorId }, { email: params.email, roleId: params.roleId });
  const url = mail.links.at(-1);
  if (!url) throw new Error('No invitation link was produced.');
  const token = new URL(url).searchParams.get('token');
  if (!token) throw new Error('Invitation link carried no token.');
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM business_team_invites WHERE token_hash = $1`,
    [createHash('sha256').update(token, 'utf8').digest('hex')],
  );
  return { token, inviteId: rows[0]!.id };
};

const memberRowFor = async (teamId: string, userId: string) => {
  const { rows } = await pool.query<{ id: string; role: string; role_id: string | null }>(
    `SELECT id, role, role_id FROM business_members WHERE team_id = $1 AND user_id = $2`,
    [teamId, userId],
  );
  return rows[0] ?? null;
};

const ownerCount = (teamId: string) =>
  countRows(
    pool,
    `SELECT count(*)::text c FROM business_members WHERE team_id = $1 AND role = 'owner'`,
    [teamId],
  );

beforeAll(async () => {
  if (!pgIntegrationEnabled()) return;
  scratch = await createScratchDatabase('bizteam');
  pool = scratch.pool;
}, 1_800_000);

afterAll(async () => {
  if (scratch) await scratch.drop();
}, 300_000);

beforeEach(async () => {
  if (!pgIntegrationEnabled()) return;
  // A clean slate per test, inside the scratch database only.
  //
  // Teams go LAST but take everything with them: `business_members`,
  // `business_team_roles`, `business_team_invites` and the audit log all
  // cascade from `business_teams`. Deleting memberships first would strip a
  // live workspace of its owner, which the deferred one-owner trigger correctly
  // refuses — the teardown has to remove the workspace, not hollow it out.
  // Invitations are cleared explicitly first because their `role_id` foreign
  // key is ON DELETE RESTRICT.
  await pool.query(`DELETE FROM business_team_audit_log`);
  await pool.query(`DELETE FROM business_team_invites`);
  await pool.query(`DELETE FROM business_teams`);
});

// ===========================================================================
// Roles, tiers and the permission model.
// ===========================================================================

describe.skipIf(!pgIntegrationEnabled())('workspace roles and tiers', () => {
  it('seeds exactly three assignable built-in tiers and never a viewer', async () => {
    const { teamId } = await seedWorkspace();
    const { rows } = await pool.query<{ role_key: string; is_legacy: boolean }>(
      `SELECT role_key, is_legacy FROM business_team_roles WHERE team_id = $1 ORDER BY role_key`,
      [teamId],
    );
    expect(rows.map((r) => r.role_key)).toEqual(['manager', 'member', 'owner']);
    expect(rows.every((r) => !r.is_legacy)).toBe(true);
  });

  it('classifies a pre-existing viewer seed as legacy without deleting it', async () => {
    const { teamId } = await seedWorkspace();
    // A workspace created before this wave: the viewer row exists and a member
    // sits on it. Both survive, and the role stops being offered.
    const { rows } = await pool.query<{ id: string }>(
      // Written the way the old seeding path wrote it, WITHOUT the legacy flag,
      // so what is asserted below is the API's own classification rather than
      // the column the migration happened to set.
      `INSERT INTO business_team_roles (team_id, name, role_key, built_in, permissions)
       VALUES ($1, 'Viewer', 'viewer', true, '["view_analytics"]'::jsonb)
       RETURNING id`,
      [teamId],
    );
    const viewerRoleId = rows[0]!.id;
    const legacyMember = await seedUser();
    await pool.query(
      `INSERT INTO business_members (team_id, user_id, role_id) VALUES ($1, $2, $3)`,
      [teamId, legacyMember.userId, viewerRoleId],
    );

    const svc = await service();
    const overview = await svc.getOverview({
      id: (await ownerOf(teamId)).userId,
      role: 'business',
    });
    const viewer = overview.roles.find((r) => r.key === 'viewer');
    expect(viewer).toBeDefined();
    expect(viewer!.legacy).toBe(true);
    expect(viewer!.assignable).toBe(false);
    expect(viewer!.memberCount).toBe(1);
    // The tier of a viewer member is Member, not a fourth tier.
    expect(overview.members.find((m) => m.userId === legacyMember.userId)?.tier).toBe('member');
  });

  it('gives the owner every permission regardless of the stored role array', async () => {
    const { owner, teamId } = await seedWorkspace();
    // Even if somebody trims the owner role's permissions, ownership still
    // carries the full set — the array is not what makes an owner an owner.
    await pool.query(
      `UPDATE business_team_roles SET permissions = '[]'::jsonb
        WHERE team_id = $1 AND role_key = 'owner'`,
      [teamId],
    );
    const svc = await service();
    const overview = await svc.getOverview({ id: owner.userId, role: 'business' });
    expect(overview.viewer.tier).toBe('owner');
    expect(overview.viewer.permissions).toContain('manage_team');
    // Ownership carries every ENFORCED permission, and does not conjure the
    // unenforced ones into working.
    expect(overview.viewer.permissions).not.toContain('view_wallet');
    expect(overview.viewer.allowedActions.manageRoles).toBe(true);
    expect(overview.viewer.allowedActions.transferOwnership).toBe(false);
  });

  it('resolves a custom role permission array server-side, at the member tier', async () => {
    const { owner, teamId } = await seedWorkspace();
    const svc = await service();
    await svc.createRole(
      { id: owner.userId, role: 'business' },
      // Requested with two reserved values. The service keeps them in the row
      // and refuses to report either as effective.
      { name: 'Operations', permissions: ['manage_jobs', 'view_analytics'] },
    );
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM business_team_roles WHERE team_id = $1 AND built_in = false`,
      [teamId],
    );
    const customRoleId = rows[0]!.id;

    const member = await seedUser({ role: 'expert' });
    await pool.query(
      `INSERT INTO business_members (team_id, user_id, role_id) VALUES ($1, $2, $3)`,
      [teamId, member.userId, customRoleId],
    );

    const asMember = await svc.getOverview({ id: member.userId, role: 'expert' });
    expect(asMember.viewer.tier).toBe('member');
    // Both requested values name work no endpoint authorizes, so neither was
    // stored and neither is reported. A role cannot be created advertising a
    // capability the API ignores. (An existing role that already carries one
    // keeps it — covered in business-teams.invariants.pg.test.ts.)
    expect(asMember.viewer.permissions).toEqual([]);
    expect(asMember.viewer.reservedPermissions).toEqual([]);
    const { rows: stored } = await pool.query<{ permissions: string[] }>(
      `SELECT permissions FROM business_team_roles WHERE id = $1`,
      [customRoleId],
    );
    expect(stored[0]!.permissions).toEqual([]);
    // A custom role never confers ownership, whatever it is called.
    expect(asMember.viewer.isOwner).toBe(false);
    expect(asMember.viewer.allowedActions.transferOwnership).toBe(false);
    // And the stored tier column agrees with the resolver.
    expect((await memberRowFor(teamId, member.userId))?.role).toBe('member');
  });

  it('lets a custom role with manage_team administer without granting ownership', async () => {
    const { owner, teamId } = await seedWorkspace();
    const svc = await service();
    await svc.createRole(
      { id: owner.userId, role: 'business' },
      { name: 'Team Coordinator', permissions: ['manage_team'] },
    );
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM business_team_roles WHERE team_id = $1 AND built_in = false`,
      [teamId],
    );
    const delegate = await seedUser({ role: 'expert' });
    await pool.query(
      `INSERT INTO business_members (team_id, user_id, role_id) VALUES ($1, $2, $3)`,
      [teamId, delegate.userId, rows[0]!.id],
    );

    const overview = await svc.getOverview({ id: delegate.userId, role: 'expert' });
    expect(overview.viewer.allowedActions.inviteMembers).toBe(true);
    expect(overview.viewer.allowedActions.removeMembers).toBe(true);
    // The narrow exception stops well short of ownership and role editing.
    expect(overview.viewer.allowedActions.transferOwnership).toBe(false);
    expect(overview.viewer.allowedActions.manageRoles).toBe(false);
  });
});

const ownerOf = async (teamId: string): Promise<Seeded> => {
  const { rows } = await pool.query<{ user_id: string; email: string }>(
    `SELECT m.user_id, u.email FROM business_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.team_id = $1 AND m.role = 'owner'`,
    [teamId],
  );
  return { userId: rows[0]!.user_id, email: rows[0]!.email };
};

// ===========================================================================
// Authorization.
// ===========================================================================

describe.skipIf(!pgIntegrationEnabled())('workspace authorization', () => {
  const asAdmin = async () => {
    const workspace = await seedWorkspace();
    const svc = await service();
    const admin = await seedUser({ role: 'expert' });
    await pool.query(
      `INSERT INTO business_members (team_id, user_id, role_id) VALUES ($1, $2, $3)`,
      [workspace.teamId, admin.userId, await workspace.roleIdFor('manager')],
    );
    return { ...workspace, admin, svc };
  };

  it('does not change the primary account role when someone joins a workspace', async () => {
    const { teamId, roleIdFor } = await seedWorkspace();
    const joiner = await seedUser({ role: 'craftsman' });
    await pool.query(
      `INSERT INTO business_members (team_id, user_id, role_id) VALUES ($1, $2, $3)`,
      [teamId, joiner.userId, await roleIdFor('manager')],
    );

    const { rows } = await pool.query<{ primary_role: string }>(
      `SELECT primary_role FROM users WHERE id = $1`,
      [joiner.userId],
    );
    // Workspace tier admin, account role untouched.
    expect(rows[0]!.primary_role).toBe('craftsman');
    const svc = await service();
    expect((await svc.getOverview({ id: joiner.userId, role: 'craftsman' })).viewer.tier).toBe(
      'admin',
    );
  });

  it('lets an admin administer the team but refuses every ownership operation', async () => {
    const { admin, svc, roleIdFor, teamId } = await asAdmin();
    const actor = { id: admin.userId, role: 'expert' };

    // Allowed.
    await expect(
      svc.createInvite(actor, { email: 'invited@example.com', roleId: await roleIdFor('member') }),
    ).resolves.toBeDefined();

    // Refused: ownership transfer, granting owner, editing roles.
    const ownerMember = await memberRowFor(teamId, (await ownerOf(teamId)).userId);
    await expect(
      svc.transferOwnership(actor, { memberId: ownerMember!.id, confirmation: 'anything' }),
    ).rejects.toMatchObject({ code: 'OWNERSHIP_TRANSFER_NOT_AVAILABLE' });
    await expect(
      svc.createRole(actor, { name: 'Escalation', permissions: ['manage_team'] }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_OWNER_REQUIRED' });
  });

  it('refuses team administration to a plain member', async () => {
    const { teamId, roleIdFor } = await seedWorkspace();
    const member = await seedUser({ role: 'expert' });
    await pool.query(
      `INSERT INTO business_members (team_id, user_id, role_id) VALUES ($1, $2, $3)`,
      [teamId, member.userId, await roleIdFor('member')],
    );
    const svc = await service();
    const actor = { id: member.userId, role: 'expert' };

    await expect(
      svc.createInvite(actor, { email: 'x@example.com', roleId: await roleIdFor('member') }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_ADMIN_REQUIRED' });

    // And the invitation list is not even readable to them.
    const overview = await svc.getOverview(actor);
    expect(overview.viewer.allowedActions.viewInvites).toBe(false);
    expect(overview.invites).toEqual([]);
  });

  it('denies every cross-workspace mutation, because the workspace is never supplied', async () => {
    const alpha = await seedWorkspace();
    const beta = await seedWorkspace();
    const svc = await service();
    const intruder = { id: alpha.owner.userId, role: 'business' };

    // Alpha's owner naming Beta's member, Beta's invitation and Beta's role.
    const betaMember = await memberRowFor(beta.teamId, beta.owner.userId);
    await expect(svc.removeMember(intruder, betaMember!.id)).rejects.toMatchObject({
      code: 'MEMBER_NOT_FOUND',
    });
    await expect(
      svc.updateMemberRole(intruder, betaMember!.id, { roleId: await beta.roleIdFor('member') }),
    ).rejects.toMatchObject({ code: 'MEMBER_NOT_FOUND' });

    const betaInvite = await inviteAndCaptureToken({
      actorId: beta.owner.userId,
      email: 'beta-invitee@example.com',
      roleId: await beta.roleIdFor('member'),
    });
    await expect(svc.revokeInvite(intruder, betaInvite.inviteId)).rejects.toMatchObject({
      code: 'INVITE_NOT_FOUND',
    });

    // Beta is untouched by any of it.
    expect(await ownerCount(beta.teamId)).toBe(1);
    const { rows } = await pool.query<{ status: string }>(
      `SELECT status FROM business_team_invites WHERE id = $1`,
      [betaInvite.inviteId],
    );
    expect(rows[0]!.status).toBe('pending');
  });

  it('rejects a role that belongs to another workspace, in the service and in the database', async () => {
    const alpha = await seedWorkspace();
    const beta = await seedWorkspace();
    const svc = await service();

    const member = await seedUser({ role: 'expert' });
    await pool.query(
      `INSERT INTO business_members (team_id, user_id, role_id) VALUES ($1, $2, $3)`,
      [alpha.teamId, member.userId, await alpha.roleIdFor('member')],
    );
    const memberRow = await memberRowFor(alpha.teamId, member.userId);

    await expect(
      svc.updateMemberRole({ id: alpha.owner.userId, role: 'business' }, memberRow!.id, {
        roleId: await beta.roleIdFor('member'),
      }),
    ).rejects.toMatchObject({ code: 'ROLE_NOT_FOUND' });

    // And the same write attempted directly is refused by the trigger, so the
    // rule does not depend on the service remembering it.
    await expect(
      pool.query(`UPDATE business_members SET role_id = $2 WHERE id = $1`, [
        memberRow!.id,
        await beta.roleIdFor('member'),
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('denies a removed member immediately, on the very next call', async () => {
    const { owner, teamId, roleIdFor } = await seedWorkspace();
    const svc = await service();
    const member = await seedUser({ role: 'expert' });
    await pool.query(
      `INSERT INTO business_members (team_id, user_id, role_id) VALUES ($1, $2, $3)`,
      [teamId, member.userId, await roleIdFor('manager')],
    );
    const actor = { id: member.userId, role: 'expert' };
    expect((await svc.getOverview(actor)).viewer.tier).toBe('admin');

    const memberRow = await memberRowFor(teamId, member.userId);
    await svc.removeMember({ id: owner.userId, role: 'business' }, memberRow!.id);

    // No token refresh, no cache expiry: the next request resolves no workspace.
    await expect(svc.getOverview(actor)).rejects.toMatchObject({
      code: 'NO_BUSINESS_WORKSPACE',
    });
  });

  it('refuses a direct call that bypasses the frontend entirely', async () => {
    const { teamId, roleIdFor } = await seedWorkspace();
    const svc = await service();
    const member = await seedUser({ role: 'expert' });
    await pool.query(
      `INSERT INTO business_members (team_id, user_id, role_id) VALUES ($1, $2, $3)`,
      [teamId, member.userId, await roleIdFor('member')],
    );
    const ownerMember = await memberRowFor(teamId, (await ownerOf(teamId)).userId);
    const actor = { id: member.userId, role: 'expert' };

    // Every control the member's screen hides, invoked anyway.
    await expect(svc.removeMember(actor, ownerMember!.id)).rejects.toMatchObject({
      code: 'WORKSPACE_ADMIN_REQUIRED',
    });
    await expect(
      svc.updateMemberRole(actor, ownerMember!.id, { roleId: await roleIdFor('manager') }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_ADMIN_REQUIRED' });
    await expect(
      svc.transferOwnership(actor, { memberId: ownerMember!.id, confirmation: 'x' }),
    ).rejects.toMatchObject({ code: 'OWNERSHIP_TRANSFER_NOT_AVAILABLE' });

    expect(await ownerCount(teamId)).toBe(1);
  });
});

// ===========================================================================
// Invitations.
// ===========================================================================

describe.skipIf(!pgIntegrationEnabled())('invitations', () => {
  it('stores only a SHA-256 digest, and the database refuses anything else', async () => {
    const { owner, teamId, roleIdFor } = await seedWorkspace();
    const { token, inviteId } = await inviteAndCaptureToken({
      actorId: owner.userId,
      email: 'hash@example.com',
      roleId: await roleIdFor('member'),
    });

    const { rows } = await pool.query<{ token_hash: string }>(
      `SELECT token_hash FROM business_team_invites WHERE id = $1`,
      [inviteId],
    );
    const stored = rows[0]!.token_hash;
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toBe(token);
    expect(stored).toBe(createHash('sha256').update(token, 'utf8').digest('hex'));

    // The raw token appears nowhere in the table, in any column.
    const dump = await pool.query<{ row: string }>(
      `SELECT business_team_invites::text AS row FROM business_team_invites`,
    );
    for (const r of dump.rows) expect(r.row).not.toContain(token);

    // And writing the plaintext is a constraint violation, not a code review.
    await expect(
      pool.query(
        `INSERT INTO business_team_invites (team_id, email, role_id, token_hash)
         VALUES ($1, 'plain@example.com', $2, $3)`,
        [teamId, await roleIdFor('member'), token],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('keeps the token out of the API response for both create and overview', async () => {
    const { owner, roleIdFor } = await seedWorkspace();
    const { token } = await inviteAndCaptureToken({
      actorId: owner.userId,
      email: 'quiet@example.com',
      roleId: await roleIdFor('member'),
    });
    const svc = await service();
    const overview = await svc.getOverview({ id: owner.userId, role: 'business' });
    const serialised = JSON.stringify(overview);

    expect(serialised).not.toContain(token);
    expect(serialised).not.toContain('token_hash');
    expect(serialised).not.toContain('tokenHash');
  });

  it('previews a valid invitation without disclosing the invited address', async () => {
    const { owner, roleIdFor } = await seedWorkspace();
    const invitee = await seedUser({ email: 'bob@example.com' });
    const { token } = await inviteAndCaptureToken({
      actorId: owner.userId,
      email: invitee.email,
      roleId: await roleIdFor('member'),
    });
    const svc = await service();

    const anonymous = await svc.previewInvite({ token });
    expect(anonymous.state).toBe('valid');
    expect(anonymous.roleName).toBe('Member');
    expect(anonymous.requiresAuthentication).toBe(true);
    expect(anonymous.maskedEmail).toBe('b••@example.com');
    expect(anonymous.maskedEmail).not.toBe(invitee.email);
    // Answering this for an anonymous visitor would disclose the address.
    expect(anonymous.signedInAccountMatches).toBeNull();

    const signedIn = await svc.previewInvite({ token, viewerId: invitee.userId });
    expect(signedIn.signedInAccountMatches).toBe(true);
    expect(signedIn.requiresAuthentication).toBe(false);
  });

  it('reports expired, revoked, already used, malformed and wrong account distinctly', async () => {
    const { owner, roleIdFor } = await seedWorkspace();
    const svc = await service();
    const roleId = await roleIdFor('member');

    // malformed — a token that matches nothing gets the same answer as one that
    // never existed, so the endpoint cannot confirm guesses.
    expect((await svc.previewInvite({ token: 'not-a-real-token-value-000000' })).state).toBe(
      'malformed',
    );

    // expired
    const expired = await inviteAndCaptureToken({
      actorId: owner.userId,
      email: 'expired@example.com',
      roleId,
    });
    // Aged, not shortened: the CHECK requires expires_at > created_at, so an
    // invitation that has genuinely run out has to have been created earlier.
    await pool.query(
      `UPDATE business_team_invites
          SET created_at = now() - INTERVAL '10 days', expires_at = now() - INTERVAL '3 days'
        WHERE id = $1`,
      [expired.inviteId],
    );
    expect((await svc.previewInvite({ token: expired.token })).state).toBe('expired');

    // revoked
    const revoked = await inviteAndCaptureToken({
      actorId: owner.userId,
      email: 'revoked@example.com',
      roleId,
    });
    await svc.revokeInvite({ id: owner.userId, role: 'business' }, revoked.inviteId);
    expect((await svc.previewInvite({ token: revoked.token })).state).toBe('revoked');

    // already used
    const accepter = await seedUser({ email: 'used@example.com' });
    const used = await inviteAndCaptureToken({
      actorId: owner.userId,
      email: accepter.email,
      roleId,
    });
    await svc.acceptInvite({ id: accepter.userId }, used.token);
    expect((await svc.previewInvite({ token: used.token })).state).toBe('already_used');

    // wrong account
    const stranger = await seedUser({ email: 'stranger@example.com' });
    const live = await inviteAndCaptureToken({
      actorId: owner.userId,
      email: 'intended@example.com',
      roleId,
    });
    const wrong = await svc.previewInvite({ token: live.token, viewerId: stranger.userId });
    expect(wrong.state).toBe('wrong_account');
    expect(wrong.signedInAccountMatches).toBe(false);
  });

  it('refuses acceptance from an account the invitation was not addressed to', async () => {
    const { owner, teamId, roleIdFor } = await seedWorkspace();
    const stranger = await seedUser({ email: 'nope@example.com' });
    const { token } = await inviteAndCaptureToken({
      actorId: owner.userId,
      email: 'intended@example.com',
      roleId: await roleIdFor('member'),
    });
    const svc = await service();

    await expect(svc.acceptInvite({ id: stranger.userId }, token)).rejects.toMatchObject({
      code: 'INVITE_WRONG_ACCOUNT',
    });
    expect(await memberRowFor(teamId, stranger.userId)).toBeNull();
  });

  it('matches the invited address after the repository canonical normalisation', async () => {
    const { owner, teamId, roleIdFor } = await seedWorkspace();
    // The account is stored lowercase; the invitation is typed with padding and
    // capitals. They are the same person.
    const invitee = await seedUser({ email: 'mixed.case@example.com' });
    const { token } = await inviteAndCaptureToken({
      actorId: owner.userId,
      email: '  Mixed.Case@Example.COM ',
      roleId: await roleIdFor('member'),
    });
    const svc = await service();

    const result = await svc.acceptInvite({ id: invitee.userId }, token);
    expect(result.accepted).toBe(true);
    expect(await memberRowFor(teamId, invitee.userId)).not.toBeNull();
  });

  it('prevents a duplicate pending invitation, in the service and in the index', async () => {
    const { owner, teamId, roleIdFor } = await seedWorkspace();
    const roleId = await roleIdFor('member');
    const svc = await service();
    await inviteAndCaptureToken({ actorId: owner.userId, email: 'dupe@example.com', roleId });

    await expect(
      svc.createInvite(
        { id: owner.userId, role: 'business' },
        { email: 'DUPE@example.com', roleId },
      ),
    ).rejects.toMatchObject({ code: 'INVITE_ALREADY_PENDING' });

    // The partial unique index refuses the same thing written directly.
    await expect(
      pool.query(
        `INSERT INTO business_team_invites (team_id, email, role_id, token_hash)
         VALUES ($1, 'Dupe@Example.com', $2, repeat('a', 64))`,
        [teamId, roleId],
      ),
    ).rejects.toMatchObject({ code: '23505' });

    expect(
      await countRows(
        pool,
        `SELECT count(*)::text c FROM business_team_invites WHERE team_id = $1`,
        [teamId],
      ),
    ).toBe(1);
  });

  it('allows a re-invite once the previous one has run out', async () => {
    const { owner, roleIdFor } = await seedWorkspace();
    const roleId = await roleIdFor('member');
    const first = await inviteAndCaptureToken({
      actorId: owner.userId,
      email: 'again@example.com',
      roleId,
    });
    await pool.query(
      `UPDATE business_team_invites
          SET created_at = now() - INTERVAL '10 days', expires_at = now() - INTERVAL '3 days'
        WHERE id = $1`,
      [first.inviteId],
    );

    const second = await inviteAndCaptureToken({
      actorId: owner.userId,
      email: 'again@example.com',
      roleId,
    });
    expect(second.inviteId).not.toBe(first.inviteId);

    const { rows } = await pool.query<{ id: string; status: string }>(
      `SELECT id, status FROM business_team_invites ORDER BY created_at`,
    );
    // The stale one is retired rather than deleted, so the history survives.
    expect(rows.find((r) => r.id === first.inviteId)?.status).toBe('expired');
    expect(rows.find((r) => r.id === second.inviteId)?.status).toBe('pending');
  });

  it('refuses to invite somebody who is already a member', async () => {
    const { owner, teamId, roleIdFor } = await seedWorkspace();
    const roleId = await roleIdFor('member');
    const existing = await seedUser({ email: 'already@example.com' });
    await pool.query(
      `INSERT INTO business_members (team_id, user_id, role_id) VALUES ($1, $2, $3)`,
      [teamId, existing.userId, roleId],
    );

    const svc = await service();
    await expect(
      svc.createInvite({ id: owner.userId, role: 'business' }, { email: existing.email, roleId }),
    ).rejects.toMatchObject({ code: 'ALREADY_A_MEMBER' });

    expect(
      await countRows(pool, `SELECT count(*)::text c FROM business_members WHERE team_id = $1`, [
        teamId,
      ]),
    ).toBe(2);
  });

  it('preserves the invitation role_id rather than defaulting to member', async () => {
    const { owner, teamId, roleIdFor } = await seedWorkspace();
    const adminRoleId = await roleIdFor('manager');
    const invitee = await seedUser({ email: 'future-admin@example.com' });
    const { token } = await inviteAndCaptureToken({
      actorId: owner.userId,
      email: invitee.email,
      roleId: adminRoleId,
    });

    const svc = await service();
    const result = await svc.acceptInvite({ id: invitee.userId }, token);

    const row = await memberRowFor(teamId, invitee.userId);
    expect(row!.role_id).toBe(adminRoleId);
    // The derived tier follows the role, which the old hard-coded 'member' did not.
    expect(row!.role).toBe('manager');
    expect(result.tier).toBe('admin');

    const { rows } = await pool.query<{ role_id: string; accepted_member_id: string | null }>(
      `SELECT role_id, accepted_member_id FROM business_team_invites WHERE token_hash = $1`,
      [createHash('sha256').update(token, 'utf8').digest('hex')],
    );
    expect(rows[0]!.role_id).toBe(adminRoleId);
    expect(rows[0]!.accepted_member_id).toBe(row!.id);
  });

  it('refuses an invitation that would hand out Owner directly', async () => {
    const { owner, roleIdFor } = await seedWorkspace();
    const svc = await service();
    await expect(
      svc.createInvite(
        { id: owner.userId, role: 'business' },
        { email: 'usurper@example.com', roleId: await roleIdFor('owner') },
      ),
    ).rejects.toMatchObject({ code: 'OWNER_ROLE_NOT_ASSIGNABLE' });
  });

  it('creates one membership when ten accepts arrive at once', async () => {
    const { owner, teamId, roleIdFor } = await seedWorkspace();
    const invitee = await seedUser({ email: 'racer@example.com' });
    const { token } = await inviteAndCaptureToken({
      actorId: owner.userId,
      email: invitee.email,
      roleId: await roleIdFor('member'),
    });
    const svc = await service();

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => svc.acceptInvite({ id: invitee.userId }, token)),
    );

    // Every one of them succeeds — a second click by the invited person is not
    // an error — but exactly one created the membership.
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(10);
    const created = fulfilled.filter(
      (r) => (r as PromiseFulfilledResult<{ created: boolean }>).value.created,
    );
    expect(created).toHaveLength(1);

    expect(
      await countRows(
        pool,
        `SELECT count(*)::text c FROM business_members WHERE team_id = $1 AND user_id = $2`,
        [teamId, invitee.userId],
      ),
    ).toBe(1);
    const { rows } = await pool.query<{ status: string; accepted_at: Date | null }>(
      `SELECT status, accepted_at FROM business_team_invites WHERE token_hash = $1`,
      [createHash('sha256').update(token, 'utf8').digest('hex')],
    );
    expect(rows[0]!.status).toBe('accepted');
    expect(rows[0]!.accepted_at).not.toBeNull();
  }, 180_000);

  it('resolves accept against revoke deterministically, one way or the other', async () => {
    const { owner, teamId, roleIdFor } = await seedWorkspace();
    const svc = await service();

    // Run the race repeatedly: whichever side wins, the two outcomes must stay
    // consistent with each other. A revoked invitation never leaves a
    // membership, and an accepted one is never quietly revoked afterwards.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await pool.query(`DELETE FROM business_team_invites`);
      await pool.query(`DELETE FROM business_members WHERE role <> 'owner'`);
      const invitee = await seedUser({ email: `race${attempt}-${Date.now()}@example.com` });
      const { token, inviteId } = await inviteAndCaptureToken({
        actorId: owner.userId,
        email: invitee.email,
        roleId: await roleIdFor('member'),
      });

      const [accept, revoke] = await Promise.allSettled([
        svc.acceptInvite({ id: invitee.userId }, token),
        svc.revokeInvite({ id: owner.userId, role: 'business' }, inviteId),
      ]);

      const { rows } = await pool.query<{ status: string }>(
        `SELECT status FROM business_team_invites WHERE id = $1`,
        [inviteId],
      );
      const status = rows[0]!.status;
      const membership = await memberRowFor(teamId, invitee.userId);

      if (status === 'accepted') {
        expect(accept.status).toBe('fulfilled');
        expect(membership).not.toBeNull();
        // The revoke either lost the race outright or was told the invitation
        // had already been accepted. It never silently reverses a membership.
        if (revoke.status === 'rejected') {
          expect(revoke.reason).toMatchObject({ code: 'INVITE_ALREADY_ACCEPTED' });
        }
      } else {
        expect(status).toBe('revoked');
        expect(membership).toBeNull();
        expect(accept.status).toBe('rejected');
        expect((accept as PromiseRejectedResult).reason).toMatchObject({ code: 'INVITE_REVOKED' });
      }
    }
  }, 300_000);

  it('is idempotent on revoke and leaves an accepted membership alone', async () => {
    const { owner, roleIdFor } = await seedWorkspace();
    const svc = await service();
    const actor = { id: owner.userId, role: 'business' };
    const { inviteId } = await inviteAndCaptureToken({
      actorId: owner.userId,
      email: 'twice@example.com',
      roleId: await roleIdFor('member'),
    });

    await svc.revokeInvite(actor, inviteId);
    // The caller's intent is already the state of the world.
    await expect(svc.revokeInvite(actor, inviteId)).resolves.toBeDefined();

    const { rows } = await pool.query<{ status: string; revoked_at: Date | null }>(
      `SELECT status, revoked_at FROM business_team_invites WHERE id = $1`,
      [inviteId],
    );
    expect(rows[0]!.status).toBe('revoked');
    expect(rows[0]!.revoked_at).not.toBeNull();
  });

  it('rejects an expiry that is backwards or unbounded', async () => {
    const { teamId, roleIdFor } = await seedWorkspace();
    const roleId = await roleIdFor('member');
    for (const expires of ["now() - INTERVAL '1 day'", "now() + INTERVAL '400 days'"]) {
      await expect(
        pool.query(
          `INSERT INTO business_team_invites (team_id, email, role_id, token_hash, expires_at)
           VALUES ($1, 'shape@example.com', $2, repeat('b', 64), ${expires})`,
          [teamId, roleId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    }
  });
});

// ===========================================================================
// Membership and ownership.
// ===========================================================================

describe.skipIf(!pgIntegrationEnabled())('membership and ownership', () => {
  const withAdminAndMember = async () => {
    const workspace = await seedWorkspace();
    const admin = await seedUser({ role: 'expert' });
    const member = await seedUser({ role: 'craftsman' });
    await pool.query(
      `INSERT INTO business_members (team_id, user_id, role_id) VALUES ($1, $2, $3), ($1, $4, $5)`,
      [
        workspace.teamId,
        admin.userId,
        await workspace.roleIdFor('manager'),
        member.userId,
        await workspace.roleIdFor('member'),
      ],
    );
    return { ...workspace, admin, member };
  };

  it('enforces at most one owner per workspace at the index level', async () => {
    const { teamId, roleIdFor } = await seedWorkspace();
    const other = await seedUser({ role: 'expert' });
    await expect(
      pool.query(`INSERT INTO business_members (team_id, user_id, role_id) VALUES ($1, $2, $3)`, [
        teamId,
        other.userId,
        await roleIdFor('owner'),
      ]),
    ).rejects.toMatchObject({ code: '23505' });
    expect(await ownerCount(teamId)).toBe(1);
  });

  it('refuses to remove the owner', async () => {
    const { owner, teamId, admin } = await withAdminAndMember();
    const svc = await service();
    const ownerMember = await memberRowFor(teamId, owner.userId);

    for (const actor of [
      { id: owner.userId, role: 'business' },
      { id: admin.userId, role: 'expert' },
    ]) {
      await expect(svc.removeMember(actor, ownerMember!.id)).rejects.toMatchObject({
        code: 'OWNER_CANNOT_BE_REMOVED',
      });
    }
    expect(await ownerCount(teamId)).toBe(1);
  });

  it('refuses to demote the owner through the member-role endpoint', async () => {
    const { owner, teamId, roleIdFor } = await withAdminAndMember();
    const svc = await service();
    const ownerMember = await memberRowFor(teamId, owner.userId);

    await expect(
      svc.updateMemberRole({ id: owner.userId, role: 'business' }, ownerMember!.id, {
        roleId: await roleIdFor('member'),
      }),
    ).rejects.toMatchObject({ code: 'OWNER_ROLE_IMMUTABLE' });
    expect((await memberRowFor(teamId, owner.userId))!.role).toBe('owner');
  });

  it('refuses an admin granting Owner to anyone, including themselves', async () => {
    const { teamId, admin, member, roleIdFor } = await withAdminAndMember();
    const svc = await service();
    const actor = { id: admin.userId, role: 'expert' };
    const adminMember = await memberRowFor(teamId, admin.userId);
    const memberRow = await memberRowFor(teamId, member.userId);

    for (const target of [adminMember!.id, memberRow!.id]) {
      await expect(
        svc.updateMemberRole(actor, target, { roleId: await roleIdFor('owner') }),
      ).rejects.toMatchObject({ code: 'OWNER_ROLE_NOT_ASSIGNABLE' });
    }
    expect(await ownerCount(teamId)).toBe(1);
  });

  it('keeps the historical record when a member is removed', async () => {
    const { owner, teamId, roleIdFor } = await seedWorkspace();
    const svc = await service();
    const invitee = await seedUser({ email: 'history@example.com' });
    const { token, inviteId } = await inviteAndCaptureToken({
      actorId: owner.userId,
      email: invitee.email,
      roleId: await roleIdFor('member'),
    });
    await svc.acceptInvite({ id: invitee.userId }, token);
    const memberRow = await memberRowFor(teamId, invitee.userId);

    await svc.removeMember({ id: owner.userId, role: 'business' }, memberRow!.id);

    // Access is gone.
    expect(await memberRowFor(teamId, invitee.userId)).toBeNull();

    // The record of what happened is not.
    const { rows: invite } = await pool.query<{
      status: string;
      accepted_at: Date | null;
      accepted_by: string | null;
      accepted_member_id: string | null;
    }>(
      `SELECT status, accepted_at, accepted_by, accepted_member_id
         FROM business_team_invites WHERE id = $1`,
      [inviteId],
    );
    expect(invite[0]!.status).toBe('accepted');
    expect(invite[0]!.accepted_at).not.toBeNull();
    expect(invite[0]!.accepted_by).toBe(invitee.userId);
    // The link to the deleted membership is cleared rather than cascading the
    // invitation away with it.
    expect(invite[0]!.accepted_member_id).toBeNull();

    const { rows: audit } = await pool.query<{ action: string }>(
      `SELECT action FROM business_team_audit_log WHERE team_id = $1 ORDER BY created_at`,
      [teamId],
    );
    expect(audit.map((a) => a.action)).toEqual([
      // First access created the workspace, and that is history too.
      'business_team.workspace.provision',
      'business_team.invite.create',
      'business_team.invite.accept',
      'business_team.member.remove',
    ]);
    // And the account itself is untouched.
    const { rows: user } = await pool.query<{ is_active: boolean; primary_role: string }>(
      `SELECT is_active, primary_role FROM users WHERE id = $1`,
      [invitee.userId],
    );
    expect(user[0]!.is_active).toBe(true);
  });

  it('refuses every ownership transfer, and changes nothing when it does', async () => {
    const { owner, teamId, member } = await withAdminAndMember();
    const svc = await service();
    const memberRow = await memberRowFor(teamId, member.userId);
    const { rows: team } = await pool.query<{ name: string; business_id: string }>(
      `SELECT name, business_id FROM business_teams WHERE id = $1`,
      [teamId],
    );

    // Even the current owner, with the exact confirmation the old contract
    // required. Moving the Owner membership would move team administration
    // while every service, job, advertisement and ledger row stayed with the
    // original account, so the operation does not exist.
    await expect(
      svc.transferOwnership(
        { id: owner.userId, role: 'business' },
        { memberId: memberRow!.id, confirmation: team[0]!.name },
      ),
    ).rejects.toMatchObject({ code: 'OWNERSHIP_TRANSFER_NOT_AVAILABLE' });

    // Nothing moved, and nothing was recorded as having been attempted.
    expect((await memberRowFor(teamId, owner.userId))!.role).toBe('owner');
    expect((await memberRowFor(teamId, member.userId))!.role).toBe('member');
    expect(await ownerCount(teamId)).toBe(1);
    const { rows: after } = await pool.query<{ business_id: string }>(
      `SELECT business_id FROM business_teams WHERE id = $1`,
      [teamId],
    );
    expect(after[0]!.business_id).toBe(team[0]!.business_id);
    expect(
      await countRows(
        pool,
        `SELECT count(*)::text c FROM business_team_audit_log
          WHERE team_id = $1 AND action LIKE '%ownership%'`,
        [teamId],
      ),
    ).toBe(0);
  });

  it('never reports ownership transfer as an allowed action, even to the owner', async () => {
    const { owner } = await withAdminAndMember();
    const svc = await service();
    const overview = await svc.getOverview({ id: owner.userId, role: 'business' });

    expect(overview.viewer.isOwner).toBe(true);
    expect(overview.viewer.allowedActions.transferOwnership).toBe(false);
  });

  it('refuses to move the workspace billing identity, whatever writes the update', async () => {
    const { teamId } = await seedWorkspace();
    const other = await seedUser({ role: 'business' });
    await expect(
      pool.query(`UPDATE business_teams SET business_id = $2 WHERE id = $1`, [
        teamId,
        other.userId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

// ===========================================================================
// Migration forward and rollback.
// ===========================================================================
// The rollback text is the one documented in the migration header; if the two
// drift, this fails.

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

describe.skipIf(!pgIntegrationEnabled())('migration forward and rollback', () => {
  it('builds every invariant from nothing', async () => {
    const copy = await createScratchDatabase('bizfwd');
    try {
      const { rows } = await copy.pool.query<{ name: string; present: boolean }>(
        `SELECT 'uq_business_teams_business_id' AS name,
                to_regclass('public.uq_business_teams_business_id') IS NOT NULL AS present
         UNION ALL
         SELECT 'uq_business_members_single_owner',
                to_regclass('public.uq_business_members_single_owner') IS NOT NULL
         UNION ALL
         SELECT 'uq_business_team_invites_pending_email',
                to_regclass('public.uq_business_team_invites_pending_email') IS NOT NULL
         UNION ALL
         SELECT 'business_members_resolve_tier',
                to_regprocedure('public.business_members_resolve_tier()') IS NOT NULL
         UNION ALL
         SELECT 'business_teams_reject_business_id_change',
                to_regprocedure('public.business_teams_reject_business_id_change()') IS NOT NULL
         UNION ALL
         SELECT 'business_workspace_assert_one_owner',
                to_regprocedure('public.business_workspace_assert_one_owner()') IS NOT NULL
         UNION ALL
         SELECT 'users_protect_workspace_owner_role',
                to_regprocedure('public.users_protect_workspace_owner_role()') IS NOT NULL`,
      );
      for (const row of rows) expect([row.name, row.present]).toEqual([row.name, true]);

      const { rows: columns } = await copy.pool.query<{ n: string }>(
        `SELECT count(*)::text n FROM information_schema.columns
          WHERE table_schema = 'public'
            AND ((table_name = 'business_team_invites'
                  AND column_name IN ('accepted_by','accepted_member_id','revoked_at',
                                      'revoked_by','role_name_snapshot'))
              OR (table_name = 'business_team_roles' AND column_name = 'is_legacy'))`,
      );
      expect(columns[0]!.n).toBe('6');

      // The deferred constraint triggers are the whole point of the lower
      // owner bound, so their DEFERRABLE INITIALLY DEFERRED timing is asserted
      // rather than assumed: an immediate one would reject a workspace between
      // its own INSERT and its owner's.
      const { rows: deferred } = await copy.pool.query<{ tgname: string; deferred: boolean }>(
        `SELECT tgname, tgdeferrable AND tginitdeferred AS deferred
           FROM pg_trigger
          WHERE tgname IN ('trg_business_members_owner_present',
                           'trg_business_teams_owner_present')`,
      );
      expect(deferred).toHaveLength(2);
      for (const row of deferred) expect([row.tgname, row.deferred]).toEqual([row.tgname, true]);
    } finally {
      await copy.drop();
    }
  }, 900_000);

  it('reverses to the exact fingerprint it started from, twice over', async () => {
    const copy = await createScratchDatabase('bizback');
    const fingerprint = async () => {
      const { rows } = await copy.pool.query<{ kind: string; sig: string }>(
        // Every branch casts to text explicitly. `information_schema.table_name`
        // is a domain over `name`, so without the casts the UNION adopts `name`
        // as its result type and silently truncates every signature at 63
        // characters — long enough to hide exactly the constraint names this
        // migration adds.
        `SELECT 'table' AS kind, table_name::text AS sig
           FROM information_schema.tables WHERE table_schema = 'public'
         UNION ALL
         SELECT 'column', table_name::text || '.' || column_name::text
           FROM information_schema.columns WHERE table_schema = 'public'
         UNION ALL
         SELECT 'constraint', conrelid::regclass::text || '::' || conname::text
           FROM pg_constraint WHERE connamespace = 'public'::regnamespace
         UNION ALL
         SELECT 'index', tablename::text || '.' || indexname::text
           FROM pg_indexes WHERE schemaname = 'public'
         UNION ALL
         SELECT 'trigger', event_object_table::text || '.' || trigger_name::text
           FROM information_schema.triggers WHERE trigger_schema = 'public'
         ORDER BY 1, 2`,
      );
      return new Set(rows.map((r) => `${r.kind}:${r.sig}`));
    };

    try {
      const before = await fingerprint();
      expect(before.has('index:business_teams.uq_business_teams_business_id')).toBe(true);
      expect(before.has('index:business_members.uq_business_members_single_owner')).toBe(true);
      expect(before.has('column:business_team_roles.is_legacy')).toBe(true);
      expect(before.has('column:business_team_invites.role_name_snapshot')).toBe(true);
      expect(before.has('trigger:business_members.trg_business_members_resolve_tier')).toBe(true);
      expect(before.has('trigger:business_members.trg_business_members_owner_present')).toBe(true);
      expect(before.has('trigger:users.trg_users_protect_workspace_owner_role')).toBe(true);

      // Idempotent: the documented sequence runs twice with the same result.
      await copy.exec(ROLLBACK_SQL);
      await copy.exec(ROLLBACK_SQL);

      const after = await fingerprint();
      expect(after.has('index:business_teams.uq_business_teams_business_id')).toBe(false);
      expect(after.has('index:business_members.uq_business_members_single_owner')).toBe(false);
      expect(after.has('column:business_team_roles.is_legacy')).toBe(false);
      expect(after.has('column:business_team_invites.role_name_snapshot')).toBe(false);
      expect(after.has('trigger:business_members.trg_business_members_resolve_tier')).toBe(false);
      expect(after.has('trigger:business_members.trg_business_members_owner_present')).toBe(false);
      expect(after.has('trigger:users.trg_users_protect_workspace_owner_role')).toBe(false);

      // Nothing appeared, and everything that disappeared belongs to THIS
      // migration. Asserted as an exact set, so a casualty fails here.
      expect([...after].filter((k) => !before.has(k))).toEqual([]);

      const removed = [...before].filter((k) => !after.has(k)).sort();
      const foreign = removed.filter(
        (k) =>
          !/uq_business_teams_business_id/.test(k) &&
          !/trg_business_members_owner_present/.test(k) &&
          !/trg_business_teams_owner_present/.test(k) &&
          !/trg_users_protect_workspace_owner_role/.test(k) &&
          !/business_team_invites\.role_name_snapshot/.test(k) &&
          !/uq_business_members_single_owner/.test(k) &&
          !/uq_business_team_invites_pending_email/.test(k) &&
          !/idx_business_team_invites_token_hash/.test(k) &&
          !/trg_business_members_resolve_tier/.test(k) &&
          !/trg_business_teams_immutable_business/.test(k) &&
          !/chk_business_team_invites_(token_hash_shape|expiry_shape|accepted_shape|revoked_shape)/.test(
            k,
          ) &&
          !/business_team_invites\.(accepted_by|accepted_member_id|revoked_at|revoked_by)/.test(
            k,
          ) &&
          !/business_team_roles\.is_legacy/.test(k) &&
          // Dropping `accepted_by`, `revoked_by` and `accepted_member_id` takes
          // their foreign keys with them, which is the only way to remove them.
          !/business_team_invites_(accepted_by|revoked_by|accepted_member_id)_fkey/.test(k),
      );
      expect(foreign).toEqual([]);

      // Everything the earlier waves built is still standing.
      for (const table of [
        'business_teams',
        'business_members',
        'business_team_roles',
        'business_team_invites',
        'business_team_audit_log',
      ]) {
        expect(after.has(`table:${table}`)).toBe(true);
      }
      // Including the pre-existing membership uniqueness this migration never
      // touched.
      expect(after.has('index:business_members.business_members_team_id_user_id_key')).toBe(true);

      // Financial and activation tables are exactly where they were.
      const { rows: survivors } = await copy.pool.query<{ t: string | null; name: string }>(
        `SELECT name, to_regclass('public.' || name)::text AS t
           FROM unnest(ARRAY[
             'transactions','mhc_action_charges','mhc_job_activations','wallets',
             'advertisements','advertisement_campaign_periods','advertisement_renewal_events',
             'plan_subscriptions','notifications','provider_payment_disclosures'
           ]) AS name`,
      );
      for (const row of survivors) expect(row.t).toBe(row.name);
    } finally {
      await copy.drop();
    }
  }, 900_000);
});
