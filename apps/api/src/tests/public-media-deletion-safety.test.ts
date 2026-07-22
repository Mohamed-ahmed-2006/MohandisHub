import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const readSource = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

describe('public media reference cleanup safety', () => {
  it('never turns user-controlled public URLs into service-role storage deletions', () => {
    const moderation = readSource('../modules/moderation/moderation.service.ts');
    const retention = readSource('../modules/retention/retention.service.ts');

    expect(moderation).not.toContain('resolvePublicUploadRef');
    expect(moderation).not.toContain('deleteObjectsFromBucket');
    expect(retention).not.toContain('deletePublicMediaUrls');
    expect(retention).not.toContain('resolvePublicUploadRef');
    expect(retention).toContain('deletedFiles: 0');
  });
});
