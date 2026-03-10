'use client';

import { LANGUAGES } from '@/lib/data/languages';

type Locale = 'ar' | 'en';

type Props = {
  name: string;
  locale: Locale;
  defaultValue?: string[];
  required?: boolean;
  className?: string;
  checkboxClassName?: string;
};

/**
 * Languages as checkboxes (mobile-friendly, no Ctrl needed).
 */
export function LanguagesCheckboxes({
  name,
  locale,
  defaultValue = [],
  required = false,
  className = '',
  checkboxClassName = '',
}: Props) {
  const nameKey = locale === 'ar' ? 'nameAr' : 'nameEn';

  return (
    <div className={`languages-checkboxes-container ${className}`.trim()}>
      <div role="group" aria-required={required} style={{ display: 'contents' }}>
        {LANGUAGES.map((l) => {
          const label = l[nameKey];
          const isChecked = defaultValue.includes(label);
          return (
            <label
              key={l.code}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                name={name}
                value={label}
                defaultChecked={isChecked}
                className={checkboxClassName}
              />
              <span>{label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
