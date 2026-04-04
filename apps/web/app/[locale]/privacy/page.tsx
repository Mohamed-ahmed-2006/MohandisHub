import Link from 'next/link';
import { notFound } from 'next/navigation';

import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { buildLocalePath } from '@/lib/i18n/path';
import { getPrivacyContent } from '@/lib/legal/legal-content';

type PrivacyPageProps = {
  params: Promise<{ locale: string }>;
};

const PrivacyPage = async ({ params }: PrivacyPageProps) => {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const dictionary = await getDictionary(locale);
  const title = dictionary.auth.register.privacyPolicy;
  const content = getPrivacyContent(locale);
  const email = content.contactEmail;

  return (
    <main className="legal-page-main">
      <div className="legal-page-container">
        <Link href={buildLocalePath(locale, '/auth')} className="legal-page-back">
          &larr; {dictionary.common.backToHome}
        </Link>
        <h1 className="legal-page-title">{title}</h1>
        <div className="legal-page-content">
          <div className="legal-page-meta">
            <p>
              <strong>{content.updatedLabel}:</strong> {content.updatedAt}
            </p>
            <p>
              <strong>{content.versionLabel}:</strong> {content.version}
            </p>
          </div>

          {content.intro.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}

          {content.sections.map((section) => (
            <section key={section.title} className="legal-page-section">
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.bullets && (
                <ul>
                  {section.bullets.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}

          <section className="legal-page-section">
            <h2>{content.contactTitle}</h2>
            <p>{content.contactLines[0]}</p>
            <p>
              <a href={`mailto:${email}`}>{email}</a>
            </p>
          </section>
        </div>
      </div>
    </main>
  );
};

export default PrivacyPage;
