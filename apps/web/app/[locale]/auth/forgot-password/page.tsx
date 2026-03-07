import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { LanguageToggle } from '@/components/language-toggle';
import { SiteLogo } from '@/components/site-logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Container } from '@/components/ui/container';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { buildLocalePath } from '@/lib/i18n/path';

type ForgotPasswordPageProps = {
  params: Promise<{
    locale: string;
  }>;
};

const ForgotPasswordPage = async ({ params }: ForgotPasswordPageProps) => {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const dictionary = getDictionary(locale);

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

        <ForgotPasswordForm locale={locale} dictionary={dictionary.auth} />
      </Container>
    </main>
  );
};

export default ForgotPasswordPage;
