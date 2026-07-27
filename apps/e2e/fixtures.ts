import { expect, test as base } from '@playwright/test';

export { expect };

export const test = base.extend({
  page: async ({ page }, use) => {
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];

    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    page.on('requestfailed', (request) => {
      failedRequests.push(
        `${request.method()} ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`,
      );
    });

    await use(page);

    expect(consoleErrors, 'uncaught browser console/page errors').toEqual([]);
    expect(failedRequests, 'unexpected browser network failures').toEqual([]);
  },
});
