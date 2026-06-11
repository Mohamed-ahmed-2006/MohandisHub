'use client';

import type { PropsWithChildren } from 'react';
import { createPortal } from 'react-dom';

import { Overlay } from './overlay';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

type ModalProps = PropsWithChildren<{
  open: boolean;
  onClose: () => void;
  size?: ModalSize;
  className?: string;
  overlayClassName?: string;
  closeOnOverlay?: boolean;
  usePortal?: boolean;
  zIndex?: number;
}>;

export function Modal({
  open,
  onClose,
  size = 'md',
  className = '',
  overlayClassName = '',
  closeOnOverlay = true,
  usePortal = true,
  zIndex,
  children,
}: ModalProps) {
  if (!open) return null;

  const content = (
    <Overlay
      onClick={closeOnOverlay ? onClose : undefined}
      className={overlayClassName}
      zIndex={zIndex}
    >
      <section
        className={`mh-modal mh-modal--${size} mh-animate-scale-in ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </section>
    </Overlay>
  );

  if (!usePortal || typeof document === 'undefined') return content;
  return createPortal(content, document.body);
}
