import type { UserRole } from '@mohandishub/shared';

import { getSuggestionRoleKey } from '@/lib/second-home';

type SuggestionsDictionary = {
  customer: {
    title: string;
    items: string[];
    ctaLabel: string;
  };
  expert: {
    title: string;
    items: string[];
    ctaLabel: string;
  };
  business: {
    title: string;
    items: string[];
    ctaLabel: string;
  };
  admin: {
    title: string;
    items: string[];
    ctaLabel: string;
  };
  unknown: {
    title: string;
    items: string[];
  };
};

type RoleSuggestionsProps = {
  role: UserRole | null;
  dictionary: SuggestionsDictionary;
};

export const RoleSuggestions = ({ role, dictionary }: RoleSuggestionsProps) => {
  const key = getSuggestionRoleKey(role);
  const config = dictionary[key];

  return (
    <section className="app-home-card">
      <h2 className="app-home-section-title">{config.title}</h2>
      <ul className="app-home-list">
        {config.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      {'ctaLabel' in config ? (
        <button type="button" className="app-home-primary-button">
          {config.ctaLabel}
        </button>
      ) : null}
    </section>
  );
};
