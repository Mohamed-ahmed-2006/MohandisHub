'use client';

import type { ServiceCategory, ServiceSearchResult } from '@mohandishub/shared';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { CustomerDashboard } from './customer-dashboard';
import { ExpertDashboard } from './expert-dashboard';

import { useAuth } from '@/components/auth/auth-provider';
import { Container } from '@/components/ui/container';
import { Skeleton, SkeletonCard, SkeletonText } from '@/components/ui/skeleton';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';
import { servicesApiClient } from '@/lib/services/client';
import { walletApiClient } from '@/lib/wallet/client';

import '@/app/dashboard.css';

type AppHomeScreenProps = {
  locale: Locale;
  dictionary: Dictionary;
};

const EGYPTIAN_CITIES = [
  'Cairo',
  'Alexandria',
  'Giza',
  'Shubra El Kheima',
  'Port Said',
  'Suez',
  'Luxor',
  'Mansoura',
  'Tanta',
  'El Mahalla El Kubra',
  'Shibin El Kom',
  'Asyut',
  'Ismailia',
  'Fayyum',
  'Zagazig',
  'Aswan',
  'Damietta',
  'Damanhur',
  'Kafr El Sheikh',
  'Banha',
  'Bilbeis',
  '10th of Ramadan',
  'Qalyub',
  'Kafr El Dawwar',
  'Marsa Matrouh',
  'Arish',
  'Rosetta',
  'Mallawi',
  'Edfu',
  'Safaga',
  'Minya',
  'Beni Suef',
  'Qena',
  'Sohag',
  'Hurghada',
  'Sharm El Sheikh',
  '6th of October',
  'New Cairo',
  'Obour',
];

