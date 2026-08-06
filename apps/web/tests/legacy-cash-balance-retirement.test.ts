import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { getVisibleProfileSections } from '@/components/profile/profile-screen-sections';

const readSource = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

describe('legacy Cash Balance retirement', () => {
  it.each(['customer', 'expert', 'craftsman', 'business'])(
    'does not show a Cash Balance settings section for %s',
    (role) => {
      expect(getVisibleProfileSections(role).map((section) => section.id)).not.toContain('wallet');
    },
  );

  it('retires the role-agnostic wallet deep link to ordinary settings', () => {
    const route = readSource('../app/[locale]/app/settings/wallet/page.tsx');

    expect(route).toContain('redirect(`/${locale}/app/settings`)');
    expect(route).not.toContain('tab=wallet');
    expect(route).not.toContain('/app/credits');
  });

  it('removes the legacy wallet page from settings and normal navigation', () => {
    const profile = readSource('../components/profile/profile-screen.tsx');
    const avatarMenu = readSource('../components/app/app-avatar-menu.tsx');
    const sidebar = readSource('../components/app/app-sidebar.tsx');

    expect(profile).not.toContain('WalletSettingsScreen');
    expect(profile).not.toContain('Cash Balance (EGP)');
    expect(profile).not.toContain("tabParam === 'wallet'");
    expect(profile).not.toContain("activeTab === 'wallet'");
    expect(avatarMenu).not.toContain('tab=wallet');
    expect(sidebar).not.toContain('/app/settings/wallet');
  });

  it('leaves no reachable deposit or withdrawal controls in the retired page', () => {
    const profile = readSource('../components/profile/profile-screen.tsx');
    const route = readSource('../app/[locale]/app/settings/wallet/page.tsx');

    expect(profile).not.toContain('WalletDepositModal');
    expect(profile).not.toContain('createWithdrawal');
    expect(route).not.toContain('WalletSettingsScreen');
  });

  it('does not offer the retired EGP balance as a customer payment action', () => {
    const customerDashboard = readSource('../components/app/customer-dashboard.tsx');

    expect(customerDashboard).not.toContain('walletApiClient');
    expect(customerDashboard).not.toContain('needsApiClient.payBid');
    expect(customerDashboard).not.toContain('Pay Expert');
  });
});
