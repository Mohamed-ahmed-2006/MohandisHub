import { describe, expect, it } from 'vitest';

import { toPrivateUploadUpstreamUrl } from '../lib/upload/private-upload-proxy';

const API_BASE = 'https://api.mohandishub.app';

describe('toPrivateUploadUpstreamUrl (SSRF hardening)', () => {
  it('builds a URL against the configured API base from a bare upload id', () => {
    expect(toPrivateUploadUpstreamUrl('abc-123', API_BASE)).toBe(
      `${API_BASE}/api/upload/private/abc-123`,
    );
  });

  it('accepts a relative private path', () => {
    expect(toPrivateUploadUpstreamUrl('/api/upload/private/abc-123', API_BASE)).toBe(
      `${API_BASE}/api/upload/private/abc-123`,
    );
  });

  it('discards the origin of an absolute URL and only keeps the pathname', () => {
    expect(
      toPrivateUploadUpstreamUrl('https://evil.com/api/upload/private/abc-123', API_BASE),
    ).toBe(`${API_BASE}/api/upload/private/abc-123`);
  });

  it('rejects absolute URLs that do not contain the private-upload prefix', () => {
    expect(toPrivateUploadUpstreamUrl('https://evil.com/internal/metadata', API_BASE)).toBeNull();
  });

  it('rejects relative paths without the private-upload prefix', () => {
    expect(toPrivateUploadUpstreamUrl('/etc/passwd', API_BASE)).toBeNull();
  });

  it('never targets a host other than the configured API base', () => {
    const inputs = [
      'https://evil.com/api/upload/private/x',
      'http://169.254.169.254/api/upload/private/x',
      'evil.com/api/upload/private/x',
      '//evil.com/api/upload/private/x',
    ];
    for (const input of inputs) {
      const result = toPrivateUploadUpstreamUrl(input, API_BASE);
      if (result !== null) {
        expect(result.startsWith(API_BASE)).toBe(true);
      }
    }
  });

  it('returns null when no API base is configured', () => {
    expect(toPrivateUploadUpstreamUrl('abc-123', '')).toBeNull();
  });
});