/** Areas per city (districts). When city has no list, we show a generic option. */
const CITY_AREAS: Record<string, string[]> = {
  Cairo: [
    'Downtown',
    'Nasr City',
    'Heliopolis',
    'Maadi',
    'New Maadi',
    'Zamalek',
    'Garden City',
    'Abbasia',
    'Mokattam',
    'El Rehab',
    'Tagamoa',
    'Dokki',
    'Mohandessin',
    'Haram',
    'Faisal',
    'New Cairo',
    '6th of October',
    'Shubra',
    'Ain Shams',
    'Mataria',
    'Marg',
  ],
  Alexandria: [
    'Al Raml',
    'Montaza',
    'Smouha',
    'Sidi Gaber',
    'Sporting',
    'Miami',
    'Stanley',
    'Roushdy',
    'San Stefano',
    'Saba Pasha',
    'Ibrahimia',
    'Louran',
    'Gianaclis',
    'Kafr Abdo',
    'Mansheya',
    'Bacchus',
    'Bolkly',
    'Glim',
    'Mandara',
    'Agami',
  ],
  Giza: [
    'Dokki',
    'Mohandessin',
    'Haram',
    'Faisal',
    '6th of October',
    'Sheikh Zayed',
    'Hadayek Al Ahram',
    'Hadayek October',
    'Agouza',
    'Imbaba',
    'Bulaq',
    'Omrania',
    'Warraq',
  ],
  '6th of October': [
    'October Gardens',
    'First District',
    'Second District',
    'Third District',
    'Fourth District',
    'Fifth District',
    'Sixth District',
    'Seventh District',
    '8th District',
    '11th District',
    '12th District',
    'Industrial Zone',
    'Northern Expansions',
  ],
  'New Cairo': [
    'First Settlement',
    'Second Settlement',
    'Third Settlement',
    'Fourth Settlement',
    'Fifth Settlement',
    'Rehab',
    'Badr',
    'Andalusia',
    'Narges',
    'Lotus',
    'South Academy',
    'North Investors',
    'South Investors',
  ],
  Obour: ['Obour City', 'First District', 'Second District', 'Family Housing', 'Industrial Zone'],
  Luxor: ['East Bank', 'West Bank', 'Karnak', 'Luxor City', 'Armant', 'Esna', 'Al Bayadiya'],
  Aswan: ['Aswan City', 'Elephantine', 'Kitchener Island', 'Kom Ombo', 'Daraw', 'Abu Simbel'],
  'Sharm El Sheikh': ['Naama Bay', 'Hadaba', 'Old Sharm', 'Ras Mohammed'],
  Hurghada: [
    'Sakkala',
    'Dahar',
    'El Kawther',
    'Intercontinental',
    'Arabia',
    'Mubarak 6',
    'El Gouna',
    'Makadi',
    'Sahl Hasheesh',
  ],
  Mansoura: ['Downtown', 'Talkha', 'Toriel', 'University District', 'Gamalia', 'New Mansoura'],
  Tanta: ['Downtown', 'Saeed', 'El Bahr', 'Al Nadi', 'Qotour Road', 'Shibin El Kom Road'],
  'El Mahalla El Kubra': [
    'El Shohada',
    'Abu Rady',
    'Sikka El Wasat',
    'El Nadi',
    'El Mahatta',
    'Industrial Zone',
  ],
  'Shibin El Kom': ['Downtown', 'Kafr El Moselha', 'Mubarak District', 'El May', 'Sadat Road'],
  Suez: ['Port Tawfiq', 'Arbaeen', 'Faisal', 'Ataka', 'Ganayen'],
  'Port Said': ['Port Fouad', 'Al Arab', 'Al Dawahy', 'Al Sharq', 'Al Manakh', 'Al Zohour'],
  Ismailia: ['Downtown', 'Sheikh Zayed', 'Third District', 'Canal Zone', 'Fayed', 'Abu Sultan'],
  Fayyum: ['Fayoum City', 'Tunis Village', 'Sinnuris', 'Itsa', 'Atsa', 'Etsa'],
  Zagazig: ['Downtown', 'University', 'Qawmia', 'Hariry', 'Al Sawaqy'],
  Damietta: ['Ras El Bar', 'New Damietta', 'Damietta Port', 'Ezbet El Borg', 'Faraskur', 'Kafr Saad'],
  Damanhur: ['Downtown', 'Shubra', 'Abu Rish', 'Nadi Area', 'Industrial'],
  'Kafr El Sheikh': [
    'Downtown',
    'Sidi Salem',
    'Desouk',
    'Baltim',
    'Motobas',
    'Biyala',
    'Hamoul',
  ],
  Banha: ['Downtown', 'Atreeb', 'Kafr El Gazar', 'Banha University', 'Kafr Saad'],
  Bilbeis: ['Downtown', 'Orabi', 'Industrial Zone', 'Al Talaein', 'Anshas'],
  '10th of Ramadan': [
    'First District',
    'Second District',
    'Third District',
    'Fourth District',
    'Fifth District',
    'Industrial Zone A',
    'Industrial Zone B',
    'Industrial Zone C',
  ],
  Qalyub: ['Downtown', 'Shubra Road', 'Syndicate Area', 'Industrial', 'Ezbet El Nasr'],
  'Kafr El Dawwar': ['Downtown', 'Sidi Ghazi', 'Kom El Berka', 'Factories Area', 'El Mallaha'],
  'Marsa Matrouh': ['Downtown', 'Rommel', 'Cleopatra', 'Alam El Roum', 'Agiba', 'El Obayed'],
  Arish: ['Downtown', 'Al Masaeed', 'Al Safa', 'Al Zahour', 'Al Salam', 'Abu Saqal'],
  Rosetta: ['Downtown', 'Rashid Port', 'Abu Mandour', 'Edfina'],
  Mallawi: ['Downtown', 'North Mallawi', 'South Mallawi', 'Industrial', 'New Mallawi'],
  Edfu: ['Downtown', 'Al Bansafis', 'Al Redesia', 'Kom Ombo Road'],
  Safaga: ['Downtown', 'Port Area', 'Tourist Promenade', 'South Safaga', 'Industrial'],
  Minya: ['Downtown', 'New Minya', 'Samalut', 'Beni Mazar', 'Maghagha', 'Abu Qurqas'],
  'Beni Suef': ['Downtown', 'New Beni Suef', 'Biba', 'Nasser', 'Ehnasia', 'Al Wasta'],
  Qena: ['Downtown', 'New Qena', 'Qus', 'Nag Hammadi', 'Dishna'],
  Sohag: ['Downtown', 'New Sohag', 'Akhmim', 'Tahta', 'Girga'],
  'Shubra El Kheima': ['Downtown', 'Bahteem', 'Mashtool', 'Industrial', 'Mostorod'],
  Asyut: ['Downtown', 'New Asyut', 'Al Fath', 'Abnoub', 'Dairut'],
};

