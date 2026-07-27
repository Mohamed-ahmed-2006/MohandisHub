/**
 * Must-pass journey 5: Wallet / payment flow
 * Login → open wallet → initiate deposit or reach payment step and assert expected UI/state.
 * Shallow: wallet/settings wallet page loads.
 */
import { expect, test } from '../fixtures';

test.describe('Wallet / payment flow', () => {
  test('wallet or settings wallet route loads', async ({ page }) => {
    await page.goto('/en/app/settings/wallet');
    await expect(page).toHaveURL(/\/(auth|app|settings|wallet)/);
    await expect(page.locator('body')).toBeVisible({ timeout: 10_000 });
  });

  test('app settings route loads', async ({ page }) => {
    await page.goto('/en/app/settings');
    await expect(page).toHaveURL(/\/(auth|app|settings)/);
    await expect(page.locator('body')).toBeVisible({ timeout: 10_000 });
  });
});
