'use client';

import { useCallback, useEffect, useState } from 'react';

import { CITIES, getCitiesByCountry } from '@/lib/data/cities';
import { COUNTRIES, findCountryByCode, findCountryByName } from '@/lib/data/countries';
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
  forceIpCountry?: boolean;
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
  forceIpCountry = false,
}: Props) {
  const nameKey = locale === 'ar' ? 'nameAr' : 'nameEn';
  const [userSelectedCountry, setUserSelectedCountry] = useState(false);

  const resolveInitialCountryCode = useCallback(() => {
    if (!defaultCountry) return '';
    const byName = COUNTRIES.find((c) => c[nameKey] === defaultCountry);
    if (byName) return byName.code;
    const byCode = findCountryByCode(defaultCountry);
    return byCode ? byCode.code : '';
  }, [defaultCountry, nameKey]);

  const [countryCode, setCountryCode] = useState(() =>
    forceIpCountry ? '' : resolveInitialCountryCode(),
  );
  const [cityCode, setCityCode] = useState('');
  const [ipLoading, setIpLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  const citiesForCountry = countryCode ? getCitiesByCountry(countryCode) : [];
  const country = countryCode ? findCountryByCode(countryCode) : null;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || (!forceIpCountry && defaultCountry)) {
      setIpLoading(false);
      return;
    }
    if (!forceIpCountry && userSelectedCountry) {
      setIpLoading(false);
      return;
    }
    void getCountryFromIp()
      .then((code) => {
        if (code && COUNTRIES.some((c) => c.code === code)) {
          setCountryCode(code);
        }
      })
      .finally(() => setIpLoading(false));
  }, [mounted, defaultCountry, forceIpCountry, userSelectedCountry]);

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
          <input type="hidden" name={countryName} value={countryDisplayName} />
          <select
            className={selectClassName}
            value={countryDisplayName}
            onChange={(e) => {
              const entry = findCountryByName(e.target.value);
              if (!entry) {
                setCountryCode('');
                setCityCode('');
                setUserSelectedCountry(true);
                return;
              }

              setCountryCode(entry.code);
              setCityCode('');
              setUserSelectedCountry(true);
            }}
            disabled={forceIpCountry}
            aria-label={countryLabel}
          >
            <option value="">{ipLoading ? 'Detecting…' : '—'}</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c[nameKey]}>
                {c[nameKey]}
              </option>
            ))}
          </select>
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
