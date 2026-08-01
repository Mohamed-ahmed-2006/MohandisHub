// ---------------------------------------------------------------------------
// Unified Help & Resolution centre — real PostgreSQL, real HTTP.
// ---------------------------------------------------------------------------
// Everything this wave promises is a claim about ROWS AND AUTHORISATION:
// which case a stranger can reach, which file a counterparty can open, which
// status transition a client can force, and whether a ticket written five
// months ago still shows up correctly. A hand-written model of PostgreSQL
// cannot answer those — the sync triggers, the partial unique index that stops
// duplicate disputes, and the CHECK that keeps a safety report one-sided only
// exist in the server.
//
// So this runs against an actual server, through the actual express app, with
// actual JWTs. Requests go in over HTTP; nothing calls a service directly, so
// no test can accidentally skip a middleware that production runs.
//
// Opt-in:  RUN_PG_INTEGRATION=1 npm run test -w @mohandishub/api
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Express } from 'express';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { signAccessToken } from '../config/jwt.js';

import {
  createScratchDatabase,
  pgIntegrationEnabled,
  readMigration,
  type ScratchDatabase,
} from './support/pg-scratch.js';

let scratch: ScratchDatabase;
let pool: Pool;

vi.mock('../db/pool.js', () => ({
  getPool: () => pool,
  hasDatabaseConfig: () => true,
}));

// No real message leaves this suite. `config/env.ts` reads apps/api/.env, which
// on a developer machine names a live email provider, and case notifications
// fire on nearly every test below.
vi.mock('../utils/send-transactional-email.js', () => ({
  sendTransactionalEmail: () => Promise.resolve(),
}));
vi.mock('web-push', () => ({
  default: { setVapidDetails: () => {}, sendNotification: () => Promise.resolve() },
}));

vi.setConfig({ testTimeout: 300_000, hookTimeout: 1_800_000 });

// The local-storage branch of the private-upload route reads from
// `process.cwd()/uploads`, and vitest runs with cwd at apps/api.
const UPLOAD_PRIVATE_DIR = join(process.cwd(), 'uploads', 'private');
const localFiles: string[] = [];

let app: Express;

type Actor = { id: string; token: string; email: string };

const uniq = () => Math.random().toString(36).slice(2, 10);

const seedUser = async (
  role: 'customer' | 'expert' | 'business',
  options: { isAdmin?: boolean; permissions?: string[]; emailVerified?: boolean } = {},
): Promise<Actor> => {
  const email = `hr-${uniq()}@test.local`;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, display_name, primary_role,
                        email_verified_at, is_active, is_admin, admin_permissions)
     VALUES ($1, 'x', $2, $3, $4, true, $5, $6::jsonb)
     RETURNING id`,
    [
      email,
      `User ${uniq()}`,
      role,
      options.emailVerified === false ? null : new Date(),
      options.isAdmin === true,
      JSON.stringify(options.permissions ?? []),
    ],
  );
  const id = rows[0]!.id;
  const token = signAccessToken({
    sub: id,
    role,
    isAdmin: options.isAdmin === true,
    verified: true,
    emailVerified: options.emailVerified !== false,
  } as Parameters<typeof signAccessToken>[0]);
  return { id, token, email };
};

/** A private upload that really exists on disk, so the route can serve it. */
const seedPrivateUpload = async (ownerId: string): Promise<{ id: string; path: string }> => {
  const filename = `hr-${uniq()}.txt`;
  mkdirSync(UPLOAD_PRIVATE_DIR, { recursive: true });
  const diskPath = join(UPLOAD_PRIVATE_DIR, filename);
  writeFileSync(diskPath, 'evidence-bytes');
  localFiles.push(diskPath);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO private_uploads (storage_path, bucket, user_id, original_name)
     VALUES ($1, 'local', $2, $3)
     RETURNING id`,
    [`private/${filename}`, ownerId, filename],
  );
  return { id: rows[0]!.id, path: `private/${filename}` };
};

/** A need whose award has been accepted and paid for — the disputable shape. */
const seedActivatedNeed = async (
  customerId: string,
  providerId: string,
  options: { activate?: boolean } = {},
): Promise<string> => {
  const { rows: needRows } = await pool.query<{ id: string }>(
    `INSERT INTO needs (customer_id, title, description, budget_amount, status)
     VALUES ($1, $2, 'Need description', 1000, 'open')
     RETURNING id`,
    [customerId, `Need ${uniq()}`],
  );
  const needId = needRows[0]!.id;
  const { rows: bidRows } = await pool.query<{ id: string }>(
    `INSERT INTO bids (need_id, expert_id, amount, message, status)
     VALUES ($1, $2, 900, 'Bid message', 'accepted')
     RETURNING id`,
    [needId, providerId],
  );
  const bidId = bidRows[0]!.id;

  if (options.activate === false) {
    await pool.query(`UPDATE needs SET awarded_bid_id = $2, status = 'awarded' WHERE id = $1`, [
      needId,
      bidId,
    ]);
    return needId;
  }

  await pool.query(
    `UPDATE needs
        SET awarded_bid_id = $2, status = 'awarded', activated_at = now()
      WHERE id = $1`,
    [needId, bidId],
  );
  await pool.query(
    `INSERT INTO mhc_job_activations
       (activation_type, provider_user_id, acting_user_id, need_id, bid_id, action_key, mhc_charged)
     VALUES ('award', $1, $1, $2, $3, 'award_activation', 40)`,
    [providerId, needId, bidId],
  );
  return needId;
};

const seedReservationDispute = async (
  customerId: string,
  providerId: string,
  openedBy: string | null,
): Promise<{ reservationId: string; disputeId: string }> => {
  const { rows: resRows } = await pool.query<{ id: string }>(
    `INSERT INTO reservations
       (customer_id, provider_id, mode, online_type, status, requested_start_at, requested_end_at)
     VALUES ($1, $2, 'online', 'video', 'disputed', now(), now() + interval '1 hour')
     RETURNING id`,
    [customerId, providerId],
  );
  const reservationId = resRows[0]!.id;
  const { rows: dRows } = await pool.query<{ id: string }>(
    `INSERT INTO reservation_disputes (reservation_id, opened_by, reason, description, status)
     VALUES ($1, $2, 'customer_report', 'Session never happened', 'open')
     RETURNING id`,
    [reservationId, openedBy],
  );
  return { reservationId, disputeId: dRows[0]!.id };
};

// ---------------------------------------------------------------------------
// supertest hands back `any`; these keep every assertion below typed.
// ---------------------------------------------------------------------------
type Json = Record<string, unknown>;

const dataOf = <T = Json>(response: request.Response): T => (response.body as { data: T }).data;

const errorOf = (
  response: request.Response,
): { code: string; message: string; details?: Record<string, string> } =>
  (
    response.body as {
      error: { code: string; message: string; details?: Record<string, string> };
    }
  ).error;

const api = () => request(app);

const authed = (actor: Actor) => ({ Authorization: `Bearer ${actor.token}` });

