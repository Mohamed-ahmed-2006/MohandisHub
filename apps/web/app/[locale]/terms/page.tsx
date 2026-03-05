import { notFound } from 'next/navigation';

import { Container } from '@/components/ui/container';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

type TermsPageProps = {
  params: Promise<{
    locale: string;
  }>;
};

const TermsPage = async ({ params }: TermsPageProps) => {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const dictionary = getDictionary(locale);

  return (
    <main className="legal-page-main">
      <Container className="legal-page-container">
        <h1 className="legal-page-title">{dictionary.auth.register.termsAndConditions}</h1>
        <p className="legal-page-coming-soon">{dictionary.common.comingSoon}</p>
      </Container>
    </main>
  );
};

export default TermsPage;
