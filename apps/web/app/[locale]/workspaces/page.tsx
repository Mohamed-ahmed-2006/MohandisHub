import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { WorkspaceScreen } from '@/components/team/workspace-screen';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

type WorkspacesPageProps = {
  params: Promise<{
    locale: string;
  }>;
};

const WorkspacesPage = async ({ params }: WorkspacesPageProps) => {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const dictionary = await getDictionary(locale);

  return (
    <Suspense fallback={<p className="dashboard-empty">Loading workspaces...</p>}>
      <WorkspaceScreen locale={locale} dictionary={dictionary} />
    </Suspense>
  );
};

export default WorkspacesPage;