// Kept verbatim with the migration header. The fingerprint test below makes a
// stale or over-broad rollback a release failure rather than a runbook surprise.
const WAVE_2I_ROLLBACK_SQL = `
DROP TRIGGER IF EXISTS resolution_touch_reservation_dispute_evidence ON public.reservation_dispute_evidence;
DROP TRIGGER IF EXISTS resolution_touch_reservation_dispute_note ON public.reservation_dispute_notes;
DROP TRIGGER IF EXISTS resolution_sync_reservation_dispute_upd ON public.reservation_disputes;
DROP TRIGGER IF EXISTS resolution_sync_reservation_dispute_ins ON public.reservation_disputes;
DROP TRIGGER IF EXISTS resolution_touch_support_ticket_message ON public.support_ticket_messages;
DROP TRIGGER IF EXISTS resolution_sync_support_ticket_upd ON public.support_tickets;
DROP TRIGGER IF EXISTS resolution_sync_support_ticket_ins ON public.support_tickets;

DROP FUNCTION IF EXISTS public.resolution_touch_reservation_dispute_case();
DROP FUNCTION IF EXISTS public.resolution_sync_reservation_dispute();
DROP FUNCTION IF EXISTS public.resolution_touch_support_ticket_case();
DROP FUNCTION IF EXISTS public.resolution_sync_support_ticket();
DROP FUNCTION IF EXISTS public.resolution_outcome_from_reservation_dispute(TEXT);
DROP FUNCTION IF EXISTS public.resolution_status_from_reservation_dispute(TEXT);
DROP FUNCTION IF EXISTS public.resolution_status_from_support_ticket(TEXT);

DROP TABLE IF EXISTS public.resolution_case_events;
DROP TABLE IF EXISTS public.resolution_case_evidence;
DROP TABLE IF EXISTS public.resolution_case_messages;
DROP TABLE IF EXISTS public.resolution_cases;
DROP SEQUENCE IF EXISTS public.resolution_case_reference_seq;
`;

beforeAll(async () => {
  if (!pgIntegrationEnabled()) return;
  scratch = await createScratchDatabase('helpres');
  pool = scratch.pool;
  const { createApp } = await import('../app.js');
  app = createApp();
});

afterAll(async () => {
  for (const file of localFiles) {
    if (existsSync(file)) rmSync(file, { force: true });
  }
  if (scratch) await scratch.drop();
});

const suite = pgIntegrationEnabled() ? describe : describe.skip;

// ---------------------------------------------------------------------------

suite('help & resolution — historical compatibility', () => {
  it('surfaces a ticket created through the legacy support route as a unified case', async () => {
    const user = await seedUser('customer');

    const created = await api()
      .post('/api/support/tickets')
      .set(authed(user))
      .send({ category: 'bug', subject: 'Legacy ticket', body: 'Something broke' });
    expect(created.status).toBe(201);
    const ticketId = dataOf<{ id: string }>(created).id;

    const list = await api().get('/api/help-resolution/cases').set(authed(user));
    expect(list.status).toBe(200);
    const items = dataOf<{ items: Json[] }>(list).items;
    const found = items.find((item) => item.supportTicketId === ticketId);

    expect(found).toBeDefined();
    expect(found!.kind).toBe('general_support');
    expect(found!.status).toBe('open');
    expect(found!.title).toBe('Legacy ticket');
    // The opening message written by the legacy route is counted here.
    expect(found!.messageCount).toBe(1);
    expect(String(found!.referenceCode)).toMatch(/^MH-\d{6}$/);
  });

  it('follows the legacy engine when a ticket status changes outside the centre', async () => {
    const user = await seedUser('customer');
    const created = await api()
      .post('/api/support/tickets')
      .set(authed(user))
      .send({ category: 'other', subject: 'Status follows', body: 'Body' });
    const ticketId = dataOf<{ id: string }>(created).id;

    await pool.query(`UPDATE support_tickets SET status = 'waiting_reply' WHERE id = $1`, [
      ticketId,
    ]);

    const found = await api()
      .get(`/api/help-resolution/cases/by-support-ticket/${ticketId}`)
      .set(authed(user));
    expect(found.status).toBe(200);
    expect(dataOf<{ status: string }>(found).status).toBe('awaiting_user');
    expect(dataOf<{ engineStatus: string }>(found).engineStatus).toBe('waiting_reply');

    await pool.query(`UPDATE support_tickets SET status = 'resolved' WHERE id = $1`, [ticketId]);
    const resolved = await api()
      .get(`/api/help-resolution/cases/by-support-ticket/${ticketId}`)
      .set(authed(user));
    expect(dataOf<{ status: string }>(resolved).status).toBe('resolved');

    // Reopening must clear the resolution stamp, or the terminal-shape CHECK
    // rejects the sync and the legacy route starts failing.
    await pool.query(`UPDATE support_tickets SET status = 'open' WHERE id = $1`, [ticketId]);
    const reopened = await api()
      .get(`/api/help-resolution/cases/by-support-ticket/${ticketId}`)
      .set(authed(user));
    expect(dataOf<{ status: string }>(reopened).status).toBe('open');
  });

  it('shows a reservation dispute to both participants with its notes and evidence', async () => {
    const customer = await seedUser('customer');
    const provider = await seedUser('expert');
    const { disputeId } = await seedReservationDispute(customer.id, provider.id, customer.id);

    const note = await api()
      .post(`/api/reservations/disputes/${disputeId}/notes`)
      .set(authed(provider))
      .send({ body: 'I was online the whole time.' });
    expect(note.status).toBe(201);

    for (const actor of [customer, provider]) {
      const found = await api()
        .get(`/api/help-resolution/cases/by-reservation-dispute/${disputeId}`)
        .set(authed(actor));
      expect(found.status).toBe(200);
      expect(dataOf<{ kind: string }>(found).kind).toBe('reservation_dispute');

      const file = await api()
        .get(`/api/help-resolution/cases/${dataOf<{ id: string }>(found).id}`)
        .set(authed(actor));
      expect(file.status).toBe(200);
      const bodies = dataOf<{ messages: Array<{ body: string }> }>(file).messages.map(
        (m) => m.body,
      );
      expect(bodies).toContain('I was online the whole time.');
    }
  });

  it('opens a dispute raised by the timeout worker for the customer, not for nobody', async () => {
    const customer = await seedUser('customer');
    const provider = await seedUser('expert');
    // opened_by is NULL for system-raised disputes.
    const { disputeId } = await seedReservationDispute(customer.id, provider.id, null);

    const found = await api()
      .get(`/api/help-resolution/cases/by-reservation-dispute/${disputeId}`)
      .set(authed(customer));
    expect(found.status).toBe(200);
    expect(dataOf<{ openedBy: string }>(found).openedBy).toBe(customer.id);
    expect(dataOf<{ counterpartyId: string }>(found).counterpartyId).toBe(provider.id);
  });

  it('re-runs the migration without disturbing existing tickets or duplicating cases', async () => {
    const user = await seedUser('customer');
    const created = await api()
      .post('/api/support/tickets')
      .set(authed(user))
      .send({ category: 'other', subject: 'Pre-migration ticket', body: 'Body' });
    const ticketId = dataOf<{ id: string }>(created).id;

    // Stand in for a ticket that predates the spine: remove its case row and
    // let the migration's backfill find it again.
    await pool.query(`DELETE FROM resolution_cases WHERE support_ticket_id = $1`, [ticketId]);

    await scratch.exec(readMigration('20260801090000_unified_help_resolution_cases.sql'));

    const { rows } = await pool.query<{ count: string; status: string; opened_by: string }>(
      `SELECT count(*)::text AS count, min(status) AS status, min(opened_by::text) AS opened_by
         FROM resolution_cases WHERE support_ticket_id = $1
        GROUP BY support_ticket_id`,
      [ticketId],
    );
    expect(rows[0]?.count).toBe('1');
    expect(rows[0]?.status).toBe('open');
    expect(rows[0]?.opened_by).toBe(user.id);

    // The ticket itself is untouched, and the legacy route still serves it.
    const legacy = await api().get(`/api/support/tickets/${ticketId}`).set(authed(user));
    expect(legacy.status).toBe(200);
    expect(dataOf<{ subject: string }>(legacy).subject).toBe('Pre-migration ticket');
  });
});

// ---------------------------------------------------------------------------

