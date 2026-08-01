import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProviderPaymentsService } from '../modules/provider-payments/provider-payments.service.js';
import { upsertPaymentMethodSchema } from '../modules/provider-payments/provider-payments.validation.js';

const poolQueryMock = vi.fn();
vi.mock('../db/pool.js', () => ({
  getPool: () => ({ query: poolQueryMock, connect: vi.fn() }),
}));

const METHOD_ROW = {
  id: 'pm-1',
  user_id: 'provider-1',
  method_type: 'instapay',
  label: 'Main',
  details: { instapayAddress: 'ahmed@instapay', accountHolderName: 'Ahmed Ali' },
  is_active: true,
  sort_order: 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

function buildService(overrides: {
  repo?: Record<string, unknown>;
  activated?: boolean;
  gateEnabled?: boolean;
}) {
  const repo = {
    listForProvider: vi.fn().mockResolvedValue([METHOD_ROW]),
    findById: vi.fn().mockResolvedValue(METHOD_ROW),
    countActive: vi.fn().mockResolvedValue(1),
    create: vi.fn().mockResolvedValue(METHOD_ROW),
    update: vi.fn().mockResolvedValue(METHOD_ROW),
    remove: vi.fn().mockResolvedValue(true),
    findAwardActivation: vi
      .fn()
      .mockResolvedValue({ id: 'act-1', provider_user_id: 'provider-1', need_id: 'need-1' }),
    discloseForActivation: vi
      .fn()
      .mockResolvedValue({ methods: [METHOD_ROW], firstDisclosure: true }),
    listDisclosuresForProvider: vi.fn().mockResolvedValue([]),
    ...(overrides.repo ?? {}),
  };
  const gate = {
    isGateEnabled: vi.fn().mockResolvedValue(overrides.gateEnabled ?? true),
    isAwardActivated: vi.fn().mockResolvedValue(overrides.activated ?? true),
    assertAwardActivated: vi.fn(async (bidId: string) => {
      if (overrides.gateEnabled === false) return;
      if (!(overrides.activated ?? true)) {
        const { HttpError } = await import('../utils/http-error.js');
        throw new HttpError({
          statusCode: 402,
          code: 'MHC_ACTIVATION_REQUIRED',
          message: 'locked',
          details: { bidId },
        });
      }
    }),
  };
  return { service: new ProviderPaymentsService(repo as never, gate as never), repo, gate };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('provider payment methods — validation', () => {
  it('accepts a well-formed InstaPay method', () => {
    const parsed = upsertPaymentMethodSchema.safeParse({
      methodType: 'instapay',
      details: { instapayAddress: 'ahmed@instapay', accountHolderName: 'Ahmed Ali' },
    });
    expect(parsed.success).toBe(true);
  });

  it.each([
    ['not-an-address', 'missing @'],
    ['@instapay', 'no local part'],
  ])('rejects a malformed InstaPay address (%s)', (instapayAddress) => {
    const parsed = upsertPaymentMethodSchema.safeParse({
      methodType: 'instapay',
      details: { instapayAddress, accountHolderName: 'Ahmed Ali' },
    });
    expect(parsed.success).toBe(false);
  });

  it('normalises Arabic-Indic digits in a mobile wallet number', () => {
    const parsed = upsertPaymentMethodSchema.safeParse({
      methodType: 'mobile_wallet',
      details: {
        walletProvider: 'vodafone_cash',
        phoneNumber: '٠١٠١٢٣٤٥٦٧٨',
        accountHolderName: 'Ahmed Ali',
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.methodType === 'mobile_wallet') {
      expect(parsed.data.details.phoneNumber).toBe('01012345678');
    }
  });

  it('rejects a non-Egyptian mobile number', () => {
    const parsed = upsertPaymentMethodSchema.safeParse({
      methodType: 'mobile_wallet',
      details: {
        walletProvider: 'vodafone_cash',
        phoneNumber: '0791234567',
        accountHolderName: 'Ahmed Ali',
      },
    });
    expect(parsed.success).toBe(false);
  });

  it('requires an account number or IBAN for a bank transfer', () => {
    const parsed = upsertPaymentMethodSchema.safeParse({
      methodType: 'bank_transfer',
      details: { bankName: 'CIB', accountHolderName: 'Ahmed Ali' },
    });
    expect(parsed.success).toBe(false);
  });

  it('strips unknown keys rather than persisting arbitrary JSON', () => {
    const parsed = upsertPaymentMethodSchema.safeParse({
      methodType: 'instapay',
      details: {
        instapayAddress: 'ahmed@instapay',
        accountHolderName: 'Ahmed Ali',
        // A provider must not be able to smuggle free text into what a customer
        // is shown as payment instructions.
        note: 'Actually send to my other account 01099999999',
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.details).not.toHaveProperty('note');
  });

  it('rejects an unknown method type', () => {
    const parsed = upsertPaymentMethodSchema.safeParse({
      methodType: 'paypal',
      details: { anything: true },
    });
    expect(parsed.success).toBe(false);
  });
});

describe('provider payment methods — ownership', () => {
  it('refuses customers', async () => {
    const { service } = buildService({});
    await expect(service.listMine({ userId: 'cust-1', role: 'customer' })).rejects.toMatchObject({
      code: 'PROVIDERS_ONLY',
      statusCode: 403,
    });
  });

  it("reports another provider's method as not found rather than forbidden", async () => {
    // A 403 would confirm the id exists and belongs to someone.
    const { service } = buildService({
      repo: { findById: vi.fn().mockResolvedValue({ ...METHOD_ROW, user_id: 'someone-else' }) },
    });

    await expect(
      service.update({
        userId: 'provider-1',
        role: 'expert',
        id: 'pm-1',
        input: {
          methodType: 'instapay',
          details: { instapayAddress: 'x@instapay', accountHolderName: 'Ahmed Ali' },
        } as never,
      }),
    ).rejects.toMatchObject({ code: 'PAYMENT_METHOD_NOT_FOUND', statusCode: 404 });
  });

  it('refuses to change a method type in place', async () => {
    const { service } = buildService({});
    await expect(
      service.update({
        userId: 'provider-1',
        role: 'expert',
        id: 'pm-1',
        input: {
          methodType: 'bank_transfer',
          details: { bankName: 'CIB', accountHolderName: 'Ahmed Ali', iban: undefined },
        } as never,
      }),
    ).rejects.toMatchObject({ code: 'METHOD_TYPE_IMMUTABLE' });
  });

  it('caps the number of saved methods', async () => {
    const { service } = buildService({
      repo: { listForProvider: vi.fn().mockResolvedValue(new Array(6).fill(METHOD_ROW)) },
    });
    await expect(
      service.create({
        userId: 'provider-1',
        role: 'expert',
        input: {
          methodType: 'instapay',
          details: { instapayAddress: 'x@instapay', accountHolderName: 'Ahmed Ali' },
        } as never,
      }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_PAYMENT_METHODS' });
  });
});

describe('provider payment methods — activation precondition (D5)', () => {
  it('passes when the provider has an active method', async () => {
    const { service } = buildService({});
    await expect(service.assertHasActivePaymentMethod('provider-1')).resolves.toBeUndefined();
  });

  it('blocks activation when the provider has none, before any charge', async () => {
    const { service } = buildService({ repo: { countActive: vi.fn().mockResolvedValue(0) } });
    await expect(service.assertHasActivePaymentMethod('provider-1')).rejects.toMatchObject({
      code: 'NO_ACTIVE_PAYMENT_METHOD',
      statusCode: 409,
    });
  });
});

describe('provider payment details — customer disclosure', () => {
  const jobRow = { need_id: 'need-1', customer_id: 'customer-1', expert_id: 'provider-1' };
  const mockJob = () => poolQueryMock.mockResolvedValue({ rows: [jobRow] });

  it('discloses to the customer of an activated award', async () => {
    const { service, repo } = buildService({ activated: true });
    mockJob();

    const result = await service.discloseForAward({ bidId: 'bid-1', requesterId: 'customer-1' });
    expect(result.methods).toHaveLength(1);
    expect(result.methods[0]!.details).toMatchObject({ instapayAddress: 'ahmed@instapay' });
    expect(repo.discloseForActivation).toHaveBeenCalledWith({
      activationId: 'act-1',
      providerUserId: 'provider-1',
      customerUserId: 'customer-1',
    });
  });

  it('refuses a non-participant', async () => {
    const { service, repo } = buildService({ activated: true });
    mockJob();

    await expect(
      service.discloseForAward({ bidId: 'bid-1', requesterId: 'stranger' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    expect(repo.discloseForActivation).not.toHaveBeenCalled();
  });

  it('refuses the PROVIDER — only the payer needs these', async () => {
    const { service, repo } = buildService({ activated: true });
    mockJob();

    await expect(
      service.discloseForAward({ bidId: 'bid-1', requesterId: 'provider-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(repo.discloseForActivation).not.toHaveBeenCalled();
  });

  it('returns 402 and discloses nothing when the award is not activated', async () => {
    const { service, repo } = buildService({ activated: false });
    mockJob();

    await expect(
      service.discloseForAward({ bidId: 'bid-1', requesterId: 'customer-1' }),
    ).rejects.toMatchObject({ code: 'MHC_ACTIVATION_REQUIRED', statusCode: 402 });
    expect(repo.discloseForActivation).not.toHaveBeenCalled();
  });

  it('is idempotent on repeat disclosure', async () => {
    const { service, repo } = buildService({ activated: true });
    (repo.discloseForActivation as ReturnType<typeof vi.fn>).mockResolvedValue({
      methods: [METHOD_ROW],
      firstDisclosure: false,
    });
    mockJob();

    const first = await service.discloseForAward({ bidId: 'bid-1', requesterId: 'customer-1' });
    const second = await service.discloseForAward({ bidId: 'bid-1', requesterId: 'customer-1' });
    expect(second.methods).toEqual(first.methods);
  });

  it('refuses when the gate is off but no activation was ever recorded', async () => {
    // Nothing to audit the disclosure against, so nothing is disclosed.
    const { service, repo } = buildService({
      gateEnabled: false,
      repo: { findAwardActivation: vi.fn().mockResolvedValue(null) },
    });
    mockJob();

    await expect(
      service.discloseForAward({ bidId: 'bid-1', requesterId: 'customer-1' }),
    ).rejects.toMatchObject({ code: 'ACTIVATION_NOT_RECORDED', statusCode: 409 });
    expect(repo.discloseForActivation).not.toHaveBeenCalled();
  });

  it('reports an unknown bid as not found', async () => {
    const { service } = buildService({ activated: true });
    poolQueryMock.mockResolvedValue({ rows: [] });

    await expect(
      service.discloseForAward({ bidId: 'nope', requesterId: 'customer-1' }),
    ).rejects.toMatchObject({ code: 'BID_NOT_FOUND', statusCode: 404 });
  });
});
