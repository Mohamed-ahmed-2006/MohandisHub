import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ApiHealthBadge } from '@/components/api-health-badge';
import { HomePageFloatingControls } from '@/components/home-page-floating-controls';
import { SiteLogo } from '@/components/site-logo';
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

  const dictionary = await getDictionary(locale);
  const typedLocale: Locale = locale;

  return (
    <main className="home-page-main">
      <HomePageFloatingControls locale={typedLocale} dictionary={dictionary} />
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

        {dictionary.home.joinAsTitle && (
          <section className="home-page-section home-page-join-section">
            <h2 className="home-page-section-title">{dictionary.home.joinAsTitle}</h2>
            <div className="home-page-role-grid">
              <Link
                href={`${buildLocalePath(typedLocale, '/auth')}?mode=register&role=customer`}
                className="home-page-role-card"
              >
                <span className="home-page-role-label">
                  {dictionary.home.joinAsCustomer ?? 'I need help'}
                </span>
              </Link>
              <Link
                href={`${buildLocalePath(typedLocale, '/auth')}?mode=register&role=expert`}
                className="home-page-role-card"
              >
                <span className="home-page-role-label">
                  {dictionary.home.joinAsExpert ?? "I'm an expert"}
                </span>
              </Link>
              <Link
                href={`${buildLocalePath(typedLocale, '/auth')}?mode=register&role=craftsman`}
                className="home-page-role-card"
              >
                <span className="home-page-role-label">
                  {dictionary.home.joinAsCraftsman ?? "I'm a craftsman"}
                </span>
              </Link>
              <Link
                href={`${buildLocalePath(typedLocale, '/auth')}?mode=register&role=business`}
                className="home-page-role-card"
              >
                <span className="home-page-role-label">
                  {dictionary.home.joinAsBusiness ?? "I'm a business"}
                </span>
              </Link>
            </div>
          </section>
        )}

        {dictionary.home.trustTitle && (
          <section className="home-page-section home-page-trust-section">
            <h2 className="home-page-section-title">{dictionary.home.trustTitle}</h2>
            <ul className="home-page-trust-list">
              {dictionary.home.trustVerified && (
                <li className="home-page-trust-item">{dictionary.home.trustVerified}</li>
              )}
              {dictionary.home.trustPayments && (
                <li className="home-page-trust-item">{dictionary.home.trustPayments}</li>
              )}
              {dictionary.home.trustCancellation && (
                <li className="home-page-trust-item">{dictionary.home.trustCancellation}</li>
              )}
            </ul>
          </section>
        )}

        {/* Testimonials section removed for now until we have real opinions */}

        {dictionary.home.metricsTitle && (
          <section className="home-page-section home-page-metrics-section">
            <h2 className="home-page-section-title">{dictionary.home.metricsTitle}</h2>
            <div className="home-page-metrics-grid">
              <div className="home-page-metric">
                <span className="home-page-metric-value">50+</span>
                <span className="home-page-metric-label">{dictionary.home.metricsExperts ?? 'Verified experts'}</span>
              </div>
              <div className="home-page-metric">
                <span className="home-page-metric-value">200+</span>
                <span className="home-page-metric-label">{dictionary.home.metricsProjects ?? 'Projects completed'}</span>
              </div>
              <div className="home-page-metric">
                <span className="home-page-metric-value">500+</span>
                <span className="home-page-metric-label">{dictionary.home.metricsCustomers ?? 'Customers served'}</span>
              </div>
            </div>
          </section>
        )}

        {dictionary.home.faqTitle && dictionary.home.faqItems && dictionary.home.faqItems.length > 0 && (
          <section className="home-page-section home-page-faq-section">
            <h2 className="home-page-section-title">{dictionary.home.faqTitle}</h2>
            <ul className="home-page-faq-list">
              {dictionary.home.faqItems.map((item, i) => (
                <li key={i} className="home-page-faq-item">
                  <strong className="home-page-faq-question">{item.question}</strong>
                  <p className="home-page-faq-answer">{item.answer}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="home-page-footer">
          <p>{dictionary.home.footerText}</p>
        </footer>
      </Container>
    </main>
  );
};

export default HomePage;
