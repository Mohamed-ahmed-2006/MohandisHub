import { describe, expect, it } from 'vitest';

import { detectAndValidateUpload } from '../modules/upload/upload-file.js';

function memoryFile(buffer: Buffer, mimetype: string): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'untrusted-name.bin',
    encoding: '7bit',
    mimetype,
    size: buffer.length,
    buffer,
    destination: '',
    filename: '',
    path: '',
    stream: null as never,
  };
}

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('content-derived upload validation', () => {
  it('accepts a real allowed image and derives trusted metadata', async () => {
    const detected = await detectAndValidateUpload(memoryFile(ONE_PIXEL_PNG, 'image/png'));

    expect(detected.mime).toBe('image/png');
    expect(detected.extension).toBe('png');
    expect(detected.size).toBe(ONE_PIXEL_PNG.length);
    expect(detected.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a spoofed MIME declaration', async () => {
    await expect(
      detectAndValidateUpload(memoryFile(Buffer.from('not an image'), 'image/png')),
    ).rejects.toMatchObject({ code: 'INVALID_FILE_TYPE' });
  });

  it('rejects a declared MIME that differs from the detected signature', async () => {
    await expect(
      detectAndValidateUpload(memoryFile(ONE_PIXEL_PNG, 'image/jpeg')),
    ).rejects.toMatchObject({ code: 'INVALID_FILE_TYPE' });
  });

  it('enforces a narrower use-case allowlist', async () => {
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
    await expect(
      detectAndValidateUpload(memoryFile(pdf, 'application/pdf'), ['image/png']),
    ).rejects.toMatchObject({ code: 'INVALID_FILE_TYPE' });
  });
});
