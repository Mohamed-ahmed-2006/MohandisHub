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
    expect(service.createInvite).toHaveBeenCalledWith(expect.anything(), {
      email: 'Mixed.Case@Example.COM',
      roleId: UUID,
    });
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

  it('requires the workspace name for a transfer', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/business-teams/transfer-ownership')
      .set('Authorization', bearer())
      .send({ memberId: UUID });
    const body = response.body as ApiErrorBody;

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(service.transferOwnership).not.toHaveBeenCalled();
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
