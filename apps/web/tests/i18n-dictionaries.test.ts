import { describe, expect, it } from 'vitest';

import { arDictionary } from '@/lib/i18n/dictionaries/ar';
import { enDictionary } from '@/lib/i18n/dictionaries/en';

const commonMojibakeFragments = ['Â©', 'â€”', 'â€“', 'â€¦', 'â†’'];

const collectPaths = (value: unknown, basePath = ''): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectPaths(entry, `${basePath}[${index}]`));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, entry]) =>
      collectPaths(entry, basePath ? `${basePath}.${key}` : key),
    );
  }
  return [basePath];
};

const collectStrings = (value: unknown, basePath = ''): Array<{ path: string; value: string }> => {
  if (typeof value === 'string') {
    return [{ path: basePath, value }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectStrings(entry, `${basePath}[${index}]`));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, entry]) =>
      collectStrings(entry, basePath ? `${basePath}.${key}` : key),
    );
  }
  return [];
};

describe('i18n dictionaries', () => {
  it('keeps English and Arabic dictionaries structurally aligned', () => {
    const enPaths = collectPaths(enDictionary).sort();
    const arPaths = collectPaths(arDictionary).sort();

    expect(arPaths).toEqual(enPaths);
  });

  it('keeps runtime text free from replacement characters and known mojibake fragments', () => {
    const values = [...collectStrings(enDictionary), ...collectStrings(arDictionary)];

    for (const entry of values) {
      expect(entry.value).not.toContain('\uFFFD');
      for (const fragment of commonMojibakeFragments) {
        expect(entry.value).not.toContain(fragment);
      }
    }
  });

  it('preserves known high-value strings at runtime', () => {
    expect(enDictionary.home.footerText).toBe(
      '© 2026 Eng. Mohamed Ahmed · Contact us · Privacy Policy · Terms',
    );
    expect(enDictionary.home.trustVerified).toBe(
      'Verified professionals — identity and credentials checked.',
    );
    expect(arDictionary.common.appName).toBe('مهندس هب');
    expect(arDictionary.home.footerText).toBe(
      '© 2026 م. محمد أحمد · تواصل معنا · سياسة الخصوصية · الشروط والأحكام',
    );
  });
});