export const AppHomeScreen = ({ locale, dictionary }: AppHomeScreenProps) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { authUser, accessToken, isAuthenticated, isReady, authGuard } = useAuth();

  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [city, setCity] = useState('');
  const [area, setArea] = useState('');
  const [providerType, setProviderType] = useState('');
  const [results, setResults] = useState<ServiceSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedResult, setSelectedResult] = useState<ServiceSearchResult | null>(null);
  const [customerNeedsCount, setCustomerNeedsCount] = useState<number | null>(null);
  const [customerTab, setCustomerTab] = useState<'browse' | 'posted'>('browse');
  const [topSlideIndex, setTopSlideIndex] = useState(0);

  const areaOptions = city ? (CITY_AREAS[city] ?? []) : [];
  const handleCityChange = (newCity: string) => {
    setCity(newCity);
    setArea('');
  };

  const [stripeMessage, setStripeMessage] = useState<'success' | 'cancelled' | null>(null);

  useEffect(() => {
    const stripe = searchParams.get('stripe');
    const sessionId = searchParams.get('session_id');
    if (stripe === 'success' || stripe === 'cancelled') {
      setStripeMessage(stripe);
      const intervalRef: { current: ReturnType<typeof setInterval> | null } = { current: null };
      if (stripe === 'success' && accessToken) {
        void (async () => {
          if (sessionId) {
            try {
              await walletApiClient.confirmStripeSession(accessToken, sessionId);
            } catch {
              // e.g. invalid session or already credited; still refetch
            }
          }
          try {
            const updated = await walletApiClient.getMyWallet(accessToken);
            window.dispatchEvent(new CustomEvent('wallet-updated'));
          } catch {
            // ignore
          }
          const maxAttempts = 30;
          let attempts = 0;
          intervalRef.current = setInterval(() => {
            attempts += 1;
            if (attempts > maxAttempts && intervalRef.current) {
              clearInterval(intervalRef.current);
              intervalRef.current = null;
              return;
            }
            window.dispatchEvent(new CustomEvent('wallet-updated'));
          }, 2000);
          // Clear URL only after we've confirmed and refetched, so balance is updated. This allows
          // the effect to run again with accessToken when it was initially null (params preserved).
          const url = new URL(window.location.href);
          if (url.searchParams.get('stripe') === 'success' || url.searchParams.has('session_id')) {
            url.searchParams.delete('stripe');
            url.searchParams.delete('session_id');
            window.history.replaceState({}, '', url.pathname + url.search);
          }
        })();
      } else if (stripe === 'cancelled') {
        const t = setTimeout(() => {
          const url = new URL(window.location.href);
          url.searchParams.delete('stripe');
          url.searchParams.delete('session_id');
          window.history.replaceState({}, '', url.pathname + url.search);
        }, 500);
        return () => clearTimeout(t);
      }
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    }
  }, [searchParams, accessToken]);

  useEffect(() => {
    const post = searchParams.get('post');
    if (post === '1' && authUser?.role === 'customer') {
      window.dispatchEvent(new CustomEvent('customer-dashboard-post-need'));
      const url = new URL(window.location.href);
      url.searchParams.delete('post');
      window.history.replaceState({}, '', url.pathname + (url.search || ''));
    }
  }, [searchParams, authUser?.role]);

  useEffect(() => {
    if (!isReady) return;
    if (!isAuthenticated || !authUser) {
      router.replace(`${buildLocalePath(locale, '/auth')}?mode=login`);
      return;
    }
    if (!authGuard.emailVerified) {
      router.replace(buildLocalePath(locale, '/verify-email'));
    }
  }, [isReady, isAuthenticated, authUser, authGuard.emailVerified, locale, router]);

  useEffect(() => {
    void servicesApiClient.getCategories().then(setCategories);
  }, []);

  // Top experts/business slideshow auto-rotate
  useEffect(() => {
    const t = setInterval(() => setTopSlideIndex((i) => (i + 1) % 2), 5000);
    return () => clearInterval(t);
  }, []);

  const handleSearch = useCallback(async () => {
    setSearching(true);
    setHasSearched(true);
    try {
      const params: {
        categoryId?: string;
        city?: string;
        area?: string;
        providerType?: string;
        q?: string;
      } = {};
      if (categoryId) params.categoryId = categoryId;
      if (city) params.city = city;
      if (area) params.area = area;
      if (providerType) params.providerType = providerType;
      if (searchQuery.trim()) params.q = searchQuery.trim();
      const data = await servicesApiClient.searchServices(params);
      setResults(data.items);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [categoryId, city, area, providerType, searchQuery]);

  const d = dictionary.homeSearch;
  const categoryName = (cat: ServiceCategory) => (locale === 'ar' ? cat.nameAr : cat.nameEn);

  if (!authUser) {
    return (
      <main className="home-main">
        <Container className="home-container">
          <div className="home-skeleton">
            <SkeletonText lines={2} className="home-skeleton-welcome" />
            <div className="home-skeleton-cards">
              <SkeletonCard />
              <SkeletonCard />
            </div>
          </div>
        </Container>
      </main>
    );
  }

  if (!isReady) {
    return (
      <main className="home-main">
        <Container className="home-container">
          <section className="home-welcome-section">
            <h1 className="home-welcome">
              {d.welcomeBack}, {authUser.displayName}
            </h1>
            <Skeleton style={{ width: '60%', height: '1rem' }} />
          </section>
        </Container>
      </main>
    );
  }

  return (
    <main className="home-main">
      <Container className="home-container">
        {stripeMessage && (
          <div className={`home-stripe-message home-stripe-message--${stripeMessage}`} role="alert">
            {stripeMessage === 'success'
              ? (dictionary.wallet.depositSuccess ??
                'Deposit successful. Your balance has been updated.')
              : (dictionary.wallet.depositCancelled ?? 'Deposit was cancelled.')}
            <button
              type="button"
              className="home-stripe-message-dismiss"
              onClick={() => setStripeMessage(null)}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        {/* Welcome — no balance or post button here; those are in header and Posted section */}
        <section className="home-welcome-section">
          <div className="home-welcome-row">
            <div>
              <h1 className="home-welcome">
                {d.welcomeBack}, {authUser.displayName}
              </h1>
            </div>
          </div>
        </section>

        {/* Top Experts / Top Businesses slideshow — arrows, dots below, scrollable cards */}
        <section className="home-top-slideshow" aria-label="Top experts and businesses">
          <div className="home-top-slideshow-panels">
            <div
              className={`home-top-slideshow-panel ${topSlideIndex === 0 ? 'home-top-slideshow-panel--active' : ''}`}
              role="tabpanel"
              aria-hidden={topSlideIndex !== 0}
            >
              <h2 className="home-section-title">{d.topExperts}</h2>
              <div className="home-top-cards-grid home-top-cards-grid--scroll">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="home-top-card home-top-card--large home-top-placeholder">
                    <div className="home-top-avatar home-top-avatar--large" />
                    <p className="home-top-name">Coming Soon</p>
                    <p className="home-top-meta">★ —</p>
                  </div>
                ))}
              </div>
            </div>
            <div
              className={`home-top-slideshow-panel ${topSlideIndex === 1 ? 'home-top-slideshow-panel--active' : ''}`}
              role="tabpanel"
              aria-hidden={topSlideIndex !== 1}
            >
              <h2 className="home-section-title">{d.topBusinesses}</h2>
              <div className="home-top-cards-grid home-top-cards-grid--scroll">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="home-top-card home-top-card--large home-top-placeholder">
                    <div className="home-top-avatar home-top-avatar--large" />
                    <p className="home-top-name">Coming Soon</p>
                    <p className="home-top-meta">Field — ★ —</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="home-top-slideshow-controls">
            <button
              type="button"
              className="home-top-slideshow-arrow home-top-slideshow-arrow--standalone"
              aria-label="Previous slide"
              onClick={() => setTopSlideIndex((i) => (i === 0 ? 1 : 0))}
            >
              ‹
            </button>
            <div className="home-top-slideshow-dots" role="tablist">
              <button
                type="button"
                role="tab"
                aria-label={d.topExperts}
                aria-selected={topSlideIndex === 0}
                className="home-top-slideshow-dot"
                onClick={() => setTopSlideIndex(0)}
              />
              <button
                type="button"
                role="tab"
                aria-label={d.topBusinesses}
                aria-selected={topSlideIndex === 1}
                className="home-top-slideshow-dot"
                onClick={() => setTopSlideIndex(1)}
              />
            </div>
            <button
              type="button"
              className="home-top-slideshow-arrow home-top-slideshow-arrow--standalone"
              aria-label="Next slide"
              onClick={() => setTopSlideIndex((i) => (i + 1) % 2)}
            >
              ›
            </button>
          </div>
        </section>

        {/* Role-based dashboard with Browse / Posted tabs for customers */}
        {authUser.role === 'customer' && accessToken && (
          <>
            <div className="dashboard-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={customerTab === 'browse'}
                className={`dashboard-tab ${customerTab === 'browse' ? 'dashboard-tab--active' : ''}`}
                onClick={() => setCustomerTab('browse')}
              >
                {d.browseTab}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={customerTab === 'posted'}
                className={`dashboard-tab ${customerTab === 'posted' ? 'dashboard-tab--active' : ''}`}
                onClick={() => setCustomerTab('posted')}
              >
                {d.postedTab}
              </button>
            </div>

            {customerTab === 'browse' && (
              <>
                {/* Search: 4 filter groups — 1) Text search, 2) Service type, 3) Location (city+area), 4) Provider type */}
                <section className="home-search-card">
                  <div className="home-search-grid home-search-grid--4-cols">
                    <div className="home-search-field home-search-field--full">
                      <label className="home-search-label">{d.search}</label>
                      <input
                        type="search"
                        className="home-search-input"
                        placeholder={d.searchPlaceholder}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        aria-label={d.searchPlaceholder}
                      />
                    </div>
                    <div className="home-search-field">
                      <label className="home-search-label">{d.serviceType}</label>
                      <select
                        className="home-search-select"
                        value={categoryId}
                        onChange={(e) => setCategoryId(e.target.value)}
                      >
                        <option value="">{d.chooseServiceType}</option>
                        {categories.map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {categoryName(cat)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="home-search-field">
                      <label className="home-search-label">{d.city}</label>
                      <select
                        className="home-search-select"
                        value={city}
                        onChange={(e) => handleCityChange(e.target.value)}
                      >
                        <option value="">{d.chooseCity}</option>
                        {EGYPTIAN_CITIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="home-search-field">
                      <label className="home-search-label">{d.area}</label>
                      <select
                        className="home-search-select"
                        value={area}
                        onChange={(e) => setArea(e.target.value)}
                        disabled={!city}
                      >
                        <option value="">{areaOptions.length ? d.chooseArea : d.areaPlaceholder}</option>
                        {areaOptions.map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="home-search-field">
                      <label className="home-search-label">{d.providerType}</label>
                      <select
                        className="home-search-select"
                        value={providerType}
                        onChange={(e) => setProviderType(e.target.value)}
                      >
                        <option value="">{d.anyProvider}</option>
                        <option value="expert">{d.expert}</option>
                        <option value="business">{d.businessProvider}</option>
                      </select>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="home-search-btn"
                    onClick={() => void handleSearch()}
                    disabled={searching}
                  >
                    {searching ? dictionary.admin.loading : d.search}
                  </button>
                </section>

                {/* Search Results */}
                {hasSearched && (
                  <section className="home-results-section">
                    <h2 className="home-section-title">
                      {d.results} ({results.length})
                    </h2>
                    {results.length === 0 ? (
                      <p className="home-empty">{d.noResults}</p>
                    ) : (
                      <div className="home-results-grid">
                        {results.map((r) => (
                          <button
                            type="button"
                            key={r.id}
                            className="home-result-card"
                            onClick={() => setSelectedResult(r)}
                          >
                            <div className="home-result-avatar">
                              {r.providerAvatar ? (
                                <Image
                                  src={r.providerAvatar}
                                  alt=""
                                  className="home-result-avatar-img"
                                  width={48}
                                  height={48}
                                />
                              ) : (
                                <span className="home-result-avatar-fallback">
                                  {r.providerName.charAt(0)}
                                </span>
                              )}
                            </div>
                            <div className="home-result-info">
                              <p className="home-result-title">{r.title}</p>
                              <p className="home-result-provider">{r.providerName}</p>
                              <p className="home-result-meta">
                                {locale === 'ar' ? r.categoryNameAr : r.categoryNameEn}
                                {r.city && ` · ${r.city}`}
                              </p>
                              {r.price != null && (
                                <p className="home-result-price">
                                  {r.price} EGP{r.priceType === 'hourly' ? '/hr' : ''}
                                </p>
                              )}
                            </div>
                            {r.isFeatured && <span className="home-result-featured">★</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                )}
              </>
            )}

            {customerTab === 'posted' && (
            <CustomerDashboard
                locale={locale}
                dictionary={dictionary}
                accessToken={accessToken}
                categories={categories}
                showEmptyState={true}
                onNeedsCountChange={setCustomerNeedsCount}
                cities={EGYPTIAN_CITIES.concat('Online', 'Remote')}
                authReady={isReady}
              />
            )}
          </>
        )}
        {(authUser.role === 'expert' || authUser.role === 'business') && accessToken && (
          <ExpertDashboard
            locale={locale}
            dictionary={dictionary}
            accessToken={accessToken}
            categories={categories}
          />
        )}

        {/* Search Bar + Results — for experts/business only (customers have Browse tab) */}
        {(authUser.role === 'expert' || authUser.role === 'business') && (
          <>
            <section className="home-search-card">
              <div className="home-search-grid home-search-grid--4-cols">
                <div className="home-search-field home-search-field--full">
                  <label className="home-search-label">{d.search}</label>
                  <input
                    type="search"
                    className="home-search-input"
                    placeholder={d.searchPlaceholder}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    aria-label={d.searchPlaceholder}
                  />
                </div>
                <div className="home-search-field">
                  <label className="home-search-label">{d.serviceType}</label>
                  <select
                    className="home-search-select"
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                  >
                    <option value="">{d.chooseServiceType}</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {categoryName(cat)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="home-search-field">
                  <label className="home-search-label">{d.city}</label>
                  <select
                    className="home-search-select"
                    value={city}
                    onChange={(e) => handleCityChange(e.target.value)}
                  >
                    <option value="">{d.chooseCity}</option>
                    {EGYPTIAN_CITIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="home-search-field">
                  <label className="home-search-label">{d.area}</label>
                  <select
                    className="home-search-select"
                    value={area}
                    onChange={(e) => setArea(e.target.value)}
                    disabled={!city}
                  >
                    <option value="">{areaOptions.length ? d.chooseArea : d.areaPlaceholder}</option>
                    {areaOptions.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="home-search-field">
                  <label className="home-search-label">{d.providerType}</label>
                  <select
                    className="home-search-select"
                    value={providerType}
                    onChange={(e) => setProviderType(e.target.value)}
                  >
                    <option value="">{d.anyProvider}</option>
                    <option value="expert">{d.expert}</option>
                    <option value="business">{d.businessProvider}</option>
                  </select>
                </div>
              </div>

              <button
                type="button"
                className="home-search-btn"
                onClick={() => void handleSearch()}
                disabled={searching}
              >
                {searching ? dictionary.admin.loading : d.search}
              </button>
            </section>

            {hasSearched && (
              <section className="home-results-section">
                <h2 className="home-section-title">
                  {d.results} ({results.length})
                </h2>
                {results.length === 0 ? (
                  <p className="home-empty">{d.noResults}</p>
                ) : (
                  <div className="home-results-grid">
                    {results.map((r) => (
                      <button
                        type="button"
                        key={r.id}
                        className="home-result-card"
                        onClick={() => setSelectedResult(r)}
                      >
                        <div className="home-result-avatar">
                          {r.providerAvatar ? (
                            <Image
                              src={r.providerAvatar}
                              alt=""
                              className="home-result-avatar-img"
                              width={48}
                              height={48}
                            />
                          ) : (
                            <span className="home-result-avatar-fallback">
                              {r.providerName.charAt(0)}
                            </span>
                          )}
                        </div>
                        <div className="home-result-info">
                          <p className="home-result-title">{r.title}</p>
                          <p className="home-result-provider">{r.providerName}</p>
                          <p className="home-result-meta">
                            {locale === 'ar' ? r.categoryNameAr : r.categoryNameEn}
                            {r.city && ` · ${r.city}`}
                          </p>
                          {r.price != null && (
                            <p className="home-result-price">
                              {r.price} EGP{r.priceType === 'hourly' ? '/hr' : ''}
                            </p>
                          )}
                        </div>
                        {r.isFeatured && <span className="home-result-featured">★</span>}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}

        {/* Provider Detail Drawer */}
        {selectedResult && (
          <div className="home-drawer-overlay" onClick={() => setSelectedResult(null)}>
            <div className="home-drawer" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="home-drawer-close"
                onClick={() => setSelectedResult(null)}
              >
                ×
              </button>
              <div className="home-drawer-avatar">
                {selectedResult.providerAvatar ? (
                  <Image
                    src={selectedResult.providerAvatar}
                    alt=""
                    className="home-drawer-avatar-img"
                    width={80}
                    height={80}
                  />
                ) : (
                  <span className="home-drawer-avatar-fallback">
                    {selectedResult.providerName.charAt(0)}
                  </span>
                )}
              </div>
              <h2 className="home-drawer-title">{selectedResult.title}</h2>
              <p className="home-drawer-provider">{selectedResult.providerName}</p>
              <p className="home-drawer-role">{selectedResult.providerRole}</p>
              {selectedResult.price != null && (
                <p className="home-drawer-price">
                  {selectedResult.price} EGP{' '}
                  {selectedResult.priceType === 'hourly'
                    ? '/ hour'
                    : selectedResult.priceType === 'negotiable'
                      ? '(negotiable)'
                      : ''}
                </p>
              )}
              <p className="home-drawer-location">
                {locale === 'ar' ? selectedResult.categoryNameAr : selectedResult.categoryNameEn}
                {selectedResult.city && ` · ${selectedResult.city}`}
                {selectedResult.area && ` · ${selectedResult.area}`}
              </p>
              {selectedResult.avgRating != null && (
                <p className="home-drawer-rating">★ {selectedResult.avgRating.toFixed(1)}</p>
              )}
              <p className="home-drawer-placeholder">{dictionary.common.comingSoon}</p>
            </div>
          </div>
        )}
      </Container>
    </main>
  );
};
