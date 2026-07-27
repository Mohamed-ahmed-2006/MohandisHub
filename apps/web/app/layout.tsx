import type { Metadata, Viewport } from 'next';
import { Cairo, Manrope, Sora, Tajawal } from 'next/font/google';
import { headers } from 'next/headers';
import Script from 'next/script';

import { AppStatusProvider } from '@/components/app-status-provider';
import { AuthProvider } from '@/components/auth/auth-provider';
import { GlobalAnnouncementBanner } from '@/components/global-announcement-banner';
import { MaintenanceGate } from '@/components/maintenance-gate';
import SpeedInsightsClient from '@/components/speed-insights-client';
import { ThemeProvider, themeInitScript } from '@/components/theme-provider';
import { DEFAULT_LOCALE, getDirection, isSupportedLocale } from '@/lib/i18n/config';
import { getIconVersion } from '@/lib/icon-version';

import './globals.css';

const manrope = Manrope({
  variable: '--font-manrope',
  subsets: ['latin'],
});

const sora = Sora({
  variable: '--font-sora',
  subsets: ['latin'],
});

const cairo = Cairo({
  variable: '--font-cairo',
  subsets: ['arabic', 'latin'],
});

const tajawal = Tajawal({
  variable: '--font-tajawal',
  weight: ['400', '700'],
  subsets: ['arabic', 'latin'],
});

const iconVersion = getIconVersion();

const siteUrl =
  process.env.NEXT_PUBLIC_APP_URL?.trim() ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ea580c' },
    { media: '(prefers-color-scheme: dark)', color: '#fb923c' },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'MohandisHub',
  description: 'Engineering services marketplace connecting customers, experts, and businesses.',
  manifest: '/manifest',
  icons: {
    icon: [
      { url: `/icon?v=${iconVersion}`, type: 'image/png', sizes: '32x32' },
      { url: `/brand-icons/192?v=${iconVersion}`, type: 'image/png', sizes: '192x192' },
      { url: `/brand-icons/512?v=${iconVersion}`, type: 'image/png', sizes: '512x512' },
    ],
    apple: [{ url: `/apple-icon?v=${iconVersion}`, type: 'image/png', sizes: '180x180' }],
  },
};

type RootLayoutProps = Readonly<{
  children: React.ReactNode;
}>;

const RootLayout = async ({ children }: RootLayoutProps) => {
  const requestHeaders = await headers();
  const requestedLocale = requestHeaders.get('x-mohandishub-locale') ?? DEFAULT_LOCALE;
  const locale = isSupportedLocale(requestedLocale) ? requestedLocale : DEFAULT_LOCALE;

  return (
    <html
      lang={locale}
      dir={getDirection(locale)}
      suppressHydrationWarning
      data-scroll-behavior="smooth"
    >
      <head>
        <Script id="mohandishub-theme-init" strategy="beforeInteractive">
          {themeInitScript}
        </Script>
      </head>
      <body
        className={`${manrope.variable} ${sora.variable} ${cairo.variable} ${tajawal.variable}`}
      >
        <ThemeProvider>
          <AuthProvider>
            <AppStatusProvider>
              <GlobalAnnouncementBanner />
              <MaintenanceGate>{children}</MaintenanceGate>
            </AppStatusProvider>
          </AuthProvider>
        </ThemeProvider>
        {process.env.VERCEL === '1' ? <SpeedInsightsClient /> : null}
      </body>
    </html>
  );
};

export default RootLayout;
