import type { Metadata } from 'next';
import { Manrope, Sora } from 'next/font/google';
import Script from 'next/script';

import { AuthProvider } from '@/components/auth/auth-provider';
import { ThemeProvider, themeInitScript } from '@/components/theme-provider';

import './globals.css';

const manrope = Manrope({
  variable: '--font-manrope',
  subsets: ['latin'],
});

const sora = Sora({
  variable: '--font-sora',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'MohandisHub',
  description: 'Engineering services marketplace connecting customers, experts, and businesses.',
  icons: {
    icon: [
      { url: '/icons/favicon-light.png', media: '(prefers-color-scheme: light)' },
      { url: '/icons/favicon-dark.png', media: '(prefers-color-scheme: dark)' },
      { url: '/icons/favicon-light.png' },
    ],
    apple: [{ url: '/icons/favicon-light.png' }],
  },
};

type RootLayoutProps = Readonly<{
  children: React.ReactNode;
}>;

const RootLayout = ({ children }: RootLayoutProps) => {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="mohandishub-theme-init" strategy="beforeInteractive">
          {themeInitScript}
        </Script>
      </head>
      <body className={`${manrope.variable} ${sora.variable}`}>
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
};

export default RootLayout;
