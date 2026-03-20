import type { NextRequest } from 'next/server';

import { getIconVersion } from '@/lib/icon-version';

export function GET(_req: NextRequest) {
  const iconVersion = getIconVersion();

  return Response.json({
    name: 'MohandisHub',
    short_name: 'MohandisHub',
    description: 'Engineering services marketplace connecting customers, experts, and businesses.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0f766e',
    icons: [
      {
        src: `/icon?v=${iconVersion}`,
        sizes: '32x32',
        type: 'image/png',
      },
    ],
  });
}
