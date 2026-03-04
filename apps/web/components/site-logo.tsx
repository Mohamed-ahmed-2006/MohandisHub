import Image from 'next/image';

import logoForLightTheme from '@/components/assets/mohandishub3 dark.png';
import logoForDarkTheme from '@/components/assets/mohandishub3 light.png';

type SiteLogoProps = {
  className?: string;
};

export const SiteLogo = ({ className }: SiteLogoProps) => {
  const rootClassName = ['site-logo-root', className].filter(Boolean).join(' ');

  return (
    <span className={rootClassName} aria-label="MohandisHub">
      <Image
        src={logoForLightTheme}
        alt="MohandisHub"
        className="site-logo-image site-logo-image-for-light-theme"
        priority
      />
      <Image
        src={logoForDarkTheme}
        alt="MohandisHub"
        className="site-logo-image site-logo-image-for-dark-theme"
        priority
      />
    </span>
  );
};
