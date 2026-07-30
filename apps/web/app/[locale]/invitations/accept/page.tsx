import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { InvitationAcceptanceScreen } from '@/components/team/invitation-acceptance-screen';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

type InvitationAcceptPageProps = {
  params: Promise<{
    locale: string;
  }>;
};

const InvitationAcceptPage = async ({ params }: InvitationAcceptPageProps) => {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const dictionary = await getDictionary(locale);

  return (
    <Suspense fallback={<p className="dashboard-empty">Loading invitation...</p>}>
      <InvitationAcceptanceScreen locale={locale} dictionary={dictionary} />
    </Suspense>
  );
};

export default InvitationAcceptPage;
