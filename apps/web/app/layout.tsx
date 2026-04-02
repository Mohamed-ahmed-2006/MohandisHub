import type { Metadata } from 'next';
import { Cairo, Manrope, Sora, Tajawal } from 'next/font/google';
import Script from 'next/script';

import { AppStatusProvider } from '@/components/app-status-provider';
import { AuthProvider } from '@/components/auth/auth-provider';
import { GlobalAnnouncementBanner } from '@/components/global-announcement-banner';
import { MaintenanceGate } from '@/components/maintenance-gate';
import SpeedInsightsClient from '@/components/speed-insights-client';
import { ThemeProvider, themeInitScript } from '@/components/theme-provider';
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

export const metadata: Metadata = {
  title: 'MohandisHub',
  description: 'Engineering services marketplace connecting customers, experts, and businesses.',
  manifest: '/manifest',
  icons: {
    icon: [
      { url: `/icon?v=${iconVersion}`, type: 'image/png', sizes: '32x32' },
      { url: `/icons/favicon-light.png?v=${iconVersion}`, media: '(prefers-color-scheme: light)' },
      { url: `/icons/favicon-dark.png?v=${iconVersion}`, media: '(prefers-color-scheme: dark)' },
    ],
    apple: [{ url: `/icon?v=${iconVersion}`, type: 'image/png', sizes: '32x32' }],
  },
};

type RootLayoutProps = Readonly<{
  children: React.ReactNode;
}>;

const RootLayout = ({ children }: RootLayoutProps) => {
  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        <Script id="mohandishub-theme-init" strategy="beforeInteractive">
          {themeInitScript}
        </Script>
      </head>
      <body className={`${manrope.variable} ${sora.variable} ${cairo.variable} ${tajawal.variable}`}>
        <ThemeProvider>
          <AuthProvider>
            <AppStatusProvider>
              <GlobalAnnouncementBanner />
              <MaintenanceGate>{children}</MaintenanceGate>
            </AppStatusProvider>
          </AuthProvider>
        </ThemeProvider>
        <SpeedInsightsClient />
      </body>
    </html>
  );
};

export default RootLayout;
