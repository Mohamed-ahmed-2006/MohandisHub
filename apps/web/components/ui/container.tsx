import type { ReactNode } from 'react';

type ContainerProps = {
  children: ReactNode;
  className?: string;
};

export const Container = ({ children, className }: ContainerProps) => {
  const mergedClassName = ['container-root', className].filter(Boolean).join(' ');

  return <div className={mergedClassName}>{children}</div>;
};
