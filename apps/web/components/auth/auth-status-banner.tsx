type AuthStatusBannerProps = {
  variant: 'error' | 'success' | 'info';
  message: string;
};

export const AuthStatusBanner = ({ variant, message }: AuthStatusBannerProps) => {
  const className = ['auth-status-banner', `auth-status-banner-${variant}`].join(' ');

  return <div className={className}>{message}</div>;
};
