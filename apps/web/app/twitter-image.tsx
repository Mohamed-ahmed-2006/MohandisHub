import { ImageResponse } from 'next/og';

import { BRAND_ACCENT_HEX, getBrandLogoDataUrl } from '@/lib/brand-icon-source';

export const runtime = 'nodejs';
export const alt = 'MohandisHub';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function TwitterImage() {
  const logoSrc = getBrandLogoDataUrl();

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: 72,
        background: 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 40%, #fed7aa 100%)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 28, marginBottom: 36 }}>
        {logoSrc ? (
          <img src={logoSrc} alt="" width={88} height={88} style={{ objectFit: 'contain' }} />
        ) : (
          <div
            style={{
              width: 88,
              height: 88,
              borderRadius: 20,
              background: BRAND_ACCENT_HEX,
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 44,
              fontWeight: 700,
            }}
          >
            M
          </div>
        )}
        <span
          style={{
            fontSize: 56,
            fontWeight: 800,
            letterSpacing: '-0.04em',
            color: '#1c1917',
          }}
        >
          MohandisHub
        </span>
      </div>
      <p
        style={{
          margin: 0,
          maxWidth: 900,
          fontSize: 32,
          lineHeight: 1.35,
          color: '#44403c',
          fontWeight: 500,
        }}
      >
        Engineering services marketplace connecting customers, experts, and businesses.
      </p>
    </div>,
    { ...size },
  );
}
