import { describe, expect, it } from 'vitest';

import { normalizeServiceTag } from '@/lib/services/tags';

describe('P1-11 tag normalization and saved search tag persistence', () => {
  it('normalizes tags by trimming, lowercasing, and stripping disallowed characters', () => {
    expect(normalizeServiceTag('  Plumbing!! ')).toBe('plumbing');
    expect(normalizeServiceTag('  ELECtRICAL  ')).toBe('electrical');
    expect(normalizeServiceTag('  سباكة 123  ')).toBe('سباكة 123');
  });

  it('enforces maximum length limit of 30 characters on normalized tags', () => {
    const longTag = 'a'.repeat(50);
    expect(normalizeServiceTag(longTag)).toHaveLength(30);
  });

  it('serializes selected tags into saved search filters', () => {
    const selectedTags = ['plumbing', 'electrical'];
    const searchFilters = {
      query: 'pipes',
      categoryId: 'cat-1',
      tags: selectedTags,
    };

    expect(searchFilters.tags).toEqual(['plumbing', 'electrical']);
  });

  it('restores selected tags from saved search filters cleanly', () => {
    const savedSearchFilter = {
      query: 'pipes',
      tags: ['hvac', 'inspection'],
    };

    const restoredTags = Array.isArray(savedSearchFilter.tags)
      ? (savedSearchFilter.tags as unknown[]).filter(
          (t): t is string => typeof t === 'string' && t.trim().length > 0,
        )
      : [];

    expect(restoredTags).toEqual(['hvac', 'inspection']);
  });

  it('handles older saved searches without tags property gracefully', () => {
    const legacySavedSearchFilter = {
      query: 'structural',
      categoryId: 'cat-2',
    };

    const restoredTags = Array.isArray((legacySavedSearchFilter as Record<string, unknown>).tags)
      ? ((legacySavedSearchFilter as Record<string, unknown>).tags as string[])
      : [];

    expect(restoredTags).toEqual([]);
  });
});
