'use client';

import { usePathname } from 'next/navigation';

import { useAppStatus } from '@/components/app-status-provider';
import { useAuth } from '@/components/auth/auth-provider';
import { MaintenancePage } from '@/components/maintenance-page';
import { getLocaleFromPath } from '@/lib/i18n/path';

export function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const { status, loading } = useAppStatus();
  const { authUser } = useAuth();

  if (loading || !status) {
    return <>{children}</>;
  }

  if (!status.maintenanceMode) {
    return <>{children}</>;
  }

  const isAuthPath = pathname.includes('/auth');
  const isAdmin = authUser?.isAdmin === true;

  if (isAuthPath || isAdmin) {
    return <>{children}</>;
  }

  const locale = getLocaleFromPath(pathname) ?? 'en';
  return <MaintenancePage locale={locale} message={status.maintenanceMessage} />;
}
