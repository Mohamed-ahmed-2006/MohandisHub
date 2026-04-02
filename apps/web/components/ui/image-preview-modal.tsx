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
  // eslint-disable-next-line no-console
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
      // #region agent log
      fetch('http://127.0.0.1:7325/ingest/ebd08bf8-7d73-450c-ad4d-4436a6c2225b', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Debug-Session-Id': 'b33485',
        },
        body: JSON.stringify({
          sessionId: 'b33485',
          runId: 'pre-debug',
          hypothesisId: 'H4_modal_missing_accessToken_or_public_path',
          location: 'image-preview-modal.tsx:ImagePreviewModal-useEffect-branch',
          message: 'Modal entering non-private/no-accessToken branch',
          data: {
            imageUrlStartsWithHttp: imageUrl.startsWith('http'),
            isPrivateUploadUrl: isPrivateUploadUrl(imageUrl),
            accessTokenPresent: !!accessToken,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      setResolvedUrl(resolvePublicAssetUrl(imageUrl) ?? imageUrl);
      setLoading(false);
      setError(null);
      return () => {};
    }

    let cancelled = false;
    // #region agent log
    fetch('http://127.0.0.1:7325/ingest/ebd08bf8-7d73-450c-ad4d-4436a6c2225b', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': 'b33485',
      },
      body: JSON.stringify({
        sessionId: 'b33485',
        runId: 'pre-debug',
        hypothesisId: 'H3_modal_private_url_resolution_inputs',
        location: 'image-preview-modal.tsx:ImagePreviewModal-useEffect-start',
        message: 'Modal starting private URL resolution',
        data: {
          imageUrlStartsWithHttp: imageUrl.startsWith('http'),
          isPrivateUploadUrl: isPrivateUploadUrl(imageUrl),
          accessTokenPresent: !!accessToken,
          resolvedCandidateIncludesPrivatePrefix:
            (resolvePublicAssetUrl(imageUrl) ?? imageUrl).includes('/api/upload/private/'),
          resolvedCandidateStartsWithHttp: (resolvePublicAssetUrl(imageUrl) ?? imageUrl).startsWith('http'),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
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
        // eslint-disable-next-line no-console
        console.warn('[ImagePreviewModal] resolve error', {
          errorMessage: err instanceof Error ? err.message : String(err),
          accessTokenPresent: !!accessToken,
          imageUrl,
        });
        // #region agent log
        fetch('http://127.0.0.1:7325/ingest/ebd08bf8-7d73-450c-ad4d-4436a6c2225b', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Debug-Session-Id': 'b33485',
          },
          body: JSON.stringify({
            sessionId: 'b33485',
            runId: 'pre-debug',
            hypothesisId: 'H5_modal_private_fetch_error',
            location: 'image-preview-modal.tsx:ImagePreviewModal-privateFetch-catch',
            message: 'Modal failed resolving private image',
            data: {
              errorMessage: err instanceof Error ? err.message : 'unknown',
              accessTokenPresent: !!accessToken,
              isPrivateUploadUrl: isPrivateUploadUrl(imageUrl),
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
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
            resolvedUrl.startsWith('blob:') || resolvedUrl.startsWith('data:') ? (
              // `next/image` does not reliably render `blob:` sources. Use a plain <img>.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={resolvedUrl}
                alt={title ?? 'Preview'}
                className="image-preview-img"
                onError={() => {
                  // eslint-disable-next-line no-console
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
      </div>
    </div>
  );
}
