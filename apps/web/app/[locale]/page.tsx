import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  HomePageHeroCta,
  HomePageJoinSectionGate,
  HomePageNavAuth,
} from '@/components/home-page-auth-aware';
import { LanguageToggle } from '@/components/language-toggle';
import { SiteLogo } from '@/components/site-logo';
import { ThemeToggle } from '@/components/theme-toggle';
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
    <main className="home-page-main mh-animate-fade-in">
      <Container className="home-page-container">
        <header className="home-page-navbar">
          <Link href={buildLocalePath(typedLocale, '/')} className="home-page-brand">
            <SiteLogo />
          </Link>
          <div className="home-page-navbar-right">
            <div className="home-page-header-controls">
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
            <HomePageNavAuth locale={typedLocale} dictionary={dictionary} />
          </div>
        </header>

        <section className="home-page-hero-section">
          <div className="home-page-hero-layout">
            <div className="home-page-hero-copy mh-animate-fade-up">
              <h1 className="home-page-hero-title">{dictionary.home.headline}</h1>
              <p className="home-page-hero-description">{dictionary.home.description}</p>
              <HomePageHeroCta locale={typedLocale} dictionary={dictionary} />
            </div>
            <aside
              className="home-page-hero-banner mh-animate-fade-up mh-stagger-2"
              aria-hidden="true"
            >
              <Image
                src="/assets/herosection.png"
                alt=""
                width={900}
                height={700}
                className="home-page-hero-banner-image"
                priority
              />
            </aside>
          </div>
        </section>

        <section className="home-page-section">
          <h2 className="home-page-section-title">{dictionary.home.whatYouCanDoTitle}</h2>
          <div className="home-page-feature-grid">
            {dictionary.home.features.map((feature: { title: string; description: string }) => (
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
            {dictionary.home.steps.map((step: string, index: number) => (
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
          <HomePageJoinSectionGate>
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
          </HomePageJoinSectionGate>
        )}

        {(dictionary.home.trustTitle ||
          dictionary.home.metricsTitle ||
          dictionary.home.faqTitle) && (
          <section className="home-page-section home-page-trust-faq-section">
            <div className="home-page-trust-faq-layout">
              <aside className="home-page-trust-visual">
                <Image
                  src="/assets/trustus.png"
                  alt=""
                  width={900}
                  height={700}
                  className="home-page-trust-illustration-image"
                />
                {dictionary.home.metricsTitle && (
                  <>
                    <h3 className="home-page-trust-visual-title">{dictionary.home.metricsTitle}</h3>
                    <div className="home-page-metrics-cards">
                      <Card className="home-page-metric-card">
                        <span className="home-page-metric-value">50+</span>
                        <span className="home-page-metric-label">
                          {dictionary.home.metricsExperts ?? 'Verified experts'}
                        </span>
                      </Card>
                      <Card className="home-page-metric-card">
                        <span className="home-page-metric-value">200+</span>
                        <span className="home-page-metric-label">
                          {dictionary.home.metricsProjects ?? 'Projects completed'}
                        </span>
                      </Card>
                      <Card className="home-page-metric-card">
                        <span className="home-page-metric-value">500+</span>
                        <span className="home-page-metric-label">
                          {dictionary.home.metricsCustomers ?? 'Customers served'}
                        </span>
                      </Card>
                    </div>
                  </>
                )}
                <div className="home-page-trust-cta-wrap">
                  <Link
                    href={`${buildLocalePath(typedLocale, '/auth')}?mode=register`}
                    className="home-page-role-card home-page-trust-cta"
                  >
                    {dictionary.common.getStarted}
                  </Link>
                </div>
              </aside>

              <div className="home-page-trust-content">
                {dictionary.home.trustTitle && (
                  <>
                    <h2 className="home-page-section-title">{dictionary.home.trustTitle}</h2>
                    <ul className="home-page-trust-list">
                      {dictionary.home.trustVerified && (
                        <li className="home-page-trust-item">{dictionary.home.trustVerified}</li>
                      )}
                      {dictionary.home.trustPayments && (
                        <li className="home-page-trust-item">{dictionary.home.trustPayments}</li>
                      )}
                      {dictionary.home.trustCancellation && (
                        <li className="home-page-trust-item">
                          {dictionary.home.trustCancellation}
                        </li>
                      )}
                    </ul>
                  </>
                )}

                {dictionary.home.faqTitle &&
                  dictionary.home.faqItems &&
                  dictionary.home.faqItems.length > 0 && (
                    <div className="home-page-faq-block">
                      <h2 className="home-page-section-title">{dictionary.home.faqTitle}</h2>
                      <ul className="home-page-faq-list">
                        {dictionary.home.faqItems.map(
                          (item: { question: string; answer: string }, i: number) => (
                            <li key={i} className="home-page-faq-item">
                              <strong className="home-page-faq-question">{item.question}</strong>
                              <p className="home-page-faq-answer">{item.answer}</p>
                            </li>
                          ),
                        )}
                      </ul>
                    </div>
                  )}
              </div>
            </div>
          </section>
        )}

        <footer className="home-page-footer">
          <p className="home-page-footer-copy">{dictionary.home.footerText}</p>
          <nav className="home-page-footer-nav" aria-label={dictionary.home.footerLegalNavAria}>
            <Link className="home-page-footer-link" href={buildLocalePath(typedLocale, '/privacy')}>
              {dictionary.home.footerPrivacy}
            </Link>
            <span className="home-page-footer-sep" aria-hidden>
              ·
            </span>
            <Link className="home-page-footer-link" href={buildLocalePath(typedLocale, '/terms')}>
              {dictionary.home.footerTerms}
            </Link>
          </nav>
        </footer>
      </Container>
    </main>
  );
};

export default HomePage;
