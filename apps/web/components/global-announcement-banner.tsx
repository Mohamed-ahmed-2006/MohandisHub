'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';

import { useAppStatus } from '@/components/app-status-provider';
import { getApiBaseUrl } from '@/lib/env';

type ActiveMediaAsset = {
  id: string;
  title: string;
  alt_text: string | null;
  image_url: string;
};

export const GlobalAnnouncementBanner = () => {
  const { status } = useAppStatus();
  const message = status?.globalAnnouncement?.trim();
  const [asset, setAsset] = useState<ActiveMediaAsset | null>(null);
  const mediaLibraryEnabled = process.env.NEXT_PUBLIC_ENABLE_MEDIA_LIBRARY === 'true';

  useEffect(() => {
    if (!mediaLibraryEnabled) return;
    let active = true;
    void fetch(`${getApiBaseUrl()}/api/media/active?usageType=announcement`)
      .then(async (response) => {
        if (!response.ok) return null;
        const json = (await response.json()) as { data?: ActiveMediaAsset[] };
        return json.data?.[0] ?? null;
      })
      .then((item) => {
        if (active) setAsset(item);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [mediaLibraryEnabled]);

  if (!message && !asset) return null;

  return (
    <div
      role="status"
      style={{
        width: '100%',
        padding: '0.625rem 1rem',
        textAlign: 'center',
        background: 'hsl(var(--primary) / 0.16)',
        borderBottom: '1px solid hsl(var(--primary) / 0.28)',
        color: 'hsl(var(--foreground))',
        fontSize: '0.9rem',
        fontWeight: 600,
      }}
    >
      {asset ? (
        <div
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.7rem', flexWrap: 'wrap' }}
        >
          <Image
            src={asset.image_url}
            alt={asset.alt_text ?? asset.title}
            width={48}
            height={30}
            unoptimized
            style={{ objectFit: 'cover', borderRadius: 8 }}
          />
          <span>{message || asset.title}</span>
        </div>
      ) : (
        message
      )}
    </div>
  );
};
