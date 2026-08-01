import type { ApiErrorBody } from '@mohandishub/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Business workspace routes — the HTTP surface.
// ---------------------------------------------------------------------------
// The row-level and concurrency behaviour is proved against a real PostgreSQL in
// `business-teams.workspace.pg.test.ts`. What is proved HERE is everything that
// only exists at the edge: which routes need a session, which error code and
// status each refusal carries, that a malformed identifier is a clean answer
// rather than a database cast error surfacing as a 500, and — the one that
// matters most for Wave 2H — that the invitation token never reaches a log line.
// ---------------------------------------------------------------------------

vi.mock('../modules/settings/settings.repository.js', () => ({
  SettingsRepository: vi.fn(function SettingsRepositoryMock() {
    return { get: vi.fn().mockResolvedValue(null) };
  }),
}));

const service = vi.hoisted(() => ({
  previewInvite: vi.fn(),
  getOverview: vi.fn(),
  listWorkspaces: vi.fn(),
  createInvite: vi.fn(),
  acceptInvite: vi.fn(),
  revokeInvite: vi.fn(),
  updateMemberRole: vi.fn(),
  removeMember: vi.fn(),
  transferOwnership: vi.fn(),
  createRole: vi.fn(),
  updateRole: vi.fn(),
  deleteRole: vi.fn(),
}));

vi.mock('../modules/business-teams/business-teams.service.js', () => service);

// `hasDatabaseConfig: false` is what makes `authenticate` trust the token's own
// claims instead of re-reading the account, which is exactly what this suite
// wants: the identity is a given, the routing and refusals are the subject. A
// pool object still has to exist because several unrelated modules call
// `getPool()` while the app is being constructed; every query through it fails
// loudly, so a route that reaches the database here is a failure rather than a
// silent pass.
vi.mock('../db/pool.js', () => ({
  hasDatabaseConfig: () => false,
  getPool: () => ({
    query: () => Promise.reject(new Error('The route suite must not touch a database.')),
    connect: () => Promise.reject(new Error('The route suite must not touch a database.')),
    on: () => undefined,
  }),
}));

import { createApp } from '../app.js';
import { signAccessToken } from '../config/jwt.js';
import { logger } from '../config/logger.js';
import { HttpError } from '../utils/http-error.js';

const bearer = (overrides: Record<string, unknown> = {}): string =>
  `Bearer ${signAccessToken({
    sub: '11111111-1111-4111-8111-111111111111',
    role: 'expert',
    isAdmin: false,
    verified: true,
    emailVerified: true,
    ...overrides,
  } as never)}`;

const UUID = '22222222-2222-4222-8222-222222222222';

/**
 * The workspace selector a handler passed on.
 *
 * The signatures differ — some take a body, some an id, some both — but the
 * selector is always the last argument, which is the thing being asserted.
 */
const trailingTeamArg = (fn: { mock: { calls: unknown[][] } }): unknown => {
  const call = fn.mock.calls[0] ?? [];
  return call[call.length - 1];
};

