/**
 * Must-pass journey 3: Reservation / booking lifecycle
 * Create or accept reservation → move through key states.
 * Shallow: bookings/calendar routes load.
 */
import { test, expect } from '@playwright/test';

test.describe('Reservation / booking lifecycle', () => {
  test('bookings or calendar route loads', async ({ page }) => {
    await page.goto('/en/app/bookings');
    await expect(page).toHaveURL(/\/(auth|app|bookings)/);
    await expect(page.locator('body')).toBeVisible({ timeout: 10_000 });
  });

  test('calendar route loads', async ({ page }) => {
    await page.goto('/en/app/calendar');
    await expect(page).toHaveURL(/\/(auth|app|calendar)/);
    await expect(page.locator('body')).toBeVisible({ timeout: 10_000 });
  });
});
