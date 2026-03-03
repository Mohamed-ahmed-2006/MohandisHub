import { notFound } from 'next/navigation';

import { AuthFormScreen } from '@/components/auth/auth-form-screen';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

type AuthPageProps = {
  params: Promise<{
    locale: string;
  }>;
  searchParams: Promise<{
    mode?: string;
    role?: string;
  }>;
};

const AuthPage = async ({ params, searchParams }: AuthPageProps) => {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const dictionary = getDictionary(locale);
  const resolvedSearch = await searchParams;

  const mode = resolvedSearch.mode === 'register' ? 'register' : 'login';
  const role =
    resolvedSearch.role === 'expert' ||
    resolvedSearch.role === 'business' ||
    resolvedSearch.role === 'customer'
      ? resolvedSearch.role
      : 'customer';

  return (
    <AuthFormScreen locale={locale} dictionary={dictionary} initialMode={mode} initialRole={role} />
  );
};

export default AuthPage;
