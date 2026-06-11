import { describe, expect, it } from 'vitest';

import {
  parsePrivateUploadIdFromUrl,
  parseLocalUploadsBasenameFromUrl,
  parsePublicUploadsPathFromUrl,
} from '../lib/supabase-storage.js';
import { mergeRetentionHours } from '../modules/retention/retention.merge.js';

describe('mergeRetentionHours', () => {
  it('returns null when env value is 0 (disabled)', () => {
    expect(mergeRetentionHours({ enabled: true, value: 48, unit: 'hours' }, 0, 'hours')).toBeNull();
    expect(mergeRetentionHours(undefined, 0, 'days')).toBeNull();
  });

  it('uses env ceiling only when admin policy is missing', () => {
    expect(mergeRetentionHours(undefined, 72, 'hours')).toBe(72);
    expect(mergeRetentionHours(undefined, 2, 'days')).toBe(48);
  });

  it('returns null when admin disables or value is 0', () => {
    expect(
      mergeRetentionHours({ enabled: false, value: 10, unit: 'hours' }, 100, 'hours'),
    ).toBeNull();
    expect(
      mergeRetentionHours({ enabled: true, value: 0, unit: 'hours' }, 100, 'hours'),
    ).toBeNull();
  });

  it('effective is min(env hours, admin hours)', () => {
    expect(mergeRetentionHours({ enabled: true, value: 24, unit: 'hours' }, 72, 'hours')).toBe(24);
    expect(mergeRetentionHours({ enabled: true, value: 10, unit: 'days' }, 5, 'days')).toBe(120); // min(120h, 240h)
  });
});

describe('parsePublicUploadsPathFromUrl', () => {
  it('extracts object path for uploads bucket', () => {
    const url = 'https://abc.supabase.co/storage/v1/object/public/uploads/1690000000-abc-photo.jpg';
    expect(parsePublicUploadsPathFromUrl(url)).toBe('1690000000-abc-photo.jpg');
  });

  it('returns null for other buckets or bad URLs', () => {
    expect(
      parsePublicUploadsPathFromUrl(
        'https://abc.supabase.co/storage/v1/object/public/other/foo.jpg',
      ),
    ).toBeNull();
    expect(parsePublicUploadsPathFromUrl('not-a-url')).toBeNull();
  });
});

describe('parseLocalUploadsBasenameFromUrl', () => {
  it('parses /uploads/{basename}', () => {
    expect(parseLocalUploadsBasenameFromUrl('http://localhost:4000/uploads/abc-123.png')).toBe(
      'abc-123.png',
    );
  });

  it('rejects traversal', () => {
    expect(
      parseLocalUploadsBasenameFromUrl('http://localhost:4000/uploads/../etc/passwd'),
    ).toBeNull();
  });
});

describe('parsePrivateUploadIdFromUrl', () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';

  it('parses relative and absolute private upload URLs', () => {
    expect(parsePrivateUploadIdFromUrl(`/api/upload/private/${id}`)).toBe(id);
    expect(parsePrivateUploadIdFromUrl(`https://api.example.com/api/upload/private/${id}`)).toBe(
      id,
    );
  });

  it('rejects non-private paths and invalid ids', () => {
    expect(parsePrivateUploadIdFromUrl(`/uploads/${id}`)).toBeNull();
    expect(parsePrivateUploadIdFromUrl('/api/upload/private/not-a-uuid')).toBeNull();
  });
});
