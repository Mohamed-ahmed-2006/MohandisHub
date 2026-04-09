'use client';

import { useCallback, useState } from 'react';

import { LiveCapture } from './live-capture';

type ImageUploadOrCaptureProps = {
  label: string;
  onImage: (file: File) => void;
  onClear?: () => void;
  onError?: (message: string) => void;
  required?: boolean;
  disabled?: boolean;
};

export function ImageUploadOrCapture({
  label,
  onImage,
  onClear,
  onError,
  required = false,
  disabled = false,
}: ImageUploadOrCaptureProps) {
  const [mode, setMode] = useState<'choose' | 'upload' | 'capture'>('choose');
  const [captured, setCaptured] = useState(false);

  const handleFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        onError?.('Please select an image file (JPEG, PNG, or WebP).');
        return;
      }
      onImage(file);
      setCaptured(true);
      e.target.value = '';
    },
    [onError, onImage],
  );

  const handleCapture = useCallback(
    (file: File) => {
      onImage(file);
      setCaptured(true);
    },
    [onImage],
  );

  const reset = useCallback(() => {
    setMode('choose');
    setCaptured(false);
    onClear?.();
  }, [onClear]);

  if (captured) {
    return (
      <div className="image-upload-or-capture">
        <label className="live-capture-label">
          {label}
          {required && <span className="live-capture-required"> *</span>}
        </label>
        <div className="live-capture-done">
          <span className="live-capture-check">Image added</span>
          <button type="button" className="live-capture-retake" onClick={reset}>
            Change
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'choose') {
    return (
      <div className="image-upload-or-capture">
        <label className="live-capture-label">
          {label}
          {required && <span className="live-capture-required"> *</span>}
        </label>
        <p className="onboarding-description" style={{ marginBottom: '0.5rem' }}>
          Upload a photo or take a live picture of your document.
        </p>
        <div className="image-upload-or-capture-buttons">
          <label className="live-capture-start" style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFile}
              disabled={disabled}
              style={{ display: 'none' }}
            />
            Upload image
          </label>
          <button
            type="button"
            className="live-capture-start"
            onClick={() => setMode('capture')}
            disabled={disabled}
          >
            Take live photo
          </button>
        </div>
        <p className="mh-upload-hint">Accepted: JPG, PNG, WebP. Use clear high-resolution images.</p>
      </div>
    );
  }

  if (mode === 'capture') {
    return (
      <div className="image-upload-or-capture">
        <LiveCapture
          facingMode="environment"
          label={label}
          onCapture={handleCapture}
          {...(onError && { onError })}
          required={required}
          disabled={disabled}
        />
        <button
          type="button"
          className="live-capture-retake"
          onClick={() => setMode('choose')}
          style={{ marginTop: '0.5rem' }}
        >
          Back
        </button>
      </div>
    );
  }

  return null;
}

