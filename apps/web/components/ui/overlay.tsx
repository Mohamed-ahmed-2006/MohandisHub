import type { PropsWithChildren } from 'react';

type OverlayProps = PropsWithChildren<{
  onClick?: (() => void) | undefined;
  className?: string | undefined;
  zIndex?: number | undefined;
}>;

export function Overlay({ onClick, className = '', zIndex, children }: OverlayProps) {
  return (
    <div
      className={`mh-overlay mh-animate-overlay-in ${className}`.trim()}
      style={zIndex != null ? { zIndex } : undefined}
      onClick={onClick}
      role="presentation"
    >
      {children}
    </div>
  );
}
