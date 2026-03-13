import { notFound } from 'next/navigation';

import { ComingSoonPage } from '@/components/app/coming-soon-page';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

type ProjectsPageProps = {
  params: Promise<{ locale: string }>;
};

const ProjectsPage = async ({ params }: ProjectsPageProps) => {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  const dictionary = await getDictionary(locale);
  return <ComingSoonPage locale={locale} dictionary={dictionary} title={dictionary.nav.projects} />;
};

export default ProjectsPage;
