import type { UserRole } from '@mohandishub/shared';
import { notFound } from 'next/navigation';

import { ButtonLink } from '@/components/ui/button-link';
import { Card } from '@/components/ui/card';
import { Container } from '@/components/ui/container';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Locale } from '@/lib/i18n/types';

/** Roles a user can self-select during onboarding (admin is never selectable). */
type SelectableRole = Exclude<UserRole, 'admin'>;

const roles: SelectableRole[] = ['customer', 'expert', 'business'];

type RoleSelectionPageProps = {
  params: Promise<{
    locale: string;
  }>;
};

const RoleSelectionPage = async ({ params }: RoleSelectionPageProps) => {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const dictionary = getDictionary(locale);
  const typedLocale: Locale = locale;

  const rolePathMap: Record<SelectableRole, string> = {
    customer: `${buildLocalePath(typedLocale, '/auth')}?mode=register&role=customer`,
    expert: `${buildLocalePath(typedLocale, '/auth')}?mode=register&role=expert`,
    business: `${buildLocalePath(typedLocale, '/auth')}?mode=register&role=business`,
  };

  const roleContentMap = {
    customer: dictionary.onboarding.role.cards.customer,
    expert: dictionary.onboarding.role.cards.expert,
    business: dictionary.onboarding.role.cards.business,
  } as const;

  return (
    <main className="role-selection-page-main">
      <Container>
        <h1 className="role-selection-page-title">{dictionary.onboarding.role.title}</h1>
        <p className="role-selection-page-description">{dictionary.onboarding.role.description}</p>

        <div className="role-selection-card-grid">
          {roles.map((role) => {
            const roleContent = roleContentMap[role];

            return (
              <Card key={role} className="role-selection-card">
                <div>
                  <h2 className="role-selection-card-title">{roleContent.title}</h2>
                  <p className="role-selection-card-description">{roleContent.description}</p>
                </div>
                <ButtonLink
                  href={rolePathMap[role]}
                  label={dictionary.common.continue}
                  className="role-selection-continue-button"
                />
              </Card>
            );
          })}
        </div>
      </Container>
    </main>
  );
};

export default RoleSelectionPage;
