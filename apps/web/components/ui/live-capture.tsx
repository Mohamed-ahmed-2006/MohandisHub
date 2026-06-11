'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type LiveCaptureProps = {
  /** 'user' for selfie (front camera), 'environment' for document (back camera) */
  facingMode?: 'user' | 'environment';
  onCapture: (file: File) => void;
  onClear?: () => void;
  onError?: (message: string) => void;
  label: string;
  required?: boolean;
  disabled?: boolean;
};

const FlipCameraIcon = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M7 16V4m0 0L3 8m4-4l4 4" />
    <path d="M17 8v12m0 0l4-4m-4 4l-4-4" />
  </svg>
);

export function LiveCapture({
  facingMode: initialFacing = 'user',
  onCapture,
  onClear,
  onError,
  label,
  required = false,
  disabled = false,
}: LiveCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<'idle' | 'streaming' | 'captured' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentFacing, setCurrentFacing] = useState<'user' | 'environment'>(initialFacing);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const startCamera = useCallback(
    async (facing: 'user' | 'environment' = currentFacing) => {
      setErrorMessage(null);
      onClear?.();
      stopStream();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facing,
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        streamRef.current = stream;
        setCurrentFacing(facing);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setStatus('streaming');
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Could not access camera. Please allow camera access.';
        setErrorMessage(msg);
        setStatus('error');
        onError?.(msg);
      }
    },
    [onClear, onError, stopStream, currentFacing],
  );

  const closeModal = useCallback(() => {
    stopStream();
    setStatus('idle');
  }, [stopStream]);

  const flipCamera = useCallback(async () => {
    const next = currentFacing === 'user' ? 'environment' : 'user';
    stopStream();
    await startCamera(next);
  }, [currentFacing, startCamera, stopStream]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.srcObject || status !== 'streaming') return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
        stopStream();
        setStatus('captured');
        onCapture(file);
      },
      'image/jpeg',
      0.92,
    );
  }, [onCapture, status, stopStream]);

  useEffect(() => {
    return () => stopStream();
  }, [stopStream]);

  return (
    <div className="live-capture">
      <label className="live-capture-label">
        {label}
        {required && <span className="live-capture-required"> *</span>}
      </label>
      {status === 'idle' && (
        <button
          type="button"
          className="live-capture-start"
          onClick={() => void startCamera(initialFacing)}
          disabled={disabled}
        >
          Open camera & take live photo
        </button>
      )}
      {status === 'streaming' && (
        <div
          className="live-capture-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Camera preview"
          onClick={(e) => e.target === e.currentTarget && closeModal()}
        >
          <div className="live-capture-modal" onClick={(e) => e.stopPropagation()}>
            <div className="live-capture-modal-header">
              <span className="live-capture-modal-title">{label}</span>
              <button
                type="button"
                className="live-capture-modal-close"
                onClick={closeModal}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="live-capture-preview">
              <video ref={videoRef} autoPlay playsInline muted className="live-capture-video" />
            </div>
            <div className="live-capture-actions">
              <button
                type="button"
                className="live-capture-flip"
                onClick={() => void flipCamera()}
                title="Flip camera"
                aria-label="Flip camera"
              >
                <FlipCameraIcon />
                <span>Flip</span>
              </button>
              <button type="button" className="live-capture-capture" onClick={capture}>
                Capture now
              </button>
              <button
                type="button"
                className="live-capture-retry"
                onClick={() => void startCamera(currentFacing)}
              >
                Restart camera
              </button>
            </div>
          </div>
        </div>
      )}
      {status === 'captured' && (
        <div className="live-capture-done">
          <span className="live-capture-check">Photo captured</span>
          <button
            type="button"
            className="live-capture-retake"
            onClick={() => void startCamera(currentFacing)}
          >
            Retake
          </button>
        </div>
      )}
      {status === 'error' && (
        <div className="live-capture-error">
          <p>{errorMessage}</p>
          <button
            type="button"
            className="live-capture-retry"
            onClick={() => void startCamera(currentFacing)}
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
