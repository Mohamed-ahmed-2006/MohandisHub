import { notFound } from 'next/navigation';

import { ProjectsScreen } from '@/components/app/projects-screen';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

type ProjectsPageProps = {
  params: Promise<{ locale: string }>;
};

const ProjectsPage = async ({ params }: ProjectsPageProps) => {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  const dictionary = await getDictionary(locale);
  return <ProjectsScreen locale={locale} dictionary={dictionary} />;
};

export default ProjectsPage;
