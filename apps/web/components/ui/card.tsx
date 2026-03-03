import type { ReactNode } from 'react';

type CardProps = {
  children: ReactNode;
  className?: string;
};

export const Card = ({ children, className }: CardProps) => {
  const mergedClassName = ['card-root', className].filter(Boolean).join(' ');

  return <article className={mergedClassName}>{children}</article>;
};
