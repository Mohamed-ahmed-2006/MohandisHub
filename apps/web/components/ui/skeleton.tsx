'use client';

import './skeleton.css';

type SkeletonProps = {
  className?: string;
  style?: React.CSSProperties;
};

export const Skeleton = ({ className = '', style }: SkeletonProps) => (
  <div className={`skeleton ${className}`.trim()} style={style} aria-hidden />
);

export const SkeletonText = ({ lines = 1, className = '' }: SkeletonProps & { lines?: number }) => (
  <div className={`skeleton-text-group ${className}`.trim()}>
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton
        key={i}
        className="skeleton-line"
        style={{ width: i === lines - 1 && lines > 1 ? '70%' : undefined }}
      />
    ))}
  </div>
);

export const SkeletonAvatar = ({
  size = 40,
  className = '',
}: SkeletonProps & { size?: number }) => (
  <Skeleton
    className={`skeleton-avatar ${className}`.trim()}
    style={{ width: size, height: size, borderRadius: '50%' }}
  />
);

export const SkeletonCard = ({ className = '' }: SkeletonProps) => (
  <div className={`skeleton-card ${className}`.trim()}>
    <Skeleton className="skeleton-card-title" />
    <SkeletonText lines={3} />
  </div>
);

export const SkeletonForm = ({
  fields = 5,
  className = '',
}: SkeletonProps & { fields?: number }) => (
  <div className={`skeleton-form ${className}`.trim()}>
    {Array.from({ length: fields }).map((_, i) => (
      <div key={i} className="skeleton-form-field">
        <Skeleton className="skeleton-label" />
        <Skeleton className="skeleton-input" />
      </div>
    ))}
  </div>
);