suite('help & resolution — migration rollback', () => {
  it('restores the exact previous schema fingerprint and is idempotent', async () => {
    const copy = await createScratchDatabase('helpresback');
    const fingerprint = async (): Promise<Set<string>> => {
      const { rows } = await copy.pool.query<{ kind: string; sig: string }>(
        `SELECT 'relation'::text AS kind,
                n.nspname::text || '.' || c.relname::text || '::' || c.relkind::text AS sig
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind IN ('r','p','S')
         UNION ALL
         SELECT 'column', table_name::text || '.' || column_name::text || '::' ||
                data_type::text || '::' || is_nullable::text || '::' ||
                COALESCE(column_default, '')::text
           FROM information_schema.columns WHERE table_schema = 'public'
         UNION ALL
         SELECT 'constraint', conrelid::regclass::text || '::' || conname::text || '::' ||
                pg_get_constraintdef(oid)::text
           FROM pg_constraint WHERE connamespace = 'public'::regnamespace
         UNION ALL
         SELECT 'index', tablename::text || '.' || indexname::text || '::' || indexdef::text
           FROM pg_indexes WHERE schemaname = 'public'
         UNION ALL
         SELECT 'trigger', event_object_table::text || '.' || trigger_name::text || '::' ||
                action_statement::text
           FROM information_schema.triggers WHERE trigger_schema = 'public'
         UNION ALL
         SELECT 'function', p.oid::regprocedure::text || '::' || pg_get_functiondef(p.oid)::text
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
         ORDER BY 1, 2`,
      );
      return new Set(rows.map((row) => `${row.kind}:${row.sig}`));
    };

    try {
      // The helper includes Wave 2I. Reverse it to obtain the exact prior
      // boundary, then prove a full apply/rollback cycle returns to that set.
      await copy.exec(WAVE_2I_ROLLBACK_SQL);
      const before = await fingerprint();
      await copy.exec(readMigration('20260801090000_unified_help_resolution_cases.sql'));
      await copy.exec(WAVE_2I_ROLLBACK_SQL);
      await copy.exec(WAVE_2I_ROLLBACK_SQL);
      const after = await fingerprint();
      expect(after).toEqual(before);
    } finally {
      await copy.drop();
    }
  }, 900_000);
});

// ---------------------------------------------------------------------------

suite('help & resolution — case authorisation', () => {
  it('lets the opener and an explicit counterparty in, and nobody else', async () => {
    const customer = await seedUser('customer');
    const provider = await seedUser('expert');
    const stranger = await seedUser('customer');
    const needId = await seedActivatedNeed(customer.id, provider.id);

    const created = await api().post('/api/help-resolution/cases').set(authed(customer)).send({
      kind: 'need_job_dispute',
      subjectType: 'need',
      subjectId: needId,
      reason: 'not_delivered',
      description: 'Nothing was delivered.',
    });
    expect(created.status).toBe(201);
    const caseId = dataOf<{ id: string }>(created).id;

    const asOpener = await api().get(`/api/help-resolution/cases/${caseId}`).set(authed(customer));
    expect(asOpener.status).toBe(200);
    expect(dataOf<{ case: { viewerRole: string } }>(asOpener).case.viewerRole).toBe('opener');

    const asCounterparty = await api()
      .get(`/api/help-resolution/cases/${caseId}`)
      .set(authed(provider));
    expect(asCounterparty.status).toBe(200);
    expect(dataOf<{ case: { viewerRole: string } }>(asCounterparty).case.viewerRole).toBe(
      'counterparty',
    );

    // An unrelated caller is told the case does not exist. Answering 403 would
    // confirm that a case exists between two named people.
    const asStranger = await api()
      .get(`/api/help-resolution/cases/${caseId}`)
      .set(authed(stranger));
    expect(asStranger.status).toBe(404);
    expect(errorOf(asStranger).code).toBe('CASE_NOT_FOUND');

    const strangerList = await api().get('/api/help-resolution/cases').set(authed(stranger));
    expect(dataOf<{ items: unknown[] }>(strangerList).items).toHaveLength(0);
  });

  it('keeps a safety report away from the person it is about', async () => {
    const reporter = await seedUser('customer');
    const reported = await seedUser('expert');

    const created = await api().post('/api/help-resolution/cases').set(authed(reporter)).send({
      kind: 'safety_report',
      reason: 'harassment',
      description: 'Repeated abusive messages.',
      reportedUserId: reported.id,
    });
    expect(created.status).toBe(201);
    const caseId = dataOf<{ id: string }>(created).id;
    expect(dataOf<{ counterpartyId: string | null }>(created).counterpartyId).toBeNull();

    const asReported = await api()
      .get(`/api/help-resolution/cases/${caseId}`)
      .set(authed(reported));
    expect(asReported.status).toBe(404);

    const reportedList = await api().get('/api/help-resolution/cases').set(authed(reported));
    expect(dataOf<{ items: unknown[] }>(reportedList).items).toHaveLength(0);

    // And no notification tells them a report exists.
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM notifications WHERE user_id = $1`,
      [reported.id],
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('refuses to store a counterparty on a safety report at the schema level', async () => {
    const reporter = await seedUser('customer');
    const other = await seedUser('expert');
    await expect(
      pool.query(
        `INSERT INTO resolution_cases (kind, opened_by, counterparty_id, counterparty_access, title)
         VALUES ('safety_report', $1, $2, true, 'Should not exist')`,
        [reporter.id, other.id],
      ),
    ).rejects.toThrow(/chk_resolution_cases_safety_is_private/);
  });

  it('gives a named counterparty nothing without an explicit grant', async () => {
    const opener = await seedUser('customer');
    const named = await seedUser('expert');
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO resolution_cases
         (kind, opened_by, counterparty_id, counterparty_access, title, description)
       VALUES ('direct_payment', $1, $2, false, 'Ungranted case', 'x')
       RETURNING id`,
      [opener.id, named.id],
    );
    const caseId = rows[0]!.id;

    const response = await api().get(`/api/help-resolution/cases/${caseId}`).set(authed(named));
    expect(response.status).toBe(404);

    const list = await api().get('/api/help-resolution/cases').set(authed(named));
    expect(dataOf<{ items: unknown[] }>(list).items).toHaveLength(0);
  });

  it('grants and revokes native counterparty access through an authorised lifecycle', async () => {
    const opener = await seedUser('customer');
    const named = await seedUser('expert');
    const admin = await seedUser('customer', { isAdmin: true, permissions: ['manage_support'] });
    const upload = await seedPrivateUpload(opener.id);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO resolution_cases
         (kind, opened_by, counterparty_id, counterparty_access, title, description)
       VALUES ('direct_payment', $1, $2, false, 'Controlled grant', 'x')
       RETURNING id`,
      [opener.id, named.id],
    );
    const caseId = rows[0]!.id;

    await api()
      .post(`/api/help-resolution/cases/${caseId}/evidence`)
      .set(authed(opener))
      .send({ uploadId: upload.id })
      .expect(201);

    await api()
      .patch(`/api/help-resolution/admin/cases/${caseId}/counterparty-access`)
      .set(authed(admin))
      .send({ granted: true })
      .expect(200);
    await api().get(`/api/help-resolution/cases/${caseId}`).set(authed(named)).expect(200);
    await api()
      .get(`/api/upload/private/${upload.id}`)
      .set({ ...authed(named), Accept: 'application/json' })
      .expect(200);

    await api()
      .patch(`/api/help-resolution/admin/cases/${caseId}/counterparty-access`)
      .set(authed(admin))
      .send({ granted: false })
      .expect(200);
    await api().get(`/api/help-resolution/cases/${caseId}`).set(authed(named)).expect(404);
    await api()
      .get(`/api/upload/private/${upload.id}`)
      .set({ ...authed(named), Accept: 'application/json' })
      .expect(403);
    const list = await api().get('/api/help-resolution/cases').set(authed(named));
    expect(dataOf<{ items: Array<{ id: string }> }>(list).items).not.toContainEqual(
      expect.objectContaining({ id: caseId }),
    );
  });

  it('requires real admin authorisation for the admin queue', async () => {
    const plain = await seedUser('customer');
    const wrongPermission = await seedUser('customer', {
      isAdmin: true,
      permissions: ['manage_media'],
    });
    const realAdmin = await seedUser('customer', {
      isAdmin: true,
      permissions: ['manage_support'],
    });

    expect((await api().get('/api/help-resolution/admin/cases').set(authed(plain))).status).toBe(
      403,
    );
    expect(
      (await api().get('/api/help-resolution/admin/cases').set(authed(wrongPermission))).status,
    ).toBe(403);
    expect(
      (await api().get('/api/help-resolution/admin/cases').set(authed(realAdmin))).status,
    ).toBe(200);
  });

  it('ignores a stale admin claim in the token and trusts the database', async () => {
    const user = await seedUser('customer');
    // A token minted while the account was an admin, for an account that is not.
    const staleToken = signAccessToken({
      sub: user.id,
      role: 'customer',
      isAdmin: true,
      verified: true,
      emailVerified: true,
    } as Parameters<typeof signAccessToken>[0]);

    const response = await api()
      .get('/api/help-resolution/admin/cases')
      .set({ Authorization: `Bearer ${staleToken}` });
    expect(response.status).toBe(403);
  });

  it('assigns cases only to a database-authorised case admin', async () => {
    const opener = await seedUser('customer');
    const plain = await seedUser('customer');
    const actingAdmin = await seedUser('customer', {
      isAdmin: true,
      permissions: ['manage_support'],
    });
    const assignee = await seedUser('customer', {
      isAdmin: true,
      permissions: ['manage_transactions'],
    });
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO resolution_cases (kind, opened_by, title)
       VALUES ('safety_report', $1, 'Assignment') RETURNING id`,
      [opener.id],
    );
    const caseId = rows[0]!.id;

    const rejected = await api()
      .post(`/api/help-resolution/admin/cases/${caseId}/assign`)
      .set(authed(actingAdmin))
      .send({ adminId: plain.id });
    expect(rejected.status).toBe(404);
    expect(errorOf(rejected).code).toBe('ADMIN_NOT_FOUND');

    const accepted = await api()
      .post(`/api/help-resolution/admin/cases/${caseId}/assign`)
      .set(authed(actingAdmin))
      .send({ adminId: assignee.id });
    expect(accepted.status).toBe(200);
    expect(dataOf<{ assignedAdminId: string }>(accepted).assignedAdminId).toBe(assignee.id);
  });
});

