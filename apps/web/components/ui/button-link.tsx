import Link from 'next/link';

const variantClassMap = {
  primary: 'button-link-primary',
  secondary: 'button-link-secondary',
} as const;

type ButtonLinkProps = {
  href: string;
  label: string;
  variant?: keyof typeof variantClassMap;
  className?: string;
};

export const ButtonLink = ({ href, label, variant = 'primary', className }: ButtonLinkProps) => {
  const mergedClassName = ['button-link', variantClassMap[variant], className]
    .filter(Boolean)
    .join(' ');

  return (
    <Link href={href} className={mergedClassName}>
      {label}
    </Link>
  );
};
