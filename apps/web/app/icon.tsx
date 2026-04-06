import { ImageResponse } from 'next/og';

import { BRAND_ACCENT_HEX, getBrandLogoDataUrl } from '@/lib/brand-icon-source';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

/** Use Node so we can read logo from filesystem; favicon falls back to "M" if logo not found (e.g. Edge). */
export const runtime = 'nodejs';

export default function Icon() {
  const logoSrc = getBrandLogoDataUrl();

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
          background: `linear-gradient(135deg, ${BRAND_ACCENT_HEX} 0%, #c2410c 100%)`,
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