beforeEach(() => {
  for (const fn of Object.values(service)) fn.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('business team route authorization', () => {
  it.each([
    ['get', '/api/business-teams/me'],
    ['post', '/api/business-teams/invites'],
    ['post', '/api/business-teams/invites/accept'],
    ['post', `/api/business-teams/invites/${UUID}/revoke`],
    ['patch', `/api/business-teams/members/${UUID}`],
    ['delete', `/api/business-teams/members/${UUID}`],
    ['post', '/api/business-teams/transfer-ownership'],
    ['post', '/api/business-teams/roles'],
  ] as const)(
    'refuses %s %s without a session',
    async (method, path) => {
      const app = createApp();
      const response = await request(app)[method](path).send({});
      const body = response.body as ApiErrorBody;

      expect(response.status).toBe(401);
      expect(body.error.code).toBe('UNAUTHORIZED');
    },
    15_000,
  );

  it('does not require a business primary account role', async () => {
    // Workspace membership is independent of the account someone signed up
    // with. An invited expert reaching /me must get as far as the resolver.
    service.getOverview.mockResolvedValue({ team: { id: 't' } });
    const app = createApp();

    const response = await request(app)
      .get('/api/business-teams/me')
      .set('Authorization', bearer({ role: 'expert' }));

    expect(response.status).toBe(200);
    expect(service.getOverview).toHaveBeenCalledWith(
      expect.objectContaining({ id: '11111111-1111-4111-8111-111111111111', role: 'expert' }),
      undefined,
    );
  }, 15_000);

  it.each([
    ['NO_BUSINESS_WORKSPACE', 403],
    ['WORKSPACE_ADMIN_REQUIRED', 403],
    ['WORKSPACE_OWNER_REQUIRED', 403],
  ] as const)(
    'passes the %s refusal through with status %i',
    async (code, statusCode) => {
      service.removeMember.mockRejectedValue(
        new HttpError({ statusCode, code, message: 'Refused.' }),
      );
      const app = createApp();

      const response = await request(app)
        .delete(`/api/business-teams/members/${UUID}`)
        .set('Authorization', bearer());
      const body = response.body as ApiErrorBody;

      expect(response.status).toBe(statusCode);
      expect(body.error.code).toBe(code);
    },
    15_000,
  );

  it('answers a malformed member id without reaching the service', async () => {
    const app = createApp();

    const response = await request(app)
      .delete('/api/business-teams/members/not-a-uuid')
      .set('Authorization', bearer());
    const body = response.body as ApiErrorBody;

    expect(response.status).toBe(404);
    expect(body.error.code).toBe('MEMBER_NOT_FOUND');
    expect(service.removeMember).not.toHaveBeenCalled();
  }, 15_000);
});

describe('invitation route validation', () => {
  it('rejects an invite with a bad email or a non-uuid role', async () => {
    const app = createApp();

    for (const payload of [
      { email: 'not-an-email', roleId: UUID },
      { email: 'ok@example.com', roleId: 'nope' },
      {},
    ]) {
      const response = await request(app)
        .post('/api/business-teams/invites')
        .set('Authorization', bearer())
        .send(payload);
      const body = response.body as ApiErrorBody;

      expect(response.status).toBe(400);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(service.createInvite).not.toHaveBeenCalled();
  }, 15_000);

  it('normalises nothing on the way in — the service owns the canonical form', async () => {
    service.createInvite.mockResolvedValue({ team: { id: 't' } });
    const app = createApp();

    await request(app)
      .post('/api/business-teams/invites')
      .set('Authorization', bearer())
      .send({ email: '  Mixed.Case@Example.COM  ', roleId: UUID });

    // zod trims; lowercasing is the repository's canonical rule and belongs with
    // the comparison that uses it, not in two places.
    expect(service.createInvite).toHaveBeenCalledWith(
      expect.anything(),
      { email: 'Mixed.Case@Example.COM', roleId: UUID },
      undefined,
    );
  }, 15_000);

  it('rejects a token that is not in the issued alphabet', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/business-teams/invites/accept')
      .set('Authorization', bearer())
      .send({ token: 'short' });

    expect(response.status).toBe(400);
    expect(service.acceptInvite).not.toHaveBeenCalled();
  }, 15_000);

  it('does not validate a transfer body, because no body makes it succeed', async () => {
    // Validating the input would imply there is a correct input. There is not.
    service.transferOwnership.mockRejectedValue(
      new HttpError({
        statusCode: 409,
        code: 'OWNERSHIP_TRANSFER_NOT_AVAILABLE',
        message: 'Workspace ownership transfer is not available.',
      }),
    );
    const app = createApp();

    const response = await request(app)
      .post('/api/business-teams/transfer-ownership')
      .set('Authorization', bearer())
      .send({ memberId: UUID });
    const body = response.body as ApiErrorBody;

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('OWNERSHIP_TRANSFER_NOT_AVAILABLE');
  }, 15_000);
});

describe('invitation preview route', () => {
  it('is reachable without a session, because the recipient may have no account', async () => {
    service.previewInvite.mockResolvedValue({ state: 'valid' });
    const app = createApp();

    const response = await request(app).get(
      '/api/business-teams/invites/preview?token=abcdefghijklmnopqrstuvwxyz',
    );

    expect(response.status).toBe(200);
    expect(service.previewInvite).toHaveBeenCalledWith({
      token: 'abcdefghijklmnopqrstuvwxyz',
      viewerId: undefined,
    });
  }, 15_000);

  it('treats an expired session as an anonymous visitor rather than a 401', async () => {
    service.previewInvite.mockResolvedValue({ state: 'valid' });
    const app = createApp();

    const response = await request(app)
      .get('/api/business-teams/invites/preview?token=abcdefghijklmnopqrstuvwxyz')
      .set('Authorization', 'Bearer not-a-real-token');

    expect(response.status).toBe(200);
    expect(service.previewInvite).toHaveBeenCalledWith(
      expect.objectContaining({ viewerId: undefined }),
    );
  }, 15_000);

  it('answers a malformed token the same way as an unknown one', async () => {
    const app = createApp();

    const response = await request(app).get('/api/business-teams/invites/preview?token=nope');
    const body = response.body as { ok: boolean; data: { state: string; teamName: null } };

    // 200 with `malformed`, not a 400: the shape of the answer must not confirm
    // that a token exists.
    expect(response.status).toBe(200);
    expect(body.data.state).toBe('malformed');
    expect(body.data.teamName).toBeNull();
    expect(service.previewInvite).not.toHaveBeenCalled();
  }, 15_000);

  it('answers a missing token the same way', async () => {
    const app = createApp();

    const response = await request(app).get('/api/business-teams/invites/preview');
    const body = response.body as { data: { state: string } };

    expect(response.status).toBe(200);
    expect(body.data.state).toBe('malformed');
  }, 15_000);
});

describe('invitation token confidentiality', () => {
  it('never writes the token to a log line, on success or on failure', async () => {
    const token = 'Zm9vYmFyLWJhei1xdXV4LTAxMjM0NTY3ODlfLQ';
    const lines: string[] = [];
    // Every level the logger exposes, so a token written at any of them fails
    // this test rather than only the ones anticipated here.
    for (const level of ['info', 'warn', 'error'] as const) {
      vi.spyOn(logger, level).mockImplementation(
        (message: string, meta?: Record<string, unknown>) => {
          lines.push(`${message} ${JSON.stringify(meta ?? {})}`);
        },
      );
    }

    service.previewInvite.mockResolvedValue({ state: 'valid' });
    service.acceptInvite.mockRejectedValue(
      new HttpError({
        statusCode: 410,
        code: 'INVITE_EXPIRED',
        message: 'This invitation has expired.',
      }),
    );
    const app = createApp();

    // The token in a query string, which is where the emailed link puts it...
    await request(app).get(`/api/business-teams/invites/preview?token=${token}`);
    // ...and in a body, on a request that fails.
    const failed = await request(app)
      .post('/api/business-teams/invites/accept')
      .set('Authorization', bearer())
      .send({ token });

    expect(failed.status).toBe(410);
    // Request logging happens on the response's `finish` event, which fires
    // after supertest resolves. Give the loop a turn so the lines exist.
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain(token);
      // Not the token under another name either: the query string is never
      // logged, so `token=` cannot appear at all.
      expect(line).not.toContain('token=');
    }
    // Both requests WERE logged, which is what makes the absence above
    // meaningful rather than the whole thing quietly going unrecorded. The path
    // is there; the query string it was carrying is not.
    expect(lines.filter((l) => l.startsWith('request '))).toHaveLength(2);
    expect(lines.some((l) => l.includes('invites/preview'))).toBe(true);
    expect(lines.some((l) => l.includes('invites/accept'))).toBe(true);
  }, 15_000);

  it('keeps the token out of the error body as well', async () => {
    const token = 'Zm9vYmFyLWJhei1xdXV4LTAxMjM0NTY3ODlfLQ';
    service.acceptInvite.mockRejectedValue(
      new HttpError({ statusCode: 403, code: 'INVITE_WRONG_ACCOUNT', message: 'Wrong account.' }),
    );
    const app = createApp();

    const response = await request(app)
      .post('/api/business-teams/invites/accept')
      .set('Authorization', bearer())
      .send({ token });

    expect(JSON.stringify(response.body)).not.toContain(token);
  }, 15_000);
});

describe('ownership transfer is disabled', () => {
  it('still answers, and always with the same stable code', async () => {
    service.transferOwnership.mockRejectedValue(
      new HttpError({
        statusCode: 409,
        code: 'OWNERSHIP_TRANSFER_NOT_AVAILABLE',
        message: 'Workspace ownership transfer is not available.',
      }),
    );
    const app = createApp();

    // Every shape a client might send, including the one the old contract
    // documented. None of them is a transfer.
    for (const payload of [
      {},
      { memberId: UUID },
      { memberId: UUID, confirmation: 'Acme Corp' },
      { memberId: 'nonsense', confirmation: '' },
    ]) {
      const response = await request(app)
        .post('/api/business-teams/transfer-ownership')
        .set('Authorization', bearer())
        .send(payload);
      const body = response.body as ApiErrorBody;

      expect(response.status).toBe(409);
      expect(body.error.code).toBe('OWNERSHIP_TRANSFER_NOT_AVAILABLE');
    }
  }, 15_000);

  it('is not reachable without a session either', async () => {
    const app = createApp();
    const response = await request(app).post('/api/business-teams/transfer-ownership').send({});

    expect(response.status).toBe(401);
    expect(service.transferOwnership).not.toHaveBeenCalled();
  }, 15_000);
});

describe('workspace selection', () => {
  it('lists the workspaces this account can open', async () => {
    service.listWorkspaces.mockResolvedValue({ workspaces: [], defaultTeamId: null });
    const app = createApp();

    const response = await request(app)
      .get('/api/business-teams/workspaces')
      .set('Authorization', bearer({ role: 'craftsman' }));

    expect(response.status).toBe(200);
    // A craftsman, listed the same way a business account is: membership is the
    // credential and the account role is a separate fact.
    expect(service.listWorkspaces).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'craftsman' }),
    );
  }, 15_000);

  it('requires a session to list workspaces', async () => {
    const app = createApp();
    const response = await request(app).get('/api/business-teams/workspaces');

    expect(response.status).toBe(401);
  }, 15_000);

  it('passes a selected workspace through to every operation', async () => {
    const overview = { team: { id: 'team-2' } };
    service.getOverview.mockResolvedValue(overview);
    service.createInvite.mockResolvedValue(overview);
    service.revokeInvite.mockResolvedValue(overview);
    service.updateMemberRole.mockResolvedValue(overview);
    service.removeMember.mockResolvedValue(overview);
    const app = createApp();
    const team = '33333333-3333-4333-8333-333333333333';

    await request(app).get(`/api/business-teams/me?teamId=${team}`).set('Authorization', bearer());
    await request(app)
      .post(`/api/business-teams/invites?teamId=${team}`)
      .set('Authorization', bearer())
      .send({ email: 'a@b.com', roleId: UUID });
    await request(app)
      .post(`/api/business-teams/invites/${UUID}/revoke?teamId=${team}`)
      .set('Authorization', bearer());
    await request(app)
      .patch(`/api/business-teams/members/${UUID}?teamId=${team}`)
      .set('Authorization', bearer())
      .send({ roleId: UUID });
    await request(app)
      .delete(`/api/business-teams/members/${UUID}?teamId=${team}`)
      .set('Authorization', bearer());

    for (const fn of [
      service.getOverview,
      service.createInvite,
      service.revokeInvite,
      service.updateMemberRole,
      service.removeMember,
    ]) {
      expect(fn).toHaveBeenCalledTimes(1);
      expect(trailingTeamArg(fn)).toBe(team);
      // And the actor is still resolved from the session, never from the query.
      expect(fn.mock.calls[0]?.[0]).toMatchObject({ id: '11111111-1111-4111-8111-111111111111' });
    }
  }, 20_000);

  it('refuses a malformed workspace identifier the same way as an inaccessible one', async () => {
    const app = createApp();

    const response = await request(app)
      .get('/api/business-teams/me?teamId=not-a-uuid')
      .set('Authorization', bearer());
    const body = response.body as ApiErrorBody;

    // 403, not 400: whether a workspace identifier is well-formed is not
    // something this endpoint confirms.
    expect(response.status).toBe(403);
    expect(body.error.code).toBe('WORKSPACE_NOT_ACCESSIBLE');
    expect(service.getOverview).not.toHaveBeenCalled();
  }, 15_000);

  it('treats an empty selector as no selector', async () => {
    service.getOverview.mockResolvedValue({ team: { id: 't' } });
    const app = createApp();

    await request(app).get('/api/business-teams/me?teamId=').set('Authorization', bearer());

    expect(service.getOverview).toHaveBeenCalledWith(expect.anything(), undefined);
  }, 15_000);
});

describe('permissions offered to a role', () => {
  it('accepts only the permission the backend enforces', async () => {
    service.createRole.mockResolvedValue({ team: { id: 't' } });
    const app = createApp();

    const accepted = await request(app)
      .post('/api/business-teams/roles')
      .set('Authorization', bearer())
      .send({ name: 'Coordinator', permissions: ['manage_team'] });
    expect(accepted.status).toBe(201);

    // The six values the schema still stores are refused as INPUT, so a role
    // cannot be created advertising work the API will not do.
    for (const permission of [
      'manage_services',
      'manage_jobs',
      'manage_reservations',
      'view_wallet',
      'manage_support_disputes',
      'view_analytics',
    ]) {
      const response = await request(app)
        .post('/api/business-teams/roles')
        .set('Authorization', bearer())
        .send({ name: 'Coordinator', permissions: [permission] });
      const body = response.body as ApiErrorBody;

      expect(response.status).toBe(400);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    }
  }, 20_000);
});
