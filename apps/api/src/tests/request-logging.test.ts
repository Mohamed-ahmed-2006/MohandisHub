import { describe, expect, it } from 'vitest';

import { redactSensitiveRequestPath } from '../middleware/request-logging.js';

describe('request log path redaction', () => {
  it('removes private upload identifiers from logged paths', () => {
    expect(
      redactSensitiveRequestPath(
        '/api/upload/private/11111111-1111-4111-8111-111111111111/download',
      ),
    ).toBe('/api/upload/private/:id/download');
  });

  it('preserves non-sensitive route paths', () => {
    expect(redactSensitiveRequestPath('/api/services/featured')).toBe('/api/services/featured');
  });
});
