'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';

import { resolvePublicAssetUrl } from '@/lib/asset-url';
import { getPrivateFileOpenableUrl } from '@/lib/upload/client';

type ImagePreviewModalProps = {
  imageUrl: string;
  title?: string;
  onClose: () => void;
  /** When set, private API URLs (/api/upload/private/...) are fetched with this token so the image loads. */
  accessToken?: string | null;
};

const isPrivateUploadUrl = (url: string): boolean => url.includes('/api/upload/private/');

export function ImagePreviewModal({
  imageUrl,
  title,
  onClose,
  accessToken,
}: ImagePreviewModalProps) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(() =>
    !isPrivateUploadUrl(imageUrl) ? (resolvePublicAssetUrl(imageUrl) ?? imageUrl) : null,
  );
  const [loading, setLoading] = useState(() => isPrivateUploadUrl(imageUrl) && !!accessToken);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  useEffect(() => {
    if (!isPrivateUploadUrl(imageUrl) || !accessToken) {
      setResolvedUrl(resolvePublicAssetUrl(imageUrl) ?? imageUrl);
      setLoading(false);
      setError(null);
      return () => {};
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setResolvedUrl(null);
    void getPrivateFileOpenableUrl(accessToken, resolvePublicAssetUrl(imageUrl) ?? imageUrl)
      .then((blobUrl) => {
        if (cancelled) return;
        setResolvedUrl(blobUrl);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load image');
        setLoading(false);
      });
    return () => {
      cancelled = true;
      setResolvedUrl(null);
    };
  }, [imageUrl, accessToken]);

  return (
    <div
      className="admin-modal-overlay image-preview-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={title ?? 'Image preview'}
    >
      <div className="image-preview-modal" onClick={(e) => e.stopPropagation()}>
        <div className="image-preview-header">
          {title && <span className="image-preview-title">{title}</span>}
          <button
            type="button"
            className="image-preview-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="image-preview-content">
          {loading && <p className="admin-empty">Loading…</p>}
          {error && <p className="admin-error-banner">{error}</p>}
          {resolvedUrl && !loading && (
            <Image
              src={resolvedUrl}
              alt={title ?? 'Preview'}
              className="image-preview-img"
              width={1200}
              height={800}
              unoptimized
            />
          )}
        </div>
      </div>
    </div>
  );
}
