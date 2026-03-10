'use client';

import { useCallback, useEffect, useState } from 'react';

import { CITIES, getCitiesByCountry } from '@/lib/data/cities';
import { COUNTRIES, findCountryByCode } from '@/lib/data/countries';
import { getCountryFromIp } from '@/lib/geo/ip-geo';

type Locale = 'ar' | 'en';

type Props = {
  name: string;
  countryName: string;
  locale: Locale;
  cityLabel: string;
  countryLabel: string;
  className?: string;
  selectClassName?: string;
  defaultValue?: string;
  defaultCountry?: string;
  required?: boolean;
};

/**
 * Country select (auto from IP) + city select filtered by country.
 * User selects country first, then city from that country.
 */
export function CityCountrySelect({
  name,
  countryName,
  locale,
  cityLabel,
  countryLabel,
  className = '',
  selectClassName = '',
  defaultValue = '',
  defaultCountry = '',
  required = false,
}: Props) {
  const nameKey = locale === 'ar' ? 'nameAr' : 'nameEn';

  const resolveInitialCountryCode = useCallback(() => {
    if (!defaultCountry) return '';
    const byName = COUNTRIES.find((c) => c[nameKey] === defaultCountry);
    if (byName) return byName.code;
    const byCode = findCountryByCode(defaultCountry);
    return byCode ? byCode.code : '';
  }, [defaultCountry, nameKey]);

  const [countryCode, setCountryCode] = useState(resolveInitialCountryCode);
  const [cityCode, setCityCode] = useState('');
  const [ipLoading, setIpLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  const citiesForCountry = countryCode ? getCitiesByCountry(countryCode) : [];
  const country = countryCode ? findCountryByCode(countryCode) : null;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || defaultCountry) {
      setIpLoading(false);
      return;
    }
    getCountryFromIp()
      .then((code) => {
        if (code && COUNTRIES.some((c) => c.code === code)) {
          setCountryCode(code);
        }
      })
      .finally(() => setIpLoading(false));
  }, [mounted, defaultCountry]);

  useEffect(() => {
    if (!defaultValue || !defaultCountry) return;
    const match = CITIES.find((c) => {
      const cityMatches = c[nameKey] === defaultValue;
      const ctry = findCountryByCode(c.countryCode);
      const countryMatches = ctry && (ctry[nameKey] === defaultCountry || ctry.code === resolveInitialCountryCode());
      return cityMatches && countryMatches;
    });
    if (match) {
      setCountryCode(match.countryCode);
      setCityCode(match.code);
    }
  }, [defaultValue, defaultCountry, nameKey, resolveInitialCountryCode]);

  const selectedCity = cityCode ? CITIES.find((c) => c.code === cityCode) : null;
  const cityDisplayName = selectedCity ? selectedCity[nameKey] : '';
  const countryDisplayName = country ? country[nameKey] : '';

  return (
    <div className={className}>
      <div className="profile-screen-row" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <div className="profile-screen-field" style={{ flex: 1, minWidth: '140px' }}>
          <label className="profile-screen-label">{countryLabel}</label>
          <input
            type="text"
            className={selectClassName}
            value={ipLoading ? 'Detecting…' : countryDisplayName || '—'}
            readOnly
            disabled
            style={{ opacity: 0.9, cursor: 'not-allowed' }}
            aria-label={countryLabel}
          />
          <input type="hidden" name={countryName} value={countryDisplayName} />
        </div>
        <div className="profile-screen-field" style={{ flex: 1, minWidth: '140px' }}>
          <label className="profile-screen-label">{cityLabel}</label>
          <select
            name={name}
            className={selectClassName}
            value={cityDisplayName}
            onChange={(e) => {
              const val = e.target.value;
              const c = citiesForCountry.find((x) => x[nameKey] === val);
              setCityCode(c?.code ?? '');
            }}
            required={required}
            disabled={!countryCode}
          >
            <option value="">—</option>
            {citiesForCountry.map((c) => (
              <option key={c.code} value={c[nameKey]}>
                {c[nameKey]}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
