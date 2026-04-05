'use client';

import type { ServiceCategory, ServiceSearchResult } from '@mohandishub/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { BusinessDashboard } from './business-dashboard';
import { CustomerDashboard } from './customer-dashboard';
import { ExpertDashboard } from './expert-dashboard';
import { useProfileModal } from './profile-modal-context';
import { ServiceBookingModal } from './service-booking-modal';

import { useAppStatus } from '@/components/app-status-provider';
import { useAuth } from '@/components/auth/auth-provider';
import { AvatarImage } from '@/components/ui/avatar-image';
import { Container } from '@/components/ui/container';
import { Skeleton, SkeletonCard, SkeletonText } from '@/components/ui/skeleton';
import { EGYPTIAN_CITIES } from '@/lib/data/egyptian-cities';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';
import type { TopBusiness, TopCraftsman, TopExpert } from '@/lib/profiles/client';
import { profilesApiClient } from '@/lib/profiles/client';
import { servicesApiClient } from '@/lib/services/client';

import '@/app/dashboard.css';

type AppHomeScreenProps = {
  locale: Locale;
  dictionary: Dictionary;
};

const dedupeById = <T extends { id: string }>(items: T[]): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
};

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
  const { status } = useAppStatus();
  const hourlyPricingEnabled = status?.featureHourlyPricingEnabled === true;
  const { openProfileModal } = useProfileModal();
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [city, setCity] = useState('');
  const [area, setArea] = useState('');
  const [providerType, setProviderType] = useState('');
  const [minRating, setMinRating] = useState<number | ''>('');
  const [minPrice, setMinPrice] = useState<number | ''>('');
  const [maxPrice, setMaxPrice] = useState<number | ''>('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [sort, setSort] = useState<string>('newest');
  const [results, setResults] = useState<ServiceSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [selectedResult, setSelectedResult] = useState<ServiceSearchResult | null>(null);
  const [_customerNeedsCount, setCustomerNeedsCount] = useState<number | null>(null);
  const [customerTab, setCustomerTab] = useState<'browse' | 'posted'>('browse');
  const [providerTab, setProviderTab] = useState<'overview' | 'search'>('overview');
  const [topSlideIndex, setTopSlideIndex] = useState(0);
  const [topExperts, setTopExperts] = useState<TopExpert[]>([]);
  const [topCraftsmen, setTopCraftsmen] = useState<TopCraftsman[]>([]);
  const [topBusinesses, setTopBusinesses] = useState<TopBusiness[]>([]);
  const [showBookingModal, setShowBookingModal] = useState(false);
  const totalTopSlides = 3;

  const areaOptions = city ? (CITY_AREAS[city] ?? []) : [];
  const handleCityChange = (newCity: string) => {
    setCity(newCity);
    setArea('');
  };

  // Remove the redundant Stripe checking from AppHomeScreen as it's now handled globally in AppShell
  // ...

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

  useEffect(() => {
    void Promise.all([
      profilesApiClient.getTopExperts(),
      profilesApiClient.getTopCraftsmen(),
      profilesApiClient.getTopBusinesses(),
    ]).then(([experts, craftsmen, businesses]) => {
      setTopExperts(experts);
      setTopCraftsmen(craftsmen);
      setTopBusinesses(businesses);
    });
  }, []);

  useEffect(() => {
    if (!selectedResult) {
      setShowBookingModal(false);
    }
  }, [selectedResult]);

  // Top experts/business slideshow auto-rotate
  useEffect(() => {
    const t = setInterval(() => setTopSlideIndex((i) => (i + 1) % totalTopSlides), 5000);
    return () => clearInterval(t);
  }, [totalTopSlides]);

  const handleSearch = useCallback(async (qOverride?: string) => {
    setSearching(true);
    setHasSearched(true);
    try {
      const q = qOverride !== undefined ? qOverride : searchQuery;
      const params: {
        categoryId?: string;
        city?: string;
        area?: string;
        providerType?: string;
        q?: string;
        minRating?: number;
        minPrice?: number;
        maxPrice?: number;
        verifiedOnly?: boolean;
        sort?: string;
      } = {};
      if (categoryId) params.categoryId = categoryId;
      if (city) params.city = city;
      if (area) params.area = area;
      if (providerType) params.providerType = providerType;
      if (q.trim()) params.q = q.trim();
      if (minRating !== '' && minRating >= 1) params.minRating = minRating;
      if (minPrice !== '' && minPrice >= 0) params.minPrice = minPrice;
      if (maxPrice !== '' && maxPrice >= 0) params.maxPrice = maxPrice;
      if (verifiedOnly) params.verifiedOnly = true;
      if (sort) params.sort = sort;
      const data = await servicesApiClient.searchServices(params);
      const visibleItems = authUser ? data.items.filter((item) => item.providerId !== authUser.id) : data.items;
      setResults(dedupeById(visibleItems));
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [authUser, categoryId, city, area, providerType, searchQuery, minRating, minPrice, maxPrice, verifiedOnly, sort]);

  const isSearchTabActive =
    (authUser?.role === 'customer' && customerTab === 'browse') ||
    (authUser?.role === 'expert' && providerTab === 'search') ||
    (authUser?.role === 'craftsman' && providerTab === 'search') ||
    (authUser?.role === 'business' && providerTab === 'search');

  // Debounce text search input (400ms)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearchQuery(searchQuery), 400);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Run search on initial load and when filters or debounced query change (no button click needed)
  useEffect(() => {
    if (!isReady || !isSearchTabActive) return;
    void handleSearch(debouncedSearchQuery);
  }, [
    isReady,
    isSearchTabActive,
    handleSearch,
    debouncedSearchQuery,
    categoryId,
    city,
    area,
    providerType,
    minRating,
    minPrice,
    maxPrice,
    verifiedOnly,
    sort,
  ]);

  const d = dictionary.homeSearch;
  const commonDict = dictionary.common as Record<string, string | undefined>;
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
        <section className="home-top-slideshow" aria-label="Top providers">
          <div className="home-top-slideshow-panels">
            <div
              className={`home-top-slideshow-panel ${topSlideIndex === 0 ? 'home-top-slideshow-panel--active' : ''}`}
              role="tabpanel"
              aria-hidden={topSlideIndex !== 0}
            >
              <h2 className="home-section-title">{d.topExperts}</h2>
              <div className="home-top-cards-grid home-top-cards-grid--scroll">
                {topExperts.length > 0
                  ? topExperts.map((expert) => (
                      <div
                        key={expert.userId}
                        role="button"
                        tabIndex={0}
                        className="home-top-card home-top-card--large home-top-card--clickable"
                        onClick={() => openProfileModal(expert.userId, { displayName: expert.displayName, avatarUrl: expert.avatarUrl, role: 'expert' })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            openProfileModal(expert.userId, {
                              displayName: expert.displayName,
                              avatarUrl: expert.avatarUrl,
                              role: 'expert',
                            });
                          }
                        }}
                      >
                        <div className="home-top-avatar home-top-avatar--large">
                          <AvatarImage
                            src={expert.avatarUrl}
                            displayName={expert.displayName}
                            width={64}
                            height={64}
                            imageClassName="home-top-avatar-img"
                            fallbackClassName="home-top-avatar-fallback"
                          />
                        </div>
                        <p className="home-top-name">{expert.displayName}</p>
                        <p className="home-top-meta">
                          {expert.title ?? expert.headline ?? '—'}
                          {expert.specializations?.length
                            ? ` · ${expert.specializations.slice(0, 2).join(', ')}`
                            : ''}
                          {expert.city ? ` · ${expert.city}` : ''}
                        </p>
                      </div>
                    ))
                  : [1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="home-top-card home-top-card--large home-top-placeholder"
                      >
                        <div className="home-top-avatar home-top-avatar--large" />
                        <p className="home-top-name">{dictionary.common.comingSoon}</p>
                        <p className="home-top-meta">—</p>
                      </div>
                    ))}
              </div>
            </div>
            <div
              className={`home-top-slideshow-panel ${topSlideIndex === 1 ? 'home-top-slideshow-panel--active' : ''}`}
              role="tabpanel"
              aria-hidden={topSlideIndex !== 1}
            >
              <h2 className="home-section-title">{d.topCraftsmen}</h2>
              <div className="home-top-cards-grid home-top-cards-grid--scroll">
                {topCraftsmen.length > 0
                  ? topCraftsmen.map((craftsman) => (
                      <div
                        key={craftsman.userId}
                        role="button"
                        tabIndex={0}
                        className="home-top-card home-top-card--large home-top-card--clickable"
                        onClick={() =>
                          openProfileModal(craftsman.userId, {
                            displayName: craftsman.displayName,
                            avatarUrl: craftsman.avatarUrl,
                            role: 'craftsman',
                          })
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            openProfileModal(craftsman.userId, {
                              displayName: craftsman.displayName,
                              avatarUrl: craftsman.avatarUrl,
                              role: 'craftsman',
                            });
                          }
                        }}
                      >
                        <div className="home-top-avatar home-top-avatar--large">
                          <AvatarImage
                            src={craftsman.avatarUrl}
                            displayName={craftsman.displayName}
                            width={64}
                            height={64}
                            imageClassName="home-top-avatar-img"
                            fallbackClassName="home-top-avatar-fallback"
                          />
                        </div>
                        <p className="home-top-name">{craftsman.displayName}</p>
                        <p className="home-top-meta">
                          {craftsman.trade ?? craftsman.title ?? craftsman.headline ?? '—'}
                          {craftsman.specializations?.length
                            ? ` · ${craftsman.specializations.slice(0, 2).join(', ')}`
                            : ''}
                          {craftsman.city ? ` · ${craftsman.city}` : ''}
                        </p>
                      </div>
                    ))
                  : [1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="home-top-card home-top-card--large home-top-placeholder"
                      >
                        <div className="home-top-avatar home-top-avatar--large" />
                        <p className="home-top-name">{dictionary.common.comingSoon}</p>
                        <p className="home-top-meta">—</p>
                      </div>
                    ))}
              </div>
            </div>
            <div
              className={`home-top-slideshow-panel ${topSlideIndex === 2 ? 'home-top-slideshow-panel--active' : ''}`}
              role="tabpanel"
              aria-hidden={topSlideIndex !== 2}
            >
              <h2 className="home-section-title">{d.topBusinesses}</h2>
              <div className="home-top-cards-grid home-top-cards-grid--scroll">
                {topBusinesses.length > 0
                  ? topBusinesses.map((biz) => (
                      <div
                        key={biz.userId}
                        role="button"
                        tabIndex={0}
                        className="home-top-card home-top-card--large home-top-card--clickable"
                        onClick={() =>
                          openProfileModal(biz.userId, {
                            displayName: biz.companyName,
                            avatarUrl: biz.avatarUrl,
                            role: 'business',
                          })
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            openProfileModal(biz.userId, {
                              displayName: biz.companyName,
                              avatarUrl: biz.avatarUrl,
                              role: 'business',
                            });
                          }
                        }}
                      >
                        <div className="home-top-avatar home-top-avatar--large">
                          <AvatarImage
                            src={biz.avatarUrl}
                            displayName={biz.companyName}
                            width={64}
                            height={64}
                            imageClassName="home-top-avatar-img"
                            fallbackClassName="home-top-avatar-fallback"
                          />
                        </div>
                        <p className="home-top-name">{biz.companyName}</p>
                        <p className="home-top-meta">
                          {biz.industry ?? '—'}
                          {biz.city ? ` · ${biz.city}` : ''}
                        </p>
                      </div>
                    ))
                  : [1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="home-top-card home-top-card--large home-top-placeholder"
                      >
                        <div className="home-top-avatar home-top-avatar--large" />
                        <p className="home-top-name">{dictionary.common.comingSoon}</p>
                        <p className="home-top-meta">—</p>
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
              onClick={() =>
                setTopSlideIndex((i) => (i === 0 ? totalTopSlides - 1 : i - 1))
              }
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
                aria-label={d.topCraftsmen}
                aria-selected={topSlideIndex === 1}
                className="home-top-slideshow-dot"
                onClick={() => setTopSlideIndex(1)}
              />
              <button
                type="button"
                role="tab"
                aria-label={d.topBusinesses}
                aria-selected={topSlideIndex === 2}
                className="home-top-slideshow-dot"
                onClick={() => setTopSlideIndex(2)}
              />
            </div>
            <button
              type="button"
              className="home-top-slideshow-arrow home-top-slideshow-arrow--standalone"
              aria-label="Next slide"
              onClick={() => setTopSlideIndex((i) => (i + 1) % totalTopSlides)}
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
                        <option value="craftsman">{d.craftsman}</option>
                        <option value="business">{d.businessProvider}</option>
                      </select>
                    </div>
                    <div className="home-search-field">
                      <label className="home-search-label">{d.minRating ?? 'Min rating'}</label>
                      <select
                        className="home-search-select"
                        value={minRating === '' ? '' : String(minRating)}
                        onChange={(e) => setMinRating(e.target.value === '' ? '' : Number(e.target.value))}
                      >
                        <option value="">{d.any ?? 'Any'}</option>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {n}+ ★
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="home-search-field">
                      <label className="home-search-label">{d.minPrice ?? 'Min price'}</label>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="home-search-input"
                        placeholder="0"
                        value={minPrice === '' ? '' : minPrice}
                        onChange={(e) =>
                          setMinPrice(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)
                        }
                      />
                    </div>
                    <div className="home-search-field">
                      <label className="home-search-label">{d.maxPrice ?? 'Max price'}</label>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="home-search-input"
                        placeholder="—"
                        value={maxPrice === '' ? '' : maxPrice}
                        onChange={(e) =>
                          setMaxPrice(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)
                        }
                      />
                    </div>
                    <div className="home-search-field">
                      <label className="home-search-label">{d.sort ?? 'Sort by'}</label>
                      <select
                        className="home-search-select"
                        value={sort}
                        onChange={(e) => setSort(e.target.value)}
                      >
                        <option value="newest">{d.sortNewest ?? 'Newest'}</option>
                        <option value="rating">{d.sortRating ?? 'Rating'}</option>
                        <option value="price_asc">{d.sortPriceAsc ?? 'Price: low to high'}</option>
                        <option value="price_desc">{d.sortPriceDesc ?? 'Price: high to low'}</option>
                        <option value="completed_count">{d.sortPopular ?? 'Most orders'}</option>
                      </select>
                    </div>
                    <div className="home-search-field home-search-field--full" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <input
                        type="checkbox"
                        id="verified-only"
                        checked={verifiedOnly}
                        onChange={(e) => setVerifiedOnly(e.target.checked)}
                      />
                      <label htmlFor="verified-only" className="home-search-label" style={{ margin: 0 }}>
                        {d.verifiedOnly ?? 'Verified providers only'}
                      </label>
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
                          <div
                            key={r.id}
                            role="button"
                            tabIndex={0}
                            className="home-result-card"
                            onClick={() => setSelectedResult(r)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setSelectedResult(r);
                              }
                            }}
                          >
                            <span
                              className="home-result-avatar home-result-avatar--clickable"
                              onClick={(e) => {
                                e.stopPropagation();
                                openProfileModal(r.providerId, {
                                  displayName: r.providerName,
                                  avatarUrl: r.providerAvatar ?? null,
                                  role: r.providerRole,
                                });
                              }}
                            >
                              <AvatarImage
                                src={r.providerAvatar}
                                displayName={r.providerName}
                                width={48}
                                height={48}
                                imageClassName="home-result-avatar-img"
                                fallbackClassName="home-result-avatar-fallback"
                              />
                            </span>
                            <div className="home-result-info">
                              <p className="home-result-title">{r.title}</p>
                              <p className="home-result-provider">
                                {r.providerName}
                                {r.providerVerified && (
                                  <span className="home-result-badge" title={d.verified ?? 'Verified'}>
                                    {d.verified ?? '✓'}
                                  </span>
                                )}
                              </p>
                              <p className="home-result-meta">
                                {locale === 'ar' ? r.categoryNameAr : r.categoryNameEn}
                                {r.city && ` · ${r.city}`}
                                {r.avgRating != null && (
                                  <span> · {r.avgRating.toFixed(1)} ★{r.avgRating >= 4 ? ` · ${d.topRated ?? 'Top rated'}` : ''}</span>
                                )}
                              </p>
                              {r.price != null && (
                                <p className="home-result-price">
                    {r.price} {r.currency ?? 'EGP'}
                    {hourlyPricingEnabled && r.priceType === 'hourly' ? '/hr' : ''}
                                </p>
                              )}
                            </div>
                            {r.isFeatured && <span className="home-result-featured">★</span>}
                          </div>
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
        {/* Expert / Business Dashboard Tabs */}
        {(authUser.role === 'expert' ||
          authUser.role === 'craftsman' ||
          authUser.role === 'business') &&
          accessToken && (
          <>
            <div className="dashboard-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={providerTab === 'overview'}
                className={`dashboard-tab ${providerTab === 'overview' ? 'dashboard-tab--active' : ''}`}
                onClick={() => setProviderTab('overview')}
              >
                {commonDict.overview ?? 'Overview'}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={providerTab === 'search'}
                className={`dashboard-tab ${providerTab === 'search' ? 'dashboard-tab--active' : ''}`}
                onClick={() => setProviderTab('search')}
              >
                {d.search ?? 'Search Services'}
              </button>
            </div>

            {providerTab === 'overview' && (
              <>
                {(authUser.role === 'expert' || authUser.role === 'craftsman') && (
                  <ExpertDashboard
                    locale={locale}
                    dictionary={dictionary}
                    accessToken={accessToken}
                    categories={categories}
                    providerRole={authUser.role}
                  />
                )}
                {authUser.role === 'business' && (
                  <BusinessDashboard
                    locale={locale}
                    dictionary={dictionary}
                    accessToken={accessToken}
                    categories={categories}
                    verificationStatus={authUser.verificationStatus ?? 'unverified'}
                  />
                )}
              </>
            )}

            {providerTab === 'search' && (
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
                    <option value="craftsman">{d.craftsman}</option>
                    <option value="business">{d.businessProvider}</option>
                  </select>
                </div>
                <div className="home-search-field">
                  <label className="home-search-label">{d.minRating ?? 'Min rating'}</label>
                  <select
                    className="home-search-select"
                    value={minRating === '' ? '' : String(minRating)}
                    onChange={(e) => setMinRating(e.target.value === '' ? '' : Number(e.target.value))}
                  >
                    <option value="">{d.any ?? 'Any'}</option>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}+ ★
                      </option>
                    ))}
                  </select>
                </div>
                <div className="home-search-field">
                  <label className="home-search-label">{d.minPrice ?? 'Min price'}</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    className="home-search-input"
                    placeholder="0"
                    value={minPrice === '' ? '' : minPrice}
                    onChange={(e) =>
                      setMinPrice(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)
                    }
                  />
                </div>
                <div className="home-search-field">
                  <label className="home-search-label">{d.maxPrice ?? 'Max price'}</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    className="home-search-input"
                    placeholder="—"
                    value={maxPrice === '' ? '' : maxPrice}
                    onChange={(e) =>
                      setMaxPrice(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)
                    }
                  />
                </div>
                <div className="home-search-field">
                  <label className="home-search-label">{d.sort ?? 'Sort by'}</label>
                  <select
                    className="home-search-select"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="newest">{d.sortNewest ?? 'Newest'}</option>
                    <option value="rating">{d.sortRating ?? 'Rating'}</option>
                    <option value="price_asc">{d.sortPriceAsc ?? 'Price: low to high'}</option>
                    <option value="price_desc">{d.sortPriceDesc ?? 'Price: high to low'}</option>
                    <option value="completed_count">{d.sortPopular ?? 'Most orders'}</option>
                  </select>
                </div>
                <div className="home-search-field home-search-field--full" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    id="verified-only-provider"
                    checked={verifiedOnly}
                    onChange={(e) => setVerifiedOnly(e.target.checked)}
                  />
                  <label htmlFor="verified-only-provider" className="home-search-label" style={{ margin: 0 }}>
                    {d.verifiedOnly ?? 'Verified providers only'}
                  </label>
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
                      <div
                        key={r.id}
                        role="button"
                        tabIndex={0}
                        className="home-result-card"
                        onClick={() => setSelectedResult(r)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedResult(r);
                          }
                        }}
                      >
                        <div className="home-result-avatar">
                          <AvatarImage
                            src={r.providerAvatar}
                            displayName={r.providerName}
                            width={48}
                            height={48}
                            imageClassName="home-result-avatar-img"
                            fallbackClassName="home-result-avatar-fallback"
                          />
                        </div>
                        <div className="home-result-info">
                          <p className="home-result-title">{r.title}</p>
                          <p className="home-result-provider">
                            {r.providerName}
                            {r.providerVerified && (
                              <span className="home-result-badge" title={d.verified ?? 'Verified'}>
                                {d.verified ?? '✓'}
                              </span>
                            )}
                          </p>
                          <p className="home-result-meta">
                            {locale === 'ar' ? r.categoryNameAr : r.categoryNameEn}
                            {r.city && ` · ${r.city}`}
                            {r.avgRating != null && (
                              <span> · {r.avgRating.toFixed(1)} ★{r.avgRating >= 4 ? ` · ${d.topRated ?? 'Top rated'}` : ''}</span>
                            )}
                          </p>
                          {r.price != null && (
                            <p className="home-result-price">
                    {r.price} {r.currency ?? 'EGP'}
                    {hourlyPricingEnabled && r.priceType === 'hourly' ? '/hr' : ''}
                            </p>
                          )}
                        </div>
                        {r.isFeatured && <span className="home-result-featured">★</span>}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </>
    )}

        {/* Provider Detail Drawer - hidden when booking modal is open to avoid stacked overlays */}
        {selectedResult && !showBookingModal && (
          <div
            className="home-drawer-overlay"
            onClick={() => {
              setSelectedResult(null);
            }}
          >
            <div className="home-drawer" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="home-drawer-close"
                onClick={() => setSelectedResult(null)}
              >
                ×
              </button>
              <button
                type="button"
                className="home-drawer-avatar-wrap"
                onClick={() =>
                    openProfileModal(selectedResult.providerId, {
                      displayName: selectedResult.providerName,
                      avatarUrl: selectedResult.providerAvatar ?? null,
                      role: selectedResult.providerRole,
                    })
                }
              >
                <span className="home-drawer-avatar">
                  <AvatarImage
                    src={selectedResult.providerAvatar}
                    displayName={selectedResult.providerName}
                    width={80}
                    height={80}
                    imageClassName="home-drawer-avatar-img"
                    fallbackClassName="home-drawer-avatar-fallback"
                  />
                </span>
              </button>
              <h2 className="home-drawer-title">{selectedResult.title}</h2>
              <button
                type="button"
                className="home-drawer-provider-btn"
                onClick={() =>
                    openProfileModal(selectedResult.providerId, {
                      displayName: selectedResult.providerName,
                      avatarUrl: selectedResult.providerAvatar ?? null,
                      role: selectedResult.providerRole,
                    })
                }
              >
                {selectedResult.providerName}
              </button>
              <p className="home-drawer-role">{selectedResult.providerRole}</p>
              {selectedResult.price != null && (
                <p className="home-drawer-price">
                          {selectedResult.price} {selectedResult.currency ?? 'EGP'}{' '}
                  {hourlyPricingEnabled && selectedResult.priceType === 'hourly'
                    ? '/ hour'
                    : selectedResult.isNegotiable
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
              <div className="home-drawer-actions">
                <button
                  type="button"
                  className="dashboard-btn dashboard-btn--primary"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowBookingModal(true);
                  }}
                >
                  {dictionary.appHome?.requestService ?? 'Book'}
                </button>
              </div>
            </div>
          </div>
        )}

        {selectedResult && (
          <ServiceBookingModal
            open={showBookingModal}
            onClose={() => setShowBookingModal(false)}
            service={selectedResult}
            accessToken={accessToken ?? ''}
            locale={locale}
            dictionary={dictionary}
            onSuccess={() => {
              setShowBookingModal(false);
              setSelectedResult(null);
            }}
          />
        )}
      </Container>
    </main>
  );
};
