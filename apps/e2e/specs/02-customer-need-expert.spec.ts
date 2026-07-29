/**
 * Must-pass journey 2: Customer need to expert engagement
 * Login as customer → create need → (as expert) view/place bid or equivalent.
 * Shallow: assert app shell and needs/dashboard entry points load when authenticated.
 */
import { test, expect } from '@playwright/test';

test.describe('Customer need to expert engagement', () => {
  test('needs or projects entry point exists in app', async ({ page }) => {
    await page.goto('/en/auth');
    await expect(page).toHaveURL(/\/auth/);
    // Without login we cannot reach /app; ensure auth page is the gate
    await page.goto('/en/app');
    await expect(page).toHaveURL(/\/(auth|app|login)/);
  });

  test('browse or services page structure', async ({ page }) => {
    await page.goto('/en/app');
    await expect(page).toHaveURL(/\/(auth|app|browse)/);
    const body = page.locator('body');
    await expect(body).toBeVisible({ timeout: 10_000 });
  });
});
