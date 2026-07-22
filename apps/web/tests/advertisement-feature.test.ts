import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { isAdsUiEnabled } from '@/lib/advertisements/feature';

describe('advertising launch gate', () => {
  const original = process.env.NEXT_PUBLIC_ENABLE_ADS;

  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_ENABLE_ADS;
    else process.env.NEXT_PUBLIC_ENABLE_ADS = original;
  });

  it('is fail-closed unless the flag is exactly true', () => {
    delete process.env.NEXT_PUBLIC_ENABLE_ADS;
    expect(isAdsUiEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_ENABLE_ADS = 'TRUE';
    expect(isAdsUiEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_ENABLE_ADS = 'true';
    expect(isAdsUiEnabled()).toBe(true);
  });

  it('uses the shared gate for display, navigation, and the campaign page', () => {
    const slideshow = readFileSync(
      new URL('../components/app/ad-slideshow.tsx', import.meta.url),
      'utf8',
    );
    const sidebar = readFileSync(
      new URL('../components/app/app-sidebar.tsx', import.meta.url),
      'utf8',
    );
    const page = readFileSync(
      new URL('../app/[locale]/app/advertisements/page.tsx', import.meta.url),
      'utf8',
    );
    for (const source of [slideshow, sidebar, page]) {
      expect(source).toContain('isAdsUiEnabled');
    }
  });
});
