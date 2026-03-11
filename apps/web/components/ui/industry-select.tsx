'use client';

import { useState } from 'react';

import { INDUSTRIES } from '@/lib/data/industries';

type Locale = 'ar' | 'en';

type Props = {
  locale: Locale;
  name: string;
  subName: string;
  className?: string;
  selectClassName?: string;
  defaultValue?: string;
};

/**
 * Cascading industry select: choose industry, then sub-industry if available.
 * Form submits industry (display name) and subIndustry (display name); handler combines them.
 * defaultValue can be "Industry" or "Industry — SubIndustry".
 */
export function IndustrySelect({
  locale,
  name,
  subName,
  className = '',
  selectClassName = 'onboarding-input',
  defaultValue = '',
}: Props) {
  const nameKey = locale === 'ar' ? 'nameAr' : 'nameEn';
  const [primary, sub] = defaultValue.split(/\s*[—-]\s*/);
  const initialIndustry = primary?.trim() ?? '';
  const initialSub = sub?.trim() ?? '';
  const [selectedIndustryName, setSelectedIndustryName] = useState(initialIndustry);
  const selected = INDUSTRIES.find((i) => i[nameKey] === selectedIndustryName);
  const subIndustries = selected?.subIndustries ?? [];

  return (
    <div className={className}>
      <select
        name={name}
        className={selectClassName}
        value={selectedIndustryName}
        onChange={(e) => setSelectedIndustryName(e.target.value)}
      >
        <option value="">—</option>
        {INDUSTRIES.map((i) => (
          <option key={i.id} value={i[nameKey]}>
            {i[nameKey]}
          </option>
        ))}
      </select>
      {subIndustries.length > 0 && (
        <select
          name={subName}
          className={selectClassName}
          style={{ marginTop: '0.5rem' }}
          defaultValue={initialSub}
        >
          <option value="">—</option>
          {subIndustries.map((s) => (
            <option key={s.id} value={s[nameKey]}>
              {s[nameKey]}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
