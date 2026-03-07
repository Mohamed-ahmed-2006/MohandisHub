import Link from 'next/link';
import { notFound } from 'next/navigation';

import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { buildLocalePath } from '@/lib/i18n/path';

type PrivacyPageProps = {
  params: Promise<{ locale: string }>;
};

const PrivacyPage = async ({ params }: PrivacyPageProps) => {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const dictionary = getDictionary(locale);
  const title = dictionary.auth.register.privacyPolicy;

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
            Privacy Policy.
          </p>
          <h2>Information we collect</h2>
          <p>
            We collect information you provide when you register, use our services, or contact us.
          </p>
          <h2>How we use it</h2>
          <p>
            We use your information to operate the platform, communicate with you, and improve our
            services.
          </p>
          <h2>Contact</h2>
          <p>For privacy questions, contact us at the address provided in the app.</p>
        </div>
      </div>
    </main>
  );
};

export default PrivacyPage;
