import { expect, test } from '@playwright/test';

type InteractiveRect = {
  height: number;
  name: string;
  width: number;
  x: number;
  y: number;
};

const findOverlaps = (items: InteractiveRect[]) => {
  const overlaps: string[] = [];

  for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
      const left = items[leftIndex];
      const right = items[rightIndex];
      if (!left || !right) continue;

      const intersectionWidth = Math.max(
        0,
        Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
      );
      const intersectionHeight = Math.max(
        0,
        Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
      );

      if (intersectionWidth * intersectionHeight > 16) {
        overlaps.push(`${left.name} overlaps ${right.name}`);
      }
    }
  }

  return overlaps;
};

test.describe('Public responsive accessibility', () => {
  for (const locale of ['en', 'ar']) {
    test(`${locale} mobile header keeps interactive targets separate`, async ({ page }) => {
      const consoleErrors: string[] = [];
      const failedRequests: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('pageerror', (error) => consoleErrors.push(error.message));
      page.on('requestfailed', (request) => {
        failedRequests.push(`${request.method()} ${request.url()}`);
      });

      await page.setViewportSize({ width: 320, height: 568 });
      await page.goto(`/${locale}`);
      await expect(page.locator('h1')).toBeVisible();

      const interactiveRects = await page.locator('header').evaluate((header) =>
        Array.from(header.querySelectorAll<HTMLAnchorElement | HTMLButtonElement>('a, button'))
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              height: rect.height,
              name:
                element.getAttribute('aria-label') ||
                element.textContent?.trim() ||
                element.tagName,
              width: rect.width,
              x: rect.x,
              y: rect.y,
            };
          })
          .filter((rect) => rect.width > 0 && rect.height > 0),
      );

      expect(findOverlaps(interactiveRects)).toEqual([]);
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      expect(consoleErrors).toEqual([]);
      expect(failedRequests).toEqual([]);
    });
  }
});
