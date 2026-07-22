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
    expect(enDictionary.home.footerText.length).toBeGreaterThan(0);
    expect(enDictionary.home.footerLegalNavAria).toBe('Legal links');
    expect(enDictionary.home.footerPrivacy).toBe('Privacy Policy');
    expect(enDictionary.home.footerTerms).toBe('Terms & Conditions');
    expect(arDictionary.common.appName).toBe('مهندس هب');
    expect(enDictionary.jobsWorkspace.businessTitle).toBe('My Hiring Posts');
    expect(arDictionary.jobsWorkspace.businessTitle).toBe('منشورات التوظيف الخاصة بي');
    expect(arDictionary.home.footerText.length).toBeGreaterThan(0);
    expect(arDictionary.home.footerLegalNavAria).toBe('روابط قانونية');
    expect(arDictionary.home.footerPrivacy).toBe('سياسة الخصوصية');
    expect(arDictionary.home.footerTerms).toBe('الشروط والأحكام');
  });
});
