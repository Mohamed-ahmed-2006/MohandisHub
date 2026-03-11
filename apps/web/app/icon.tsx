import fs from 'node:fs';
import path from 'node:path';

import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

/** Use Node so we can read logo from filesystem; favicon falls back to "M" if logo not found (e.g. Edge). */
export const runtime = 'nodejs';

function getLogoSrc(): string | null {
  try {
    const cwd = process.cwd();
    const candidates = [
      path.join(cwd, 'components', 'assets', 'mohandishub3 dark.png'),
      path.join(cwd, 'components', 'assets', 'mohandishub3 light.png'),
      path.join(cwd, 'apps', 'web', 'components', 'assets', 'mohandishub3 dark.png'),
      path.join(cwd, 'apps', 'web', 'components', 'assets', 'mohandishub3 light.png'),
      path.join(cwd, 'public', 'icon.png'),
      path.join(cwd, 'public', 'brand', 'mohandishub-email-logo.png'),
      path.join(cwd, 'apps', 'web', 'public', 'icon.png'),
      path.join(cwd, 'apps', 'web', 'public', 'brand', 'mohandishub-email-logo.png'),
    ];
    for (const file of candidates) {
      if (fs.existsSync(file)) {
        const buffer = fs.readFileSync(file);
        return `data:image/png;base64,${buffer.toString('base64')}`;
      }
    }
  } catch {
    // e.g. Edge runtime or missing file
  }
  return null;
}

export default function Icon() {
  const logoSrc = getLogoSrc();

  if (logoSrc) {
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoSrc}
            alt=""
            width={32}
            height={32}
            style={{ objectFit: 'contain' }}
          />
        </div>
      ),
      { ...size }
    );
  }

  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 20,
          fontWeight: 700,
          background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          borderRadius: 6,
        }}
      >
        M
      </div>
    ),
    { ...size }
  );
}