// ---------------------------------------------------------------------------

suite('help & resolution — evidence security', () => {
  it('refuses evidence that belongs to somebody else', async () => {
    const customer = await seedUser('customer');
    const provider = await seedUser('expert');
    const needId = await seedActivatedNeed(customer.id, provider.id);
    const foreign = await seedPrivateUpload(provider.id);

    const created = await api().post('/api/help-resolution/cases').set(authed(customer)).send({
      kind: 'need_job_dispute',
      subjectType: 'need',
      subjectId: needId,
      reason: 'quality',
      description: 'Poor quality.',
    });
    const caseId = dataOf<{ id: string }>(created).id;

    const attach = await api()
      .post(`/api/help-resolution/cases/${caseId}/evidence`)
      .set(authed(customer))
      .send({ uploadId: foreign.id });
    expect(attach.status).toBe(403);
    expect(errorOf(attach).code).toBe('UPLOAD_NOT_OWNED');
  });

  it('authorises the file itself against the case, not against the request', async () => {
    const customer = await seedUser('customer');
    const provider = await seedUser('expert');
    const stranger = await seedUser('customer');
    const needId = await seedActivatedNeed(customer.id, provider.id);
    const upload = await seedPrivateUpload(customer.id);

    const created = await api()
      .post('/api/help-resolution/cases')
      .set(authed(customer))
      .send({
        kind: 'need_job_dispute',
        subjectType: 'need',
        subjectId: needId,
        reason: 'not_delivered',
        description: 'Nothing delivered.',
        evidenceUploadIds: [upload.id],
      });
    expect(created.status).toBe(201);
    const caseId = dataOf<{ id: string }>(created).id;

    // Owner.
    const asOwner = await api()
      .get(`/api/upload/private/${upload.id}`)
      .set({ ...authed(customer), Accept: 'application/json' });
    expect(asOwner.status).toBe(200);

    // Counterparty: allowed because the case grants it, not because they asked.
    const asCounterparty = await api()
      .get(`/api/upload/private/${upload.id}`)
      .set({ ...authed(provider), Accept: 'application/json' });
    expect(asCounterparty.status).toBe(200);

    // Unrelated user.
    const asStranger = await api()
      .get(`/api/upload/private/${upload.id}`)
      .set({ ...authed(stranger), Accept: 'application/json' });
    expect(asStranger.status).toBe(403);

    // The case file never leaks a bucket or an object path.
    const file = await api().get(`/api/help-resolution/cases/${caseId}`).set(authed(provider));
    const evidence = dataOf<{ evidence: Array<{ fileUrl: string }> }>(file).evidence;
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.fileUrl).toBe(`/api/upload/private/${upload.id}`);
    const serialised = JSON.stringify(file.body);
    expect(serialised).not.toContain(upload.path);
    expect(serialised).not.toContain('verification-docs');
    expect(serialised).not.toContain('storage/v1/object');
  });

  it('hands back an openable URL that still needs authentication', async () => {
    const owner = await seedUser('customer');
    const upload = await seedPrivateUpload(owner.id);

    const json = await api()
      .get(`/api/upload/private/${upload.id}`)
      .set({ ...authed(owner), Accept: 'application/json' });
    expect(json.status).toBe(200);
    const url = dataOf<{ url: string }>(json).url;
    expect(url).toContain(`/api/upload/private/${upload.id}`);
    expect(url).not.toContain(upload.path);

    // The URL really serves the bytes for an authenticated caller...
    const bytes = await api()
      .get(`/api/upload/private/${upload.id}`)
      .set({ ...authed(owner), Accept: 'image/*' });
    expect(bytes.status).toBe(200);

    // ...and nothing at all for an anonymous one.
    const anonymous = await api().get(`/api/upload/private/${upload.id}`);
    expect(anonymous.status).toBe(401);
  });

  it('lets a reservation dispute counterparty open evidence the other side attached', async () => {
    const customer = await seedUser('customer');
    const provider = await seedUser('expert');
    const stranger = await seedUser('customer');
    const { disputeId } = await seedReservationDispute(customer.id, provider.id, customer.id);
    const upload = await seedPrivateUpload(customer.id);

    const attached = await api()
      .post(`/api/reservations/disputes/${disputeId}/evidence`)
      .set(authed(customer))
      .send({ uploadId: upload.id, label: 'Screenshot' });
    expect(attached.status).toBe(201);

    const asCounterparty = await api()
      .get(`/api/upload/private/${upload.id}`)
      .set({ ...authed(provider), Accept: 'application/json' });
    expect(asCounterparty.status).toBe(200);

    const asStranger = await api()
      .get(`/api/upload/private/${upload.id}`)
      .set({ ...authed(stranger), Accept: 'application/json' });
    expect(asStranger.status).toBe(403);
  });

  it('scopes a support admin to case evidence and keeps them out of other private files', async () => {
    const owner = await seedUser('customer');
    const provider = await seedUser('expert');
    const supportAdmin = await seedUser('customer', {
      isAdmin: true,
      permissions: ['manage_support'],
    });

    const caseUpload = await seedPrivateUpload(owner.id);
    const unrelatedUpload = await seedPrivateUpload(owner.id);
    const needId = await seedActivatedNeed(owner.id, provider.id);

    await api()
      .post('/api/help-resolution/cases')
      .set(authed(owner))
      .send({
        kind: 'need_job_dispute',
        subjectType: 'need',
        subjectId: needId,
        reason: 'other',
        description: 'Dispute.',
        evidenceUploadIds: [caseUpload.id],
      });

    const attached = await api()
      .get(`/api/upload/private/${caseUpload.id}`)
      .set({ ...authed(supportAdmin), Accept: 'application/json' });
    expect(attached.status).toBe(200);

    // Identity documents live in the same store. A support admin must not
    // reach one just because they can adjudicate cases.
    const unattached = await api()
      .get(`/api/upload/private/${unrelatedUpload.id}`)
      .set({ ...authed(supportAdmin), Accept: 'application/json' });
    expect(unattached.status).toBe(403);
  });

  it('cannot launder identity evidence into native or reservation case evidence', async () => {
    const customer = await seedUser('customer');
    const provider = await seedUser('expert');
    const upload = await seedPrivateUpload(customer.id);
    await pool.query(
      `INSERT INTO identity_documents
         (user_id, document_type, full_name_on_doc, front_image_url)
       VALUES ($1, 'passport', 'Private Person', $2)`,
      [customer.id, `/api/upload/private/${upload.id}`],
    );

    const needId = await seedActivatedNeed(customer.id, provider.id);
    const native = await api().post('/api/help-resolution/cases').set(authed(customer)).send({
      kind: 'need_job_dispute',
      subjectType: 'need',
      subjectId: needId,
      reason: 'other',
      description: 'Must not attach KYC.',
      evidenceUploadIds: [upload.id],
    });
    expect(native.status).toBe(403);
    expect(errorOf(native).code).toBe('UPLOAD_NOT_OWNED');

    const { disputeId } = await seedReservationDispute(customer.id, provider.id, customer.id);
    const legacy = await api()
      .post(`/api/reservations/disputes/${disputeId}/evidence`)
      .set(authed(customer))
      .send({ uploadId: upload.id });
    expect(legacy.status).toBe(403);
    expect(errorOf(legacy).code).toBe('UPLOAD_NOT_OWNED');
  });
});

