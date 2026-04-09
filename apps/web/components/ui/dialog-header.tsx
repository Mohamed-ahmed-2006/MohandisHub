import type { PropsWithChildren } from 'react';

type DialogHeaderProps = PropsWithChildren<{
  title: string;
  subtitle?: string;
  onClose: () => void;
  closeLabel: string;
  className?: string;
}>;

export function DialogHeader({
  title,
  subtitle,
  onClose,
  closeLabel,
  className = '',
  children,
}: DialogHeaderProps) {
  return (
    <header className={`mh-dialog-header ${className}`.trim()}>
      <div className="mh-dialog-header-main">
        <h2 className="mh-dialog-title">{title}</h2>
        {subtitle ? <p className="mh-dialog-subtitle">{subtitle}</p> : null}
      </div>
      {children}
      <button type="button" className="mh-dialog-close" onClick={onClose} aria-label={closeLabel}>
        ×
      </button>
    </header>
  );
}
