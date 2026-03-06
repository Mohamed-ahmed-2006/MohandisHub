import { notFound } from 'next/navigation';

import { VerifyEmailScreen } from '@/components/auth/verify-email-screen';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

type VerifyEmailPageProps = {
  params: Promise<{
    locale: string;
  }>;
};

const VerifyEmailPage = async ({ params }: VerifyEmailPageProps) => {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const dictionary = getDictionary(locale);

  return <VerifyEmailScreen locale={locale} dictionary={dictionary} />;
};

export default VerifyEmailPage;
