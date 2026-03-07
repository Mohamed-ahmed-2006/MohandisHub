import Link from 'next/link';
import { notFound } from 'next/navigation';

import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { buildLocalePath } from '@/lib/i18n/path';

type TermsPageProps = {
  params: Promise<{ locale: string }>;
};

const TermsPage = async ({ params }: TermsPageProps) => {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const dictionary = getDictionary(locale);
  const title = dictionary.auth.register.termsAndConditions;

  return (
    <main className="legal-page-main">
      <div className="legal-page-container">
        <Link href={buildLocalePath(locale, '/auth')} className="legal-page-back">
          ← {dictionary.common.backToHome}
        </Link>
        <h1 className="legal-page-title">{title}</h1>
        <div className="legal-page-content">
          <p>
            <strong>Last updated:</strong> 2024. This is a placeholder. Replace with your actual
            Terms &amp; Conditions.
          </p>
          <h2>Acceptance</h2>
          <p>By using MohandisHub you agree to these terms.</p>
          <h2>Service</h2>
          <p>
            MohandisHub connects customers with experts and businesses for engineering-related
            services.
          </p>
          <h2>Contact</h2>
          <p>For questions about these terms, contact us at the address provided in the app.</p>
        </div>
      </div>
    </main>
  );
};

export default TermsPage;
