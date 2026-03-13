import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { LanguageToggle } from '@/components/language-toggle';
import { SiteLogo } from '@/components/site-logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Container } from '@/components/ui/container';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { buildLocalePath } from '@/lib/i18n/path';

type ResetPasswordPageProps = {
  params: Promise<{
    locale: string;
  }>;
  searchParams: Promise<{
    token?: string;
  }>;
};

const ResetPasswordPage = async ({ params, searchParams }: ResetPasswordPageProps) => {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const dictionary = await getDictionary(locale);
  const resolvedSearch = await searchParams;
  const token = typeof resolvedSearch.token === 'string' ? resolvedSearch.token : null;

  return (
    <main className="auth-page-main" suppressHydrationWarning>
      <div className="auth-page-floating-controls">
        <LanguageToggle
          locale={locale}
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

      <Container className="auth-page-container">
        <header className="auth-page-header">
          <Link href={buildLocalePath(locale, '/')} className="auth-page-brand-link">
            <SiteLogo />
          </Link>
        </header>

        <ResetPasswordForm locale={locale} dictionary={dictionary.auth} token={token} />
      </Container>
    </main>
  );
};

export default ResetPasswordPage;
