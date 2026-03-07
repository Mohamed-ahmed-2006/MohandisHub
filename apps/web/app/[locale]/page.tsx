import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ApiHealthBadge } from '@/components/api-health-badge';
import { LanguageToggle } from '@/components/language-toggle';
import { SiteLogo } from '@/components/site-logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { ButtonLink } from '@/components/ui/button-link';
import { Card } from '@/components/ui/card';
import { Container } from '@/components/ui/container';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Locale } from '@/lib/i18n/types';

type HomePageProps = {
  params: Promise<{
    locale: string;
  }>;
};

const HomePage = async ({ params }: HomePageProps) => {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const dictionary = getDictionary(locale);
  const typedLocale: Locale = locale;

  return (
    <main className="home-page-main">
      <div className="home-page-floating-controls">
        <LanguageToggle
          locale={typedLocale}
          targetLabel={dictionary.language.target}
          ariaLabel={dictionary.language.switchLabel}
        />
        <ThemeToggle
          switchToLightLabel={dictionary.theme.switchToLight}
          switchToDarkLabel={dictionary.theme.switchToDark}
          darkLabel={dictionary.theme.darkLabel}
          lightLabel={dictionary.theme.lightLabel}
        />
      </div>
      <Container className="home-page-container">
        <header className="home-page-navbar">
          <Link href={buildLocalePath(typedLocale, '/')} className="home-page-brand">
            <SiteLogo />
          </Link>
          <nav className="home-page-nav-actions">
            <ButtonLink
              href={`${buildLocalePath(typedLocale, '/auth')}?mode=login`}
              label={dictionary.common.login}
              variant="secondary"
            />
            <ButtonLink
              href={`${buildLocalePath(typedLocale, '/auth')}?mode=register`}
              label={dictionary.common.signUp}
            />
          </nav>
        </header>

        <section className="home-page-hero-section">
          <ApiHealthBadge />
          <h1 className="home-page-hero-title">{dictionary.home.headline}</h1>
          <p className="home-page-hero-description">{dictionary.home.description}</p>
          <div className="home-page-hero-actions">
            <ButtonLink
              href={`${buildLocalePath(typedLocale, '/auth')}?mode=register`}
              label={dictionary.common.getStarted}
              className="home-page-hero-cta-button"
            />
          </div>
        </section>

        <section className="home-page-section">
          <h2 className="home-page-section-title">{dictionary.home.whatYouCanDoTitle}</h2>
          <div className="home-page-feature-grid">
            {dictionary.home.features.map((feature) => (
              <Card key={feature.title}>
                <h3 className="home-page-feature-title">{feature.title}</h3>
                <p className="home-page-feature-description">{feature.description}</p>
              </Card>
            ))}
          </div>
        </section>

        <section className="home-page-section">
          <h2 className="home-page-section-title">{dictionary.home.howItWorksTitle}</h2>
          <div className="home-page-steps-grid">
            {dictionary.home.steps.map((step, index) => (
              <Card key={step}>
                <p className="home-page-step-label">
                  {dictionary.home.stepLabel} {index + 1}
                </p>
                <p className="home-page-step-text">{step}</p>
              </Card>
            ))}
          </div>
        </section>

        <footer className="home-page-footer">
          <p>{dictionary.home.footerText}</p>
        </footer>
      </Container>
    </main>
  );
};

export default HomePage;
