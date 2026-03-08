'use client';

import Link from 'next/link';

import { buildLocalePath } from '@/lib/i18n/path';
import type { Locale } from '@/lib/i18n/types';

type MaintenancePageProps = {
  locale: Locale;
  message?: string | null;
};

export function MaintenancePage({ locale, message }: MaintenancePageProps) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        textAlign: 'center',
        background: 'hsl(var(--background))',
        color: 'hsl(var(--foreground))',
      }}
    >
      <h1
        style={{
          fontFamily: 'var(--font-sora), sans-serif',
          fontSize: 'clamp(1.5rem, 4vw, 2.5rem)',
          fontWeight: 700,
          marginBottom: '1rem',
        }}
      >
        Under Maintenance
      </h1>
      <p
        style={{
          fontSize: '1rem',
          color: 'hsl(var(--text-soft))',
          maxWidth: '400px',
          marginBottom: '2rem',
        }}
      >
        {message ?? 'We are currently performing scheduled maintenance. Please check back soon.'}
      </p>
      <Link
        href={buildLocalePath(locale, '/auth')}
        style={{
          padding: '0.6rem 1.2rem',
          borderRadius: '999px',
          border: '1px solid hsl(var(--border))',
          background: 'hsl(var(--primary))',
          color: 'hsl(var(--primary-foreground))',
          fontWeight: 600,
          fontSize: '0.9rem',
          textDecoration: 'none',
        }}
      >
        Admin Login
      </Link>
    </div>
  );
}
