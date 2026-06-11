'use client';

import type { PropsWithChildren } from 'react';
import { createPortal } from 'react-dom';

import { Overlay } from './overlay';

type DrawerProps = PropsWithChildren<{
  open: boolean;
  onClose: () => void;
  className?: string;
  overlayClassName?: string;
  zIndex?: number;
  usePortal?: boolean;
}>;

export function Drawer({
  open,
  onClose,
  className = '',
  overlayClassName = '',
  zIndex,
  usePortal = true,
  children,
}: DrawerProps) {
  if (!open) return null;

  const content = (
    <Overlay
      onClick={onClose}
      className={`mh-drawer-overlay ${overlayClassName}`.trim()}
      zIndex={zIndex}
    >
      <section
        className={`mh-drawer mh-animate-slide-side ${className}`.trim()}
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
