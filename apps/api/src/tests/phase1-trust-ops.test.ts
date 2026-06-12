import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const apiRoot = process.cwd();
const repoRoot = join(apiRoot, '..', '..');
const readApi = (path: string) => readFileSync(join(apiRoot, path), 'utf8');
const readRoot = (path: string) => readFileSync(join(repoRoot, path), 'utf8');

describe('Phase 1 trust operations wiring', () => {
  it('adds backend-only reservation dispute case files with evidence and notes', () => {
    const migration = readRoot(
      'supabase/migrations/20260611143000_phase1_dispute_cases_money_audit.sql',
    );
    const routes = readApi('src/modules/reservations/reservations.routes.ts');
    const service = readApi('src/modules/reservations/reservations.service.ts');

    expect(migration).toContain('reservation_dispute_notes');
    expect(migration).toContain('reservation_dispute_evidence');
    expect(migration).toContain('REVOKE ALL ON TABLE public.%I FROM anon, authenticated');
    expect(routes).toContain('/dispute-cases/my');
    expect(routes).toContain('/admin/dispute-cases');
    expect(routes).toContain('/disputes/:disputeId/evidence');
    expect(service).toContain('privateUploadBelongsToUser');
    expect(service).toContain('buildDisputeCase');
    expect(service).toContain('moneyEvents: moneyEvents.map(mapDisputeMoneyEvent)');
  });

  it('exposes admin money audit and Paymob readiness without secrets', () => {
    const routes = readApi('src/modules/admin/admin.routes.ts');
    const repo = readApi('src/modules/admin/admin.repository.ts');
    const service = readApi('src/modules/admin/admin.service.ts');

    expect(routes).toContain('/money-audit');
    expect(routes).toContain('/paymob-readiness');
    expect(repo).toContain('WITH audit AS');
    expect(repo).toContain('reservation_action_failures');
    expect(repo).toContain('paymob_transaction_id');
    expect(service).toContain('missingDepositKeys');
    expect(service).toContain('PAYMOB_SECRET_KEY');
    expect(service).not.toContain('secretValue');
  });

  it('keeps Paymob runtime-gated instead of production-boot-gated', () => {
    const env = readApi('src/config/env.ts');
    const paymob = readApi('src/lib/paymob.client.ts');

    expect(paymob).toContain('PAYMOB_NOT_CONFIGURED');
    expect(paymob).toContain('isPaymobDepositConfigured');
    expect(env).not.toContain(
      'Paymob secret + public keys are required when PAYMOB_DEPOSITS_ENABLED=true.',
    );
    expect(env).toContain('Paymob production withdrawals must not use a staging payout endpoint.');
  });
});
