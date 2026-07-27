import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = join(process.cwd(), '..', '..');
const readFromRoot = (path: string) => readFileSync(join(repoRoot, path), 'utf8');

describe('Phase 5 database and storage hardening', () => {
  it('enables backend-only RLS posture and revokes browser table grants', () => {
    const migration = readFromRoot(
      'supabase/migrations/20260610132000_backend_only_rls_storage_indexes.sql',
    );

    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL ON TABLE public.%I FROM anon, authenticated');
    expect(migration).toContain('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL');
    expect(migration).toContain("'wallets'");
    expect(migration).toContain("'reservations'");
    expect(migration).toContain("'private_uploads'");
  });

  it('keeps public uploads readable and private verification files backend-only', () => {
    const migration = readFromRoot(
      'supabase/migrations/20260610132000_backend_only_rls_storage_indexes.sql',
    );

    expect(migration).toContain('ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('DROP POLICY IF EXISTS');
    expect(migration).toContain('Public uploads are readable');
    expect(migration).toContain("USING (bucket_id = 'uploads')");
    expect(migration).toContain('verification-docs');
    expect(migration).not.toContain("bucket_id = 'verification-docs'");
  });

  it('adds operational indexes for queues, sweeps, audit, and message lookups', () => {
    const migration = readFromRoot(
      'supabase/migrations/20260610132000_backend_only_rls_storage_indexes.sql',
    );

    expect(migration).toContain('idx_refresh_tokens_user_revoked_expires');
    expect(migration).toContain('idx_verification_codes_lookup_unexpired');
    expect(migration).toContain('idx_messages_conversation_created_desc');
    expect(migration).toContain('idx_audit_log_resource_created');
    expect(migration).toContain('idx_deposit_requests_review_queue');
    expect(migration).toContain('idx_withdrawal_requests_review_queue');
    expect(migration).toContain('idx_reservations_pending_expiry');
    expect(migration).toContain('idx_reservation_disputes_open_created');
  });

  it('documents production backup, migration, storage, and Paymob operations', () => {
    const runbook = readFromRoot('docs/PRODUCTION_RUNBOOK.md');

    expect(runbook).toContain('scripts/push-migrations.mjs` is staging-only');
    expect(runbook).toContain('Production migration is a separate, explicitly approved');
    expect(runbook).toContain('Take a Supabase backup before production migrations');
    expect(runbook).toContain('Browser access to database tables is intentionally denied');
    expect(runbook).toContain('Paymob deposits and withdrawals are implemented');
  });
});
