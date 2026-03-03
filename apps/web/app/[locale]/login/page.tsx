import { redirect } from 'next/navigation';

import { isSupportedLocale } from '@/lib/i18n/config';
import { buildLocalePath } from '@/lib/i18n/path';

type LoginPageProps = {
  params: Promise<{
    locale: string;
  }>;
};

const LoginPage = async ({ params }: LoginPageProps) => {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    redirect('/en/auth?mode=login');
  }

  redirect(`${buildLocalePath(locale, '/auth')}?mode=login`);
};

export default LoginPage;
