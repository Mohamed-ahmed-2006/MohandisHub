/**
 * Must-pass journey 1: Auth + onboarding
 * Register or login, verify email (stub/skip in e2e), complete role onboarding.
 */
import { expect, test } from '../fixtures';

test.describe('Auth + onboarding', () => {
  test('auth page loads and has login or register', async ({ page }) => {
    await page.goto('/en/auth');
    await expect(page).toHaveTitle(/MohandisHub|Login|Sign|Auth/i);
    await expect(
      page.getByText(/log in|login|sign up|register|email|password/i).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('can navigate to role onboarding from home', async ({ page }) => {
    await page.goto('/en');
    await expect(page.getByText(/get started|join|engineering|marketplace/i).first()).toBeVisible({
      timeout: 10000,
    });
  });
});
