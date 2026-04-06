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
    background_color: '#fff7ed',
    theme_color: '#ea580c',
    icons: [
      {
        src: `/icon?v=${iconVersion}`,
        sizes: '32x32',
        type: 'image/png',
      },
      {
        src: `/brand-icons/192?v=${iconVersion}`,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: `/brand-icons/512?v=${iconVersion}`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable',
      },
    ],
  });
}
