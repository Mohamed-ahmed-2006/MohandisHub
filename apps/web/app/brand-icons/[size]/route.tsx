import { ImageResponse } from 'next/og';
import type { NextRequest } from 'next/server';

import { BRAND_ACCENT_HEX, getBrandLogoDataUrl } from '@/lib/brand-icon-source';

export const runtime = 'nodejs';

const ALLOWED = new Set(['192', '512']);

export async function GET(_req: NextRequest, context: { params: Promise<{ size: string }> }) {
  const { size: sizeStr } = await context.params;
  if (!ALLOWED.has(sizeStr)) {
    return new Response('Not found', { status: 404 });
  }

  const px = Number(sizeStr);
  const logoSrc = getBrandLogoDataUrl();
  const pad = Math.round(px * 0.12);
  const inner = px - pad * 2;

  if (logoSrc) {
    return new ImageResponse(
      <div
        style={{
          width: px,
          height: px,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#ffffff',
          borderRadius: sizeStr === '512' ? px * 0.2 : px * 0.18,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoSrc} alt="" width={inner} height={inner} style={{ objectFit: 'contain' }} />
      </div>,
      { width: px, height: px },
    );
  }

  return new ImageResponse(
    <div
      style={{
        width: px,
        height: px,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `linear-gradient(145deg, ${BRAND_ACCENT_HEX} 0%, #c2410c 100%)`,
        borderRadius: sizeStr === '512' ? px * 0.2 : px * 0.18,
        color: 'white',
        fontSize: Math.round(px * 0.38),
        fontWeight: 700,
      }}
    >
      M
    </div>,
    { width: px, height: px },
  );
}
