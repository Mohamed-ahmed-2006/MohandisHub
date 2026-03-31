'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';

import { resolvePublicAssetUrl } from '@/lib/asset-url';

type AvatarImageProps = {
  src: string | null | undefined;
  displayName: string;
  alt?: string;
  width: number;
  height: number;
  imageClassName: string;
  fallbackClassName: string;
};

export const AvatarImage = ({
  src,
  displayName,
  alt = '',
  width,
  height,
  imageClassName,
  fallbackClassName,
}: AvatarImageProps) => {
  const resolvedSrc = useMemo(() => resolvePublicAssetUrl(src) ?? null, [src]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [resolvedSrc]);

  if (resolvedSrc && !failed) {
    return (
      <Image
        unoptimized
        src={resolvedSrc}
        alt={alt}
        width={width}
        height={height}
        className={imageClassName}
        onError={() => setFailed(true)}
      />
    );
  }

  return <span className={fallbackClassName}>{displayName.charAt(0).toUpperCase()}</span>;
};