// ---------------------------------------------------------------------------

suite('help & resolution — status transitions', () => {
  const openCase = async (): Promise<{
    caseId: string;
    customer: Actor;
    provider: Actor;
    admin: Actor;
  }> => {
    const customer = await seedUser('customer');
    const provider = await seedUser('expert');
    const admin = await seedUser('customer', { isAdmin: true, permissions: ['manage_support'] });
    const needId = await seedActivatedNeed(customer.id, provider.id);
    const created = await api().post('/api/help-resolution/cases').set(authed(customer)).send({
      kind: 'need_job_dispute',
      subjectType: 'need',
      subjectId: needId,
      reason: 'unresponsive',
      description: 'No reply for two weeks.',
    });
    return { caseId: dataOf<{ id: string }>(created).id, customer, provider, admin };
  };

  it('moves the case itself; the request body never says what the status becomes', async () => {
    const { caseId, customer, admin } = await openCase();

    // A client trying to dictate status is simply not read.
    const reply = await api()
      .post(`/api/help-resolution/cases/${caseId}/messages`)
      .set(authed(customer))
      .send({ body: 'Any update?', status: 'resolved', visibility: 'participants' });
    expect(reply.status).toBe(201);

    const afterUser = await api().get(`/api/help-resolution/cases/${caseId}`).set(authed(customer));
    expect(dataOf<{ case: { status: string } }>(afterUser).case.status).toBe('under_review');

    const staffReply = await api()
      .post(`/api/help-resolution/admin/cases/${caseId}/messages`)
      .set(authed(admin))
      .send({ body: 'Could you send the delivery emails?' });
    expect(staffReply.status).toBe(201);

    const afterStaff = await api()
      .get(`/api/help-resolution/cases/${caseId}`)
      .set(authed(customer));
    expect(dataOf<{ case: { status: string } }>(afterStaff).case.status).toBe('awaiting_user');
  });

  it('refuses an internal note from a participant instead of quietly downgrading it', async () => {
    const { caseId, customer } = await openCase();
    const response = await api()
      .post(`/api/help-resolution/cases/${caseId}/messages`)
      .set(authed(customer))
      .send({ body: 'Secret', visibility: 'admin' });
    expect(response.status).toBe(403);
  });

  it('hides admin notes from participants and shows them to admins', async () => {
    const { caseId, customer, admin } = await openCase();
    await api()
      .post(`/api/help-resolution/admin/cases/${caseId}/messages`)
      .set(authed(admin))
      .send({ body: 'Internal: check the provider history.', visibility: 'admin' });

    const asParticipant = await api()
      .get(`/api/help-resolution/cases/${caseId}`)
      .set(authed(customer));
    const participantBodies = dataOf<{ messages: Array<{ body: string }> }>(
      asParticipant,
    ).messages.map((m) => m.body);
    expect(participantBodies).not.toContain('Internal: check the provider history.');
    const participantEvents = dataOf<{ timeline: Array<{ eventType: string }> }>(
      asParticipant,
    ).timeline.map((event) => event.eventType);
    expect(participantEvents).not.toContain('staff_message');

    const asAdmin = await api()
      .get(`/api/help-resolution/admin/cases/${caseId}`)
      .set(authed(admin));
    const adminBodies = dataOf<{ messages: Array<{ body: string }> }>(asAdmin).messages.map(
      (m) => m.body,
    );
    expect(adminBodies).toContain('Internal: check the provider history.');
    const adminEvents = dataOf<{ timeline: Array<{ eventType: string }> }>(asAdmin).timeline.map(
      (event) => event.eventType,
    );
    expect(adminEvents).toContain('staff_message');
  });

  /**
   * The support engine shows every ticket message to its owner. An admin note
   * written there would land in front of the person it was hidden from, so the
   * route refuses rather than publishing it.
   */
  it('refuses an internal note on a support ticket rather than publishing it to the user', async () => {
    const user = await seedUser('customer');
    const admin = await seedUser('customer', { isAdmin: true, permissions: ['manage_support'] });
    const created = await api()
      .post('/api/support/tickets')
      .set(authed(user))
      .send({ category: 'other', subject: 'No internal notes here', body: 'Body' });
    const ticketId = dataOf<{ id: string }>(created).id;
    const found = await api()
      .get(`/api/help-resolution/cases/by-support-ticket/${ticketId}`)
      .set(authed(user));
    const caseId = dataOf<{ id: string }>(found).id;

    const attempt = await api()
      .post(`/api/help-resolution/admin/cases/${caseId}/messages`)
      .set(authed(admin))
      .send({ body: 'Internal: user has three prior refunds.', visibility: 'admin' });
    expect(attempt.status).toBe(409);
    expect(errorOf(attempt).code).toBe('INTERNAL_NOTES_NOT_SUPPORTED');

    // And nothing was written where the user would read it.
    const messages = await api().get(`/api/support/tickets/${ticketId}/messages`).set(authed(user));
    const bodies = dataOf<Array<{ body: string }>>(messages).map((m) => m.body);
    expect(bodies).not.toContain('Internal: user has three prior refunds.');
  });

  it('preserves a unified support resolution outcome and note in the authoritative transaction', async () => {
    const user = await seedUser('customer');
    const admin = await seedUser('customer', { isAdmin: true, permissions: ['manage_support'] });
    const created = await api()
      .post('/api/support/tickets')
      .set(authed(user))
      .send({ category: 'other', subject: 'Resolved support metadata', body: 'Body' });
    const ticketId = dataOf<{ id: string }>(created).id;
    const found = await api()
      .get(`/api/help-resolution/cases/by-support-ticket/${ticketId}`)
      .set(authed(user));
    const caseId = dataOf<{ id: string }>(found).id;

    const resolved = await api()
      .post(`/api/help-resolution/admin/cases/${caseId}/resolve`)
      .set(authed(admin))
      .send({ outcome: 'no_action', notes: 'No platform defect was found.' });
    expect(resolved.status).toBe(200);

    const file = await api().get(`/api/help-resolution/cases/${caseId}`).set(authed(user));
    expect(dataOf<{ resolution: { outcome: string; notes: string } }>(file).resolution).toMatchObject(
      { outcome: 'no_action', notes: 'No platform defect was found.' },
    );

    await pool.query(`UPDATE support_tickets SET status = 'open' WHERE id = $1`, [ticketId]);
    const reopened = await api().get(`/api/help-resolution/cases/${caseId}`).set(authed(user));
    expect(dataOf<{ resolution: { outcome: null; notes: null } }>(reopened).resolution).toMatchObject(
      { outcome: null, notes: null },
    );
  });

  it('closes a case to further messages once it is resolved', async () => {
    const { caseId, customer, admin } = await openCase();

    const resolved = await api()
      .post(`/api/help-resolution/admin/cases/${caseId}/resolve`)
      .set(authed(admin))
      .send({ outcome: 'resolved_for_opener', notes: 'Provider refunded off-platform.' });
    expect(resolved.status).toBe(200);
    expect(dataOf<{ status: string }>(resolved).status).toBe('resolved');

    const late = await api()
      .post(`/api/help-resolution/cases/${caseId}/messages`)
      .set(authed(customer))
      .send({ body: 'One more thing' });
    expect(late.status).toBe(409);
    expect(errorOf(late).code).toBe('CASE_NOT_OPEN');

    const twice = await api()
      .post(`/api/help-resolution/admin/cases/${caseId}/resolve`)
      .set(authed(admin))
      .send({ outcome: 'no_action', notes: 'again' });
    expect(twice.status).toBe(409);
  });

  it('escalates exactly once and only while the case is open', async () => {
    const { caseId, customer } = await openCase();

    const first = await api()
      .post(`/api/help-resolution/cases/${caseId}/escalate`)
      .set(authed(customer))
      .send({ reason: 'No admin response.' });
    expect(first.status).toBe(200);
    expect(dataOf<{ status: string }>(first).status).toBe('escalated');
    expect(dataOf<{ escalatedAt: string | null }>(first).escalatedAt).not.toBeNull();

    const second = await api()
      .post(`/api/help-resolution/cases/${caseId}/escalate`)
      .set(authed(customer))
      .send({});
    expect(second.status).toBe(409);
    expect(errorOf(second).code).toBe('ALREADY_ESCALATED');
  });

  it('will not resolve a reservation dispute away from the endpoint that settles it', async () => {
    const customer = await seedUser('customer');
    const provider = await seedUser('expert');
    const admin = await seedUser('customer', {
      isAdmin: true,
      permissions: ['manage_support', 'manage_transactions'],
    });
    const { disputeId } = await seedReservationDispute(customer.id, provider.id, customer.id);

    const found = await api()
      .get(`/api/help-resolution/cases/by-reservation-dispute/${disputeId}`)
      .set(authed(customer));
    const caseId = dataOf<{ id: string }>(found).id;

    const attempt = await api()
      .post(`/api/help-resolution/admin/cases/${caseId}/resolve`)
      .set(authed(admin))
      .send({ outcome: 'resolved_for_opener', notes: 'Refund the customer.' });
    expect(attempt.status).toBe(409);
    expect(errorOf(attempt).code).toBe('RESOLUTION_HANDLED_ELSEWHERE');
    expect(errorOf(attempt).details?.route).toBe(`/api/reservations/disputes/${disputeId}/resolve`);

    // The dispute is untouched, so the money path still owns the decision.
    const { rows } = await pool.query<{ status: string }>(
      `SELECT status FROM reservation_disputes WHERE id = $1`,
      [disputeId],
    );
    expect(rows[0]?.status).toBe('open');
  });

  it('rejects a terminal status on the admin status route', async () => {
    const { caseId, admin } = await openCase();
    const response = await api()
      .post(`/api/help-resolution/admin/cases/${caseId}/status`)
      .set(authed(admin))
      .send({ status: 'resolved' });
    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------

suite('help & resolution — marketplace gating', () => {
  it('refuses a dispute on a need whose award was never activated', async () => {
    const customer = await seedUser('customer');
    const provider = await seedUser('expert');
    const needId = await seedActivatedNeed(customer.id, provider.id, { activate: false });

    const response = await api().post('/api/help-resolution/cases').set(authed(customer)).send({
      kind: 'need_job_dispute',
      subjectType: 'need',
      subjectId: needId,
      reason: 'not_delivered',
      description: 'Nothing happened.',
    });
    expect(response.status).toBe(409);
    expect(errorOf(response).code).toBe('MARKETPLACE_DISPUTE_UNSUPPORTED');
  });

  it('reports unavailability honestly for a user with no engagements', async () => {
    const user = await seedUser('customer');
    const response = await api().get('/api/help-resolution/availability').set(authed(user));
    expect(response.status).toBe(200);

    const items = dataOf<{
      items: Array<{
        kind: string;
        available: boolean;
        reasonCode: string | null;
        message: string | null;
        eligibleSubjects: unknown[];
      }>;
    }>(response).items;
    const byKind = Object.fromEntries(items.map((item) => [item.kind, item]));

    expect(byKind.general_support!.available).toBe(true);
    expect(byKind.safety_report!.available).toBe(true);

    expect(byKind.need_job_dispute!.available).toBe(false);
    expect(byKind.need_job_dispute!.reasonCode).toBe('no_eligible_subject');
    expect(byKind.need_job_dispute!.message).toBeTruthy();
    expect(byKind.direct_payment!.available).toBe(false);
  });

  it('lists the engagement once it is activated', async () => {
    const customer = await seedUser('customer');
    const provider = await seedUser('expert');
    const needId = await seedActivatedNeed(customer.id, provider.id);

    const response = await api().get('/api/help-resolution/availability').set(authed(customer));
    const items = dataOf<{
      items: Array<{
        kind: string;
        available: boolean;
        eligibleSubjects: Array<{ subjectId: string; counterpartyId: string | null }>;
      }>;
    }>(response).items;
    const dispute = items.find((item) => item.kind === 'need_job_dispute')!;

    expect(dispute.available).toBe(true);
    const subject = dispute.eligibleSubjects.find((s) => s.subjectId === needId);
    expect(subject).toBeDefined();
    expect(subject!.counterpartyId).toBe(provider.id);
  });
});

// ---------------------------------------------------------------------------

suite('help & resolution — duplicates and races', () => {
  it('allows one live dispute per person per engagement', async () => {
    const customer = await seedUser('customer');
    const provider = await seedUser('expert');
    const admin = await seedUser('customer', { isAdmin: true, permissions: ['manage_support'] });
    const needId = await seedActivatedNeed(customer.id, provider.id);

    const payload = {
      kind: 'need_job_dispute',
      subjectType: 'need',
      subjectId: needId,
      reason: 'not_delivered',
      description: 'Nothing delivered.',
    };

    const first = await api()
      .post('/api/help-resolution/cases')
      .set(authed(customer))
      .send(payload);
    expect(first.status).toBe(201);

    const second = await api()
      .post('/api/help-resolution/cases')
      .set(authed(customer))
      .send(payload);
    expect(second.status).toBe(409);
    expect(errorOf(second).code).toBe('DUPLICATE_CASE');

    // The counterparty is a different opener and may raise their own.
    const fromProvider = await api()
      .post('/api/help-resolution/cases')
      .set(authed(provider))
      .send(payload);
    expect(fromProvider.status).toBe(201);

    // Once the first is resolved the customer may open a fresh one.
    await api()
      .post(`/api/help-resolution/admin/cases/${dataOf<{ id: string }>(first).id}/resolve`)
      .set(authed(admin))
      .send({ outcome: 'no_action', notes: 'Closed.' });

    const third = await api()
      .post('/api/help-resolution/cases')
      .set(authed(customer))
      .send(payload);
    expect(third.status).toBe(201);
  });

  it('lets exactly one of ten concurrent duplicate submissions through', async () => {
    const customer = await seedUser('customer');
    const provider = await seedUser('expert');
    const needId = await seedActivatedNeed(customer.id, provider.id);
    const payload = {
      kind: 'need_job_dispute',
      subjectType: 'need',
      subjectId: needId,
      reason: 'quality',
      description: 'Racing submissions.',
    };

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        api().post('/api/help-resolution/cases').set(authed(customer)).send(payload),
      ),
    );
    const created = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);

    expect(created).toHaveLength(1);
    expect(conflicts).toHaveLength(9);
    for (const conflict of conflicts) {
      expect(errorOf(conflict).code).toBe('DUPLICATE_CASE');
    }

    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM resolution_cases
        WHERE subject_id = $1 AND opened_by = $2`,
      [needId, customer.id],
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('keeps every concurrent message and leaves activity moving forward', async () => {
    const customer = await seedUser('customer');
    const provider = await seedUser('expert');
    const needId = await seedActivatedNeed(customer.id, provider.id);
    const created = await api().post('/api/help-resolution/cases').set(authed(customer)).send({
      kind: 'need_job_dispute',
      subjectType: 'need',
      subjectId: needId,
      reason: 'other',
      description: 'Concurrent thread.',
    });
    const caseId = dataOf<{ id: string }>(created).id;

    const { rows: before } = await pool.query<{ last_activity_at: Date }>(
      `SELECT last_activity_at FROM resolution_cases WHERE id = $1`,
      [caseId],
    );

    const results = await Promise.all(
      Array.from({ length: 10 }, (_unused, index) =>
        api()
          .post(`/api/help-resolution/cases/${caseId}/messages`)
          .set(authed(index % 2 === 0 ? customer : provider))
          .send({ body: `Message ${index}` }),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);

    const file = await api().get(`/api/help-resolution/cases/${caseId}`).set(authed(customer));
    expect(dataOf<{ messages: unknown[] }>(file).messages).toHaveLength(10);

    const { rows: after } = await pool.query<{ last_activity_at: Date }>(
      `SELECT last_activity_at FROM resolution_cases WHERE id = $1`,
      [caseId],
    );
    expect(new Date(after[0]!.last_activity_at).getTime()).toBeGreaterThanOrEqual(
      new Date(before[0]!.last_activity_at).getTime(),
    );
  });

  it('attaches a racing evidence file exactly once', async () => {
    const customer = await seedUser('customer');
    const provider = await seedUser('expert');
    const needId = await seedActivatedNeed(customer.id, provider.id);
    const upload = await seedPrivateUpload(customer.id);
    const created = await api().post('/api/help-resolution/cases').set(authed(customer)).send({
      kind: 'need_job_dispute',
      subjectType: 'need',
      subjectId: needId,
      reason: 'other',
      description: 'Evidence race.',
    });
    const caseId = dataOf<{ id: string }>(created).id;

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        api()
          .post(`/api/help-resolution/cases/${caseId}/evidence`)
          .set(authed(customer))
          .send({ uploadId: upload.id }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);

    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM resolution_case_evidence WHERE case_id = $1`,
      [caseId],
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('rolls a native message back when its timeline write fails', async () => {
    const customer = await seedUser('customer');
    const provider = await seedUser('expert');
    const needId = await seedActivatedNeed(customer.id, provider.id);
    const created = await api().post('/api/help-resolution/cases').set(authed(customer)).send({
      kind: 'need_job_dispute',
      subjectType: 'need',
      subjectId: needId,
      reason: 'other',
      description: 'Atomic message.',
    });
    const caseId = dataOf<{ id: string }>(created).id;

    await pool.query(`
      CREATE FUNCTION test_fail_message_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'participant_message' THEN RAISE EXCEPTION 'forced event failure'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER test_fail_message_event
        BEFORE INSERT ON resolution_case_events
        FOR EACH ROW EXECUTE FUNCTION test_fail_message_event()
    `);
    try {
      const response = await api()
        .post(`/api/help-resolution/cases/${caseId}/messages`)
        .set(authed(customer))
        .send({ body: 'Must roll back.' });
      expect(response.status).toBe(500);
      const { rows } = await pool.query<{ messages: string; status: string }>(
        `SELECT (SELECT count(*)::text FROM resolution_case_messages WHERE case_id = c.id) AS messages,
                c.status
           FROM resolution_cases c WHERE c.id = $1`,
        [caseId],
      );
      expect(rows[0]).toMatchObject({ messages: '0', status: 'open' });
    } finally {
      await pool.query(`DROP TRIGGER test_fail_message_event ON resolution_case_events`);
      await pool.query(`DROP FUNCTION test_fail_message_event()`);
    }
  });

  it('does not change activity or timeline when the message write fails', async () => {
    const customer = await seedUser('customer');
    const provider = await seedUser('expert');
    const needId = await seedActivatedNeed(customer.id, provider.id);
    const created = await api().post('/api/help-resolution/cases').set(authed(customer)).send({
      kind: 'need_job_dispute',
      subjectType: 'need',
      subjectId: needId,
      reason: 'other',
      description: 'Failed message.',
    });
    const caseId = dataOf<{ id: string }>(created).id;
    const { rows: before } = await pool.query<{ last_activity_at: Date; events: string }>(
      `SELECT c.last_activity_at,
              (SELECT count(*)::text FROM resolution_case_events WHERE case_id = c.id) AS events
         FROM resolution_cases c WHERE c.id = $1`,
      [caseId],
    );

    await pool.query(`
      CREATE FUNCTION test_fail_message_write() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced message failure'; END $$;
      CREATE TRIGGER test_fail_message_write
        BEFORE INSERT ON resolution_case_messages
        FOR EACH ROW EXECUTE FUNCTION test_fail_message_write()
    `);
    try {
      const response = await api()
        .post(`/api/help-resolution/cases/${caseId}/messages`)
        .set(authed(customer))
        .send({ body: 'Must fail first.' });
      expect(response.status).toBe(500);
      const { rows: after } = await pool.query<{ last_activity_at: Date; events: string }>(
        `SELECT c.last_activity_at,
                (SELECT count(*)::text FROM resolution_case_events WHERE case_id = c.id) AS events
           FROM resolution_cases c WHERE c.id = $1`,
        [caseId],
      );
      expect(after[0]!.events).toBe(before[0]!.events);
      expect(new Date(after[0]!.last_activity_at).getTime()).toBe(
        new Date(before[0]!.last_activity_at).getTime(),
      );
    } finally {
      await pool.query(`DROP TRIGGER test_fail_message_write ON resolution_case_messages`);
      await pool.query(`DROP FUNCTION test_fail_message_write()`);
    }
  });

  it('rolls a native message and timeline back when its status write fails', async () => {
    const customer = await seedUser('customer');
    const provider = await seedUser('expert');
    const needId = await seedActivatedNeed(customer.id, provider.id);
    const created = await api().post('/api/help-resolution/cases').set(authed(customer)).send({
      kind: 'need_job_dispute',
      subjectType: 'need',
      subjectId: needId,
      reason: 'other',
      description: 'Atomic status.',
    });
    const caseId = dataOf<{ id: string }>(created).id;

    await pool.query(`
      CREATE FUNCTION test_fail_case_status() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'forced status failure'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER test_fail_case_status
        BEFORE UPDATE ON resolution_cases
        FOR EACH ROW EXECUTE FUNCTION test_fail_case_status()
    `);
    try {
      const response = await api()
        .post(`/api/help-resolution/cases/${caseId}/messages`)
        .set(authed(customer))
        .send({ body: 'Must all roll back.' });
      expect(response.status).toBe(500);
      const { rows } = await pool.query<{ messages: string; events: string; status: string }>(
        `SELECT (SELECT count(*)::text FROM resolution_case_messages WHERE case_id = c.id) AS messages,
                (SELECT count(*)::text FROM resolution_case_events
                  WHERE case_id = c.id AND event_type = 'participant_message') AS events,
                c.status
           FROM resolution_cases c WHERE c.id = $1`,
        [caseId],
      );
      expect(rows[0]).toMatchObject({ messages: '0', events: '0', status: 'open' });
    } finally {
      await pool.query(`DROP TRIGGER test_fail_case_status ON resolution_cases`);
      await pool.query(`DROP FUNCTION test_fail_case_status()`);
    }
  });

  it('rolls native evidence back when its timeline write fails', async () => {
    const customer = await seedUser('customer');
    const provider = await seedUser('expert');
    const needId = await seedActivatedNeed(customer.id, provider.id);
    const upload = await seedPrivateUpload(customer.id);
    const created = await api().post('/api/help-resolution/cases').set(authed(customer)).send({
      kind: 'need_job_dispute',
      subjectType: 'need',
      subjectId: needId,
      reason: 'other',
      description: 'Atomic evidence.',
    });
    const caseId = dataOf<{ id: string }>(created).id;

    await pool.query(`
      CREATE FUNCTION test_fail_evidence_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'evidence_added' THEN RAISE EXCEPTION 'forced event failure'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER test_fail_evidence_event
        BEFORE INSERT ON resolution_case_events
        FOR EACH ROW EXECUTE FUNCTION test_fail_evidence_event()
    `);
    try {
      const response = await api()
        .post(`/api/help-resolution/cases/${caseId}/evidence`)
        .set(authed(customer))
        .send({ uploadId: upload.id });
      expect(response.status).toBe(500);
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM resolution_case_evidence WHERE case_id = $1`,
        [caseId],
      );
      expect(rows[0]?.count).toBe('0');
    } finally {
      await pool.query(`DROP TRIGGER test_fail_evidence_event ON resolution_case_events`);
      await pool.query(`DROP FUNCTION test_fail_evidence_event()`);
    }
  });

  it('rolls a legacy support reply back when its status write fails', async () => {
    const user = await seedUser('customer');
    const created = await api()
      .post('/api/support/tickets')
      .set(authed(user))
      .send({ category: 'other', subject: 'Atomic legacy reply', body: 'Opening message' });
    const ticketId = dataOf<{ id: string }>(created).id;

    await pool.query(`
      CREATE FUNCTION test_fail_support_status() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'forced support status failure'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER test_fail_support_status
        BEFORE UPDATE ON support_tickets
        FOR EACH ROW EXECUTE FUNCTION test_fail_support_status()
    `);
    try {
      const response = await api()
        .post(`/api/support/tickets/${ticketId}/messages`)
        .set(authed(user))
        .send({ body: 'Must roll back.' });
      expect(response.status).toBe(500);
      const { rows } = await pool.query<{ messages: string; status: string }>(
        `SELECT (SELECT count(*)::text FROM support_ticket_messages WHERE ticket_id = t.id) AS messages,
                t.status
           FROM support_tickets t WHERE t.id = $1`,
        [ticketId],
      );
      expect(rows[0]).toMatchObject({ messages: '1', status: 'open' });
    } finally {
      await pool.query(`DROP TRIGGER test_fail_support_status ON support_tickets`);
      await pool.query(`DROP FUNCTION test_fail_support_status()`);
    }
  });

  it('rolls a support resolution message back when final resolution fails', async () => {
    const user = await seedUser('customer');
    const admin = await seedUser('customer', { isAdmin: true, permissions: ['manage_support'] });
    const created = await api()
      .post('/api/support/tickets')
      .set(authed(user))
      .send({ category: 'other', subject: 'Atomic support resolution', body: 'Opening message' });
    const ticketId = dataOf<{ id: string }>(created).id;
    const found = await api()
      .get(`/api/help-resolution/cases/by-support-ticket/${ticketId}`)
      .set(authed(user));
    const caseId = dataOf<{ id: string }>(found).id;

    await pool.query(`
      CREATE FUNCTION test_fail_support_resolution() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.status IN ('resolved', 'closed') THEN RAISE EXCEPTION 'forced resolution failure'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER test_fail_support_resolution
        BEFORE UPDATE ON support_tickets
        FOR EACH ROW EXECUTE FUNCTION test_fail_support_resolution()
    `);
    try {
      const response = await api()
        .post(`/api/help-resolution/admin/cases/${caseId}/resolve`)
        .set(authed(admin))
        .send({ outcome: 'resolved_for_opener', notes: 'Must not survive.' });
      expect(response.status).toBe(500);
      const { rows } = await pool.query<{ messages: string; status: string }>(
        `SELECT (SELECT count(*)::text FROM support_ticket_messages WHERE ticket_id = t.id) AS messages,
                t.status
           FROM support_tickets t WHERE t.id = $1`,
        [ticketId],
      );
      expect(rows[0]).toMatchObject({ messages: '1', status: 'open' });
    } finally {
      await pool.query(`DROP TRIGGER test_fail_support_resolution ON support_tickets`);
      await pool.query(`DROP FUNCTION test_fail_support_resolution()`);
    }
  });
});

// ---------------------------------------------------------------------------

suite('help & resolution — notifications and deep links', () => {
  it('notifies the counterparty with a payload the centre can open', async () => {
    const customer = await seedUser('customer');
    const provider = await seedUser('expert');
    const needId = await seedActivatedNeed(customer.id, provider.id);

    const created = await api().post('/api/help-resolution/cases').set(authed(customer)).send({
      kind: 'need_job_dispute',
      subjectType: 'need',
      subjectId: needId,
      reason: 'not_delivered',
      description: 'Nothing delivered.',
    });
    const caseId = dataOf<{ id: string }>(created).id;
    const referenceCode = dataOf<{ referenceCode: string }>(created).referenceCode;

    // Notifications are fire-and-forget; give the insert a moment to land.
    await vi.waitFor(async () => {
      const { rows } = await pool.query<{ type: string; payload: Record<string, unknown> }>(
        `SELECT type, payload FROM notifications WHERE user_id = $1 ORDER BY created_at DESC`,
        [provider.id],
      );
      expect(rows[0]?.type).toBe('resolution_case_opened');
      expect(rows[0]?.payload.caseId).toBe(caseId);
      expect(rows[0]?.payload.referenceCode).toBe(referenceCode);
    });

    // And the opener is not notified about their own action.
    const { rows: openerRows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM notifications
        WHERE user_id = $1 AND type LIKE 'resolution_case_%'`,
      [customer.id],
    );
    expect(openerRows[0]?.count).toBe('0');
  });

  it('resolves historical deep links and refuses them for strangers', async () => {
    const user = await seedUser('customer');
    const stranger = await seedUser('customer');
    const created = await api()
      .post('/api/support/tickets')
      .set(authed(user))
      .send({ category: 'other', subject: 'Deep link', body: 'Body' });
    const ticketId = dataOf<{ id: string }>(created).id;

    const mine = await api()
      .get(`/api/help-resolution/cases/by-support-ticket/${ticketId}`)
      .set(authed(user));
    expect(mine.status).toBe(200);
    expect(dataOf<{ supportTicketId: string }>(mine).supportTicketId).toBe(ticketId);

    const theirs = await api()
      .get(`/api/help-resolution/cases/by-support-ticket/${ticketId}`)
      .set(authed(stranger));
    expect(theirs.status).toBe(404);
  });
});
