'use client';

import { useEffect, useMemo, useState } from 'react';

import { DEGREES } from '@/lib/data/degrees';
import { COUNTRIES } from '@/lib/data/countries';
import { getCountryFromIp } from '@/lib/geo/ip-geo';
import {
  getUniversitiesByCountry,
  getUniversityName,
  type Locale,
} from '@/lib/data/universities';

type Props = {
  locale: Locale;
  degreeLabel: string;
  institutionLabel: string;
  otherLabel: string;
  degreeName: string;
  institutionName: string;
  selectClassName?: string;
  defaultCountry?: string;
  required?: boolean;
};

export function DegreeInstitutionSelect({
  locale,
  degreeLabel,
  institutionLabel,
  otherLabel,
  degreeName,
  institutionName,
  selectClassName = '',
  defaultCountry = '',
  required = true,
}: Props) {
  const [countryCode, setCountryCode] = useState(defaultCountry || '');
  const [countryResolved, setCountryResolved] = useState(false);
  const [institutionValue, setInstitutionValue] = useState('');
  const [institutionOtherText, setInstitutionOtherText] = useState('');

  useEffect(() => {
    if (defaultCountry) {
      setCountryCode(defaultCountry);
      setCountryResolved(true);
      return;
    }
    getCountryFromIp()
      .then((code) => {
        if (code && COUNTRIES.some((c) => c.code === code)) {
          setCountryCode(code);
        }
      })
      .finally(() => setCountryResolved(true));
  }, [defaultCountry]);

  const isAr = locale === 'ar';
  const nameKey = isAr ? 'nameAr' : 'nameEn';

  const universities = useMemo(
    () => (countryCode ? getUniversitiesByCountry(countryCode) : []),
    [countryCode],
  );

  const showOtherInstitution = institutionValue === '__other__';
  const effectiveInstitution = showOtherInstitution ? institutionOtherText : institutionValue;

  return (
    <>
      <div className="onboarding-field">
        <label className="onboarding-label">{degreeLabel}</label>
        <select name={degreeName} className={selectClassName} required={required}>
          <option value="">—</option>
          {DEGREES.map((d) => (
            <option key={d.id} value={d[nameKey]}>
              {d[nameKey]}
            </option>
          ))}
        </select>
      </div>

      <div className="onboarding-field">
        <label className="onboarding-label">{institutionLabel}</label>
        <select
          className={selectClassName}
          value={institutionValue}
          onChange={(e) => setInstitutionValue(e.target.value)}
          required={false}
          disabled={!countryResolved}
        >
          <option value="">—</option>
          {universities.map((u) => (
            <option key={u} value={u}>
              {getUniversityName(u, locale)}
            </option>
          ))}
          <option value="__other__">{otherLabel}</option>
        </select>
        {showOtherInstitution && (
          <input
            type="text"
            className={selectClassName}
            placeholder={institutionLabel}
            value={institutionOtherText}
            onChange={(e) => setInstitutionOtherText(e.target.value)}
            required={required}
            style={{ marginTop: '0.5rem' }}
          />
        )}
        <input
          type="hidden"
          name={institutionName}
          value={effectiveInstitution}
          readOnly
        />
      </div>
    </>
  );
}
