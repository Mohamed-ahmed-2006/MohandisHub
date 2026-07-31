import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const readSource = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

describe('phase 2-5 product value foundations', () => {
  it('keeps critical notifications from being fully disabled', () => {
    const service = readSource('../modules/notifications/notifications.service.ts');
    const routes = readSource('../modules/notifications/notifications.routes.ts');

    expect(service).toContain('REQUIRED_IN_APP');
    expect(service).toContain('isNotificationChannelRequired');
    expect(service).toContain('required || (storedMap.get');
    expect(routes).toContain('/preferences');
    expect(routes).toContain('/push/subscriptions');
  });

  it('requires coupon funding and stores a redemption ledger', () => {
    const service = readSource('../modules/coupons/coupons.service.ts');
    const repository = readSource('../modules/coupons/coupons.repository.ts');
    const migration = readSource(
      '../../../../supabase/migrations/20260613120000_phase2_5_product_value.sql',
    );

    expect(service).toContain('COUPON_FUNDING_REQUIRED');
    expect(service).toContain('selectBestCoupon');
    expect(repository).toContain('coupon_redemptions');
    expect(repository).toContain('use_count = use_count + 1');
    expect(repository).not.toContain("status <> 'reversed'");
    expect(migration).toContain('funding_source TEXT');
  });

  it('mounts saved searches, recommendations, and business teams as real APIs', () => {
    const routes = readSource('../routes/index.ts');
    const businessTeams = readSource('../modules/business-teams/business-teams.routes.ts');
    // Wave 2G split the single route file into routes, a service and an
    // authorization layer. The built-in roles moved with the model that owns
    // them; the claim being made here — business teams have built-in roles, and
    // deleting a custom one requires a replacement — is unchanged.
    const businessTeamRoles = readSource('../modules/business-teams/business-teams.constants.ts');
    const businessTeamService = readSource('../modules/business-teams/business-teams.service.ts');
    const recommendations = readSource('../modules/recommendations/recommendations.repository.ts');

    expect(routes).toContain("apiRouter.use('/saved-searches'");
    expect(routes).toContain("apiRouter.use('/recommendations'");
    expect(routes).toContain("apiRouter.use('/business-teams'");
    expect(businessTeamRoles).toContain('BUILT_IN_ROLE_SEEDS');
    expect(businessTeams).toContain('replacementRoleId');
    expect(businessTeamService).toContain('replacementRoleId');
    expect(recommendations).toContain('personalized_enabled');
    expect(recommendations).toContain('if (!consent.personalizedRecommendationsEnabled) return;');
  });

  it('gates push, SMS adapters, and restore operations by explicit configuration and approval', () => {
    const env = readSource('../config/env.ts');
    const otp = readSource('../modules/otp/otp.provider.ts');
    const operations = readSource('../modules/operations/backup-restore.routes.ts');

    expect(env).toContain('WEB_PUSH_ENABLED');
    expect(env).toContain('SMS_HTTP_ENDPOINT');
    expect(env).toContain('META_WHATSAPP_TOKEN');
    expect(otp).toContain('HttpAdapterSmsSender');
    expect(otp).toContain('MetaWhatsAppOtpSender');
    expect(operations).toContain('SECOND_APPROVER_REQUIRED');
    expect(operations).toContain("z.literal('RESTORE')");
  });
});
