import { ImageResponse } from 'next/og';

import { BRAND_ACCENT_HEX, getBrandLogoDataUrl } from '@/lib/brand-icon-source';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';
export const runtime = 'nodejs';

export default function AppleIcon() {
  const logoSrc = getBrandLogoDataUrl();
  const pad = 22;
  const inner = 180 - pad * 2;

  if (logoSrc) {
    return new ImageResponse(
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#ffffff',
          borderRadius: 36,
        }}
      >
        <img src={logoSrc} alt="" width={inner} height={inner} style={{ objectFit: 'contain' }} />
      </div>,
      { ...size },
    );
  }

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `linear-gradient(145deg, ${BRAND_ACCENT_HEX} 0%, #c2410c 100%)`,
        borderRadius: 36,
        color: 'white',
        fontSize: 72,
        fontWeight: 700,
      }}
    >
      M
    </div>,
    { ...size },
  );
}
