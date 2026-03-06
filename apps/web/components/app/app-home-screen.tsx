'use client';

import type { ServiceCategory, ServiceSearchResult, Wallet } from '@mohandishub/shared';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { WalletDepositModal } from './wallet-deposit-modal';

import { useAuth } from '@/components/auth/auth-provider';
import { Container } from '@/components/ui/container';
import { Skeleton, SkeletonCard, SkeletonText } from '@/components/ui/skeleton';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';
import { servicesApiClient } from '@/lib/services/client';
import { walletApiClient } from '@/lib/wallet/client';

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
  'Asyut',
  'Ismailia',
  'Fayyum',
  'Zagazig',
  'Aswan',
  'Damietta',
  'Damanhur',
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
    'Zamalek',
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
    'Montaza',
    'Smouha',
    'Sidi Gaber',
    'Sporting',
    'Miami',
    'Stanley',
    'Roushdy',
    'San Stefano',
    'Mansheya',
    'Bolkly',
    'Glim',
    'Mandara',
  ],
  Giza: [
    'Dokki',
    'Mohandessin',
    'Haram',
    'Faisal',
    '6th of October',
    'Sheikh Zayed',
    'Agouza',
    'Imbaba',
    'Bulaq',
  ],
  '6th of October': [
    'First District',
    'Second District',
    'Third District',
    'Fourth District',
    'Fifth District',
    'Sixth District',
  ],
  'New Cairo': [
    'First Settlement',
    'Second Settlement',
    'Third Settlement',
    'Fifth Settlement',
    'Rehab',
    'Badr',
  ],
  Obour: ['Obour City', 'Industrial Zone'],
  Luxor: ['East Bank', 'West Bank', 'Karnak', 'Luxor City'],
  Aswan: ['Aswan City', 'Elephantine', 'Kitchener Island'],
  'Sharm El Sheikh': ['Naama Bay', 'Hadaba', 'Old Sharm', 'Ras Mohammed'],
  Hurghada: ['Sakkala', 'Dahar', 'El Gouna', 'Makadi'],
  Mansoura: ['Downtown', 'Gamalia', 'New Mansoura'],
  Tanta: ['Downtown', 'Shibin El Kom Road'],
  Suez: ['Port Tawfiq', 'Arbaeen', 'Faisal'],
  'Port Said': ['Port Fouad', 'Downtown', 'Al Manakh'],
  Ismailia: ['Downtown', 'Nasr City', 'Canal'],
  Fayyum: ['Fayoum City', 'Tunis Village'],
  Zagazig: ['Downtown', 'University'],
  Damietta: ['Ras El Bar', 'Downtown'],
  Damanhur: ['Downtown', 'Industrial'],
  Minya: ['Downtown', 'New Minya'],
  'Beni Suef': ['Downtown', 'New Beni Suef'],
  Qena: ['Downtown', 'New Qena'],
  Sohag: ['Downtown', 'New Sohag'],
  'Shubra El Kheima': ['Downtown', 'Industrial'],
  Asyut: ['Downtown', 'New Asyut'],
};

export const AppHomeScreen = ({ locale, dictionary }: AppHomeScreenProps) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { authUser, accessToken, isAuthenticated, isReady, authGuard } = useAuth();

  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [city, setCity] = useState('');
  const [area, setArea] = useState('');
  const [providerType, setProviderType] = useState('');
  const [results, setResults] = useState<ServiceSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedResult, setSelectedResult] = useState<ServiceSearchResult | null>(null);

  const areaOptions = city ? (CITY_AREAS[city] ?? []) : [];
  const handleCityChange = (newCity: string) => {
    setCity(newCity);
    setArea('');
  };

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [showDeposit, setShowDeposit] = useState(false);
  const [stripeMessage, setStripeMessage] = useState<'success' | 'cancelled' | null>(null);

  useEffect(() => {
    const stripe = searchParams.get('stripe');
    if (stripe === 'success' || stripe === 'cancelled') {
      setStripeMessage(stripe);
      const url = new URL(window.location.href);
      url.searchParams.delete('stripe');
      window.history.replaceState({}, '', url.pathname + url.search);
      if (stripe === 'success' && accessToken) {
        void walletApiClient
          .getMyWallet(accessToken)
          .then(setWallet)
          .catch(() => {});
        let attempts = 0;
        const maxAttempts = 15;
        const pollInterval = setInterval(() => {
          attempts += 1;
          if (attempts > maxAttempts) {
            clearInterval(pollInterval);
            return;
          }
          void (async () => {
            try {
              const updated = await walletApiClient.getMyWallet(accessToken);
              setWallet(updated);
            } catch {
              // ignore
            }
          })();
        }, 2000);
        return () => clearInterval(pollInterval);
      }
    }
  }, [searchParams, accessToken]);

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
    if (accessToken) {
      void walletApiClient
        .getMyWallet(accessToken)
        .then(setWallet)
        .catch(() => {});
    }
  }, [accessToken]);

  const handleSearch = useCallback(async () => {
    setSearching(true);
    setHasSearched(true);
    try {
      const params: { categoryId?: string; city?: string; area?: string; providerType?: string } =
        {};
      if (categoryId) params.categoryId = categoryId;
      if (city) params.city = city;
      if (area) params.area = area;
      if (providerType) params.providerType = providerType;
      const data = await servicesApiClient.searchServices(params);
      setResults(data.items);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [categoryId, city, area, providerType]);

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

        {/* Welcome + Wallet */}
        <section className="home-welcome-section">
          <div className="home-welcome-row">
            <div>
              <h1 className="home-welcome">
                {d.welcomeBack}, {authUser.displayName}
              </h1>
            </div>
            {wallet && (
              <div className="home-balance-chip">
                <span className="home-balance-label">{dictionary.wallet.balance}</span>
                <span className="home-balance-amount">
                  {wallet.balance.toFixed(2)} {wallet.currency}
                </span>
                <button
                  type="button"
                  className="home-balance-add"
                  onClick={() => setShowDeposit(true)}
                  aria-label={dictionary.wallet.deposit}
                >
                  +
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Search Bar */}
        <section className="home-search-card">
          <div className="home-search-grid">
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

        {/* Top Providers (placeholder) */}
        <section className="home-top-section">
          <h2 className="home-section-title">{d.topExperts}</h2>
          <div className="home-top-scroll">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="home-top-card home-top-placeholder">
                <div className="home-top-avatar" />
                <p className="home-top-name">Coming Soon</p>
              </div>
            ))}
          </div>
        </section>

        <section className="home-top-section">
          <h2 className="home-section-title">{d.topBusinesses}</h2>
          <div className="home-top-scroll">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="home-top-card home-top-placeholder">
                <div className="home-top-avatar" />
                <p className="home-top-name">Coming Soon</p>
              </div>
            ))}
          </div>
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

        {/* Wallet Deposit Modal */}
        {showDeposit && (
          <WalletDepositModal
            dictionary={dictionary}
            accessToken={accessToken}
            onClose={() => setShowDeposit(false)}
            onDepositCreated={() => {
              if (accessToken)
                void walletApiClient
                  .getMyWallet(accessToken)
                  .then(setWallet)
                  .catch(() => {});
            }}
          />
        )}
      </Container>
    </main>
  );
};
