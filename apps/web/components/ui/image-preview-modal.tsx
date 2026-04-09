'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';

import { DialogHeader } from '@/components/ui/dialog-header';
import { Modal } from '@/components/ui/modal';
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
  console.warn('[ImagePreviewModal] opened', {
    title,
    isPrivate: isPrivateUploadUrl(imageUrl),
    accessTokenPresent: !!accessToken,
    imageUrl,
  });
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
        console.warn('[ImagePreviewModal] resolve error', {
          errorMessage: err instanceof Error ? err.message : String(err),
          accessTokenPresent: !!accessToken,
          imageUrl,
        });
        setError(err instanceof Error ? err.message : 'Failed to load image');
        setLoading(false);
      });
    return () => {
      cancelled = true;
      setResolvedUrl(null);
    };
  }, [imageUrl, accessToken]);

  return (
    <Modal open onClose={onClose} size="lg" className="image-preview-modal" zIndex={1100}>
      <DialogHeader
        title={title ?? 'Image preview'}
        onClose={onClose}
        closeLabel="Close"
        className="image-preview-header"
      />
        <div className="image-preview-content">
          {loading && <p className="admin-empty">Loading…</p>}
          {error && <p className="admin-error-banner">{error}</p>}
          {resolvedUrl && !loading && (
            resolvedUrl.startsWith('blob:') || resolvedUrl.startsWith('data:') ? (
              // `next/image` does not reliably render `blob:` sources. Use a plain <img>.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={resolvedUrl}
                alt={title ?? 'Preview'}
                className="image-preview-img"
                onError={() => {
                  console.warn('[ImagePreviewModal] <img> failed to load', {
                    title,
                    imageUrl,
                    resolvedUrlPrefix: resolvedUrl.slice(0, 30),
                  });
                }}
              />
            ) : (
              <Image
                src={resolvedUrl}
                alt={title ?? 'Preview'}
                className="image-preview-img"
                width={1200}
                height={800}
                unoptimized
              />
            )
          )}
        </div>
    </Modal>
  );
}
