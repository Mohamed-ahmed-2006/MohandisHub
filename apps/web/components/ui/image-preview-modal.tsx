'use client';

import Image from 'next/image';
import { useEffect } from 'react';

type ImagePreviewModalProps = {
  imageUrl: string;
  title?: string;
  onClose: () => void;
};

export function ImagePreviewModal({ imageUrl, title, onClose }: ImagePreviewModalProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

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
          <Image
            src={imageUrl}
            alt={title ?? 'Preview'}
            className="image-preview-img"
            width={1200}
            height={800}
            unoptimized
          />
        </div>
      </div>
    </div>
  );
}
