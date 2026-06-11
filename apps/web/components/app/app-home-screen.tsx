'use client';

import type { ServiceCategory, ServiceSearchResult } from '@mohandishub/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { AdSlideshow } from './ad-slideshow';
import { BusinessDashboard } from './business-dashboard';
import { CustomerDashboard } from './customer-dashboard';
import { ExpertDashboard } from './expert-dashboard';
import { NegotiationModal } from './negotiation-modal';
import { useProfileModal } from './profile-modal-context';
import { ServiceBookingModal } from './service-booking-modal';

import { useAppStatus } from '@/components/app-status-provider';
import { useAuth } from '@/components/auth/auth-provider';
import { AvatarImage } from '@/components/ui/avatar-image';
import { Container } from '@/components/ui/container';
import { ImagePreviewModal } from '@/components/ui/image-preview-modal';
import { Skeleton, SkeletonCard, SkeletonText } from '@/components/ui/skeleton';
import { resolvePublicAssetUrl, toAbsoluteAssetUrl } from '@/lib/asset-url';
import { EGYPTIAN_CITIES } from '@/lib/data/egyptian-cities';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';
import type { Bid, Need } from '@/lib/needs/client';
import { needsApiClient } from '@/lib/needs/client';
import type { TopBusiness, TopCraftsman, TopExpert } from '@/lib/profiles/client';
import { profilesApiClient } from '@/lib/profiles/client';
import { servicesApiClient } from '@/lib/services/client';

import '@/app/dashboard.css';

type AppHomeScreenProps = {
  locale: Locale;
  dictionary: Dictionary;
};

/** Max cards per top-providers slideshow slide (must match API home limit). */
const TOP_HOME_SLIDE_LIMIT = 3;

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
  Damietta: [
    'Ras El Bar',
    'New Damietta',
    'Damietta Port',
    'Ezbet El Borg',
    'Faraskur',
    'Kafr Saad',
  ],
  Damanhur: ['Downtown', 'Shubra', 'Abu Rish', 'Nadi Area', 'Industrial'],
  'Kafr El Sheikh': ['Downtown', 'Sidi Salem', 'Desouk', 'Baltim', 'Motobas', 'Biyala', 'Hamoul'],
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
  const [businessSearchMode, setBusinessSearchMode] = useState<'services' | 'needs'>('needs');
  const [businessOpenNeeds, setBusinessOpenNeeds] = useState<Need[]>([]);
  const [businessMyBids, setBusinessMyBids] = useState<Bid[]>([]);
  const [businessNeedsLoading, setBusinessNeedsLoading] = useState(false);
  const [businessNeedsMinBudget, setBusinessNeedsMinBudget] = useState<number | ''>('');
  const [businessNeedsMaxBudget, setBusinessNeedsMaxBudget] = useState<number | ''>('');
  const [businessNeedsSort, setBusinessNeedsSort] = useState<
    'newest' | 'budget_asc' | 'budget_desc'
  >('newest');
  const [businessBidNeed, setBusinessBidNeed] = useState<Pick<
    Need,
    'id' | 'title' | 'budget_type'
  > | null>(null);
  const [businessEditingBid, setBusinessEditingBid] = useState<Bid | null>(null);
  const [businessBidAmountInput, setBusinessBidAmountInput] = useState('');
  const [businessBidError, setBusinessBidError] = useState<string | null>(null);
  const [businessBidding, setBusinessBidding] = useState(false);
  const [topSlideIndex, setTopSlideIndex] = useState(0);
  const [topExperts, setTopExperts] = useState<TopExpert[]>([]);
  const [topCraftsmen, setTopCraftsmen] = useState<TopCraftsman[]>([]);
  const [topBusinesses, setTopBusinesses] = useState<TopBusiness[]>([]);
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [showNegotiationModal, setShowNegotiationModal] = useState(false);
  const [bookingNegotiationId, setBookingNegotiationId] = useState<string | null>(null);
  const [bookingAgreedPrice, setBookingAgreedPrice] = useState<number | null>(null);
  const [previewServiceImage, setPreviewServiceImage] = useState<string | null>(null);
  const [selectedBusinessNeed, setSelectedBusinessNeed] = useState<Need | null>(null);
  const [selectedNeedBids, setSelectedNeedBids] = useState<Bid[]>([]);
  const [selectedNeedBidsLoading, setSelectedNeedBidsLoading] = useState(false);
  const [selectedNeedBidsError, setSelectedNeedBidsError] = useState<string | null>(null);
  const totalTopSlides = 3;

  const areaOptions = city ? (CITY_AREAS[city] ?? []) : [];
  const handleCityChange = (newCity: string) => {
    setCity(newCity);
    setArea('');
  };

  const getNeedMediaUrls = useCallback((referenceUrl: string | null | undefined): string[] => {
    if (!referenceUrl || !referenceUrl.trim()) return [];
    const t = referenceUrl.trim();
    if (t.startsWith('[')) {
      try {
        const arr = JSON.parse(t) as unknown;
        return Array.isArray(arr) ? arr.filter((u): u is string => typeof u === 'string') : [];
      } catch {
        return [t];
      }
    }
    return [t];
  }, []);

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
      setTopExperts(experts.slice(0, TOP_HOME_SLIDE_LIMIT));
      setTopCraftsmen(craftsmen.slice(0, TOP_HOME_SLIDE_LIMIT));
      setTopBusinesses(businesses.slice(0, TOP_HOME_SLIDE_LIMIT));
    });
  }, []);

  useEffect(() => {
    if (!selectedResult) {
      setShowBookingModal(false);
      setShowNegotiationModal(false);
      setBookingNegotiationId(null);
      setBookingAgreedPrice(null);
      setPreviewServiceImage(null);
    }
  }, [selectedResult]);

  useEffect(() => {
    if (!selectedBusinessNeed || !accessToken) {
      setSelectedNeedBids([]);
      setSelectedNeedBidsLoading(false);
      setSelectedNeedBidsError(null);
      return;
    }
    if (authUser?.role === 'business') {
      setSelectedNeedBids([]);
      setSelectedNeedBidsLoading(false);
      setSelectedNeedBidsError(
        dictionary.needs?.bidsUnavailableForRole ??
          'Bidder details are not available for this account type.',
      );
      return;
    }
    let active = true;
    setSelectedNeedBidsLoading(true);
    setSelectedNeedBidsError(null);
    void needsApiClient
      .listBidsForNeed(accessToken, selectedBusinessNeed.id)
      .then((bids) => {
        if (!active) return;
        setSelectedNeedBids(bids);
      })
      .catch(() => {
        if (!active) return;
        setSelectedNeedBids([]);
        setSelectedNeedBidsError(
          dictionary.needs?.bidsUnavailable ?? 'Bids are not available for this need right now.',
        );
      })
      .finally(() => {
        if (!active) return;
        setSelectedNeedBidsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    selectedBusinessNeed,
    accessToken,
    authUser?.role,
    dictionary.needs?.bidsUnavailable,
    dictionary.needs?.bidsUnavailableForRole,
  ]);

  // Top experts/business slideshow auto-rotate
  useEffect(() => {
    const t = setInterval(() => setTopSlideIndex((i) => (i + 1) % totalTopSlides), 5000);
    return () => clearInterval(t);
  }, [totalTopSlides]);

  const handleSearch = useCallback(
    async (qOverride?: string) => {
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
        const visibleItems = authUser
          ? data.items.filter((item) => item.providerId !== authUser.id)
          : data.items;
        const withImages = visibleItems.map((item) => ({
          ...item,
          images: Array.isArray(item.images) ? item.images : [],
        }));
        setResults(dedupeById(withImages));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [
      authUser,
      categoryId,
      city,
      area,
      providerType,
      searchQuery,
      minRating,
      minPrice,
      maxPrice,
      verifiedOnly,
      sort,
    ],
  );

  const loadBusinessNeeds = useCallback(async () => {
    if (!accessToken || authUser?.role !== 'business') return;
    setBusinessNeedsLoading(true);
    setHasSearched(true);
    try {
      const needsData = await needsApiClient.listOpenNeeds(accessToken, 1);
      setBusinessOpenNeeds(needsData.rows);
      // API may still forbid /api/bids/my for business in current backend deployment.
      // Keep UI functional without triggering forbidden requests.
      setBusinessMyBids([]);
    } catch {
      setBusinessOpenNeeds([]);
      setBusinessMyBids([]);
    } finally {
      setBusinessNeedsLoading(false);
    }
  }, [accessToken, authUser?.role]);

  const handleBusinessSearchModeChange = useCallback((checked: boolean) => {
    const nextMode: 'services' | 'needs' = checked ? 'needs' : 'services';
    setBusinessSearchMode(nextMode);
    if (nextMode === 'needs') {
      // Reset carry-over service filters so needs are visible immediately on switch.
      setSearchQuery('');
      setCategoryId('');
      setCity('');
      setArea('');
      setProviderType('');
      setMinRating('');
      setMinPrice('');
      setMaxPrice('');
      setVerifiedOnly(false);
      setSort('newest');
      setBusinessNeedsMinBudget('');
      setBusinessNeedsMaxBudget('');
      setBusinessNeedsSort('newest');
    }
  }, []);

  const handleBusinessBid = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!accessToken || (!businessBidNeed && !businessEditingBid)) return;
      setBusinessBidding(true);
      setBusinessBidError(null);
      const form = e.currentTarget;
      try {
        const amountRaw = (form.elements.namedItem('amount') as HTMLInputElement).value;
        const amount = Number.parseFloat(amountRaw);
        const message = (form.elements.namedItem('message') as HTMLTextAreaElement).value.trim();
        if (!Number.isFinite(amount) || amount < 1) {
          setBusinessBidError('Please enter a valid bid amount (at least 1).');
          return;
        }
        if (message.length < 5) {
          setBusinessBidError('Please enter at least 5 characters in your proposal.');
          return;
        }
        const payload: {
          amount: number;
          message: string;
          deliveryDays?: number;
          estimatedHours?: number;
        } = {
          amount,
          message,
        };
        if (businessBidNeed?.budget_type === 'hourly') {
          const estimatedHours = parseInt(
            (form.elements.namedItem('estimatedHours') as HTMLInputElement)?.value || '',
            10,
          );
          if (Number.isInteger(estimatedHours) && estimatedHours > 0) {
            payload.estimatedHours = estimatedHours;
          }
        } else {
          const deliveryDays = parseInt(
            (form.elements.namedItem('deliveryDays') as HTMLInputElement)?.value || '',
            10,
          );
          if (Number.isInteger(deliveryDays) && deliveryDays > 0 && deliveryDays <= 365) {
            payload.deliveryDays = deliveryDays;
          }
        }
        if (businessEditingBid) {
          await needsApiClient.updateBid(
            accessToken,
            businessEditingBid.need_id,
            businessEditingBid.id,
            payload,
          );
        } else if (businessBidNeed) {
          await needsApiClient.createBid(accessToken, businessBidNeed.id, payload);
        }
        setBusinessBidNeed(null);
        setBusinessEditingBid(null);
        setBusinessBidAmountInput('');
        await loadBusinessNeeds();
      } catch (err) {
        const e = err as Error & { status?: number };
        if (e?.status === 403) {
          setBusinessBidError(
            'Your account is currently not allowed to place bids in this environment. Please contact support/admin to enable business bidding on the API.',
          );
        } else {
          setBusinessBidError(err instanceof Error ? err.message : 'Failed to submit bid');
        }
      } finally {
        setBusinessBidding(false);
      }
    },
    [accessToken, businessBidNeed, businessEditingBid, loadBusinessNeeds],
  );

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
    if (
      authUser?.role === 'business' &&
      providerTab === 'search' &&
      businessSearchMode === 'needs'
    ) {
      void loadBusinessNeeds();
      return;
    }
    void handleSearch(debouncedSearchQuery);
  }, [
    isReady,
    isSearchTabActive,
    authUser?.role,
    providerTab,
    businessSearchMode,
    loadBusinessNeeds,
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
  const businessSearchControlsAlign = locale === 'ar' ? 'flex-start' : 'flex-end';

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

        {accessToken && (
          <AdSlideshow
            locale={locale}
            dictionary={dictionary}
            accessToken={accessToken}
            role={authUser.role}
          />
        )}

        {/* Top Experts / Top Businesses slideshow — arrows, dots below, scrollable cards */}
        <section className="home-top-slideshow" aria-label="Top providers">
          <div className="home-top-slideshow-panels">
            <div
              id="top-slide-experts-panel"
              className={`home-top-slideshow-panel ${topSlideIndex === 0 ? 'home-top-slideshow-panel--active' : ''}`}
              role="tabpanel"
              aria-labelledby="top-slide-experts-tab"
              aria-hidden={topSlideIndex !== 0}
            >
              <h2 className="home-section-title">{d.topExperts}</h2>
              <div className="home-top-cards-grid home-top-cards-grid--scroll">
                {topExperts.length > 0
                  ? topExperts.slice(0, TOP_HOME_SLIDE_LIMIT).map((expert) => (
                      <div
                        key={expert.userId}
                        role="button"
                        tabIndex={0}
                        className="home-top-card home-top-card--large home-top-card--clickable"
                        onClick={() =>
                          openProfileModal(expert.userId, {
                            displayName: expert.displayName,
                            avatarUrl: expert.avatarUrl,
                            role: 'expert',
                          })
                        }
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
                        <p className="home-top-name">{d.noResults}</p>
                        <p className="home-top-meta">—</p>
                      </div>
                    ))}
              </div>
            </div>
            <div
              id="top-slide-craftsmen-panel"
              className={`home-top-slideshow-panel ${topSlideIndex === 1 ? 'home-top-slideshow-panel--active' : ''}`}
              role="tabpanel"
              aria-labelledby="top-slide-craftsmen-tab"
              aria-hidden={topSlideIndex !== 1}
            >
              <h2 className="home-section-title">{d.topCraftsmen}</h2>
              <div className="home-top-cards-grid home-top-cards-grid--scroll">
                {topCraftsmen.length > 0
                  ? topCraftsmen.slice(0, TOP_HOME_SLIDE_LIMIT).map((craftsman) => (
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
                        <p className="home-top-name">{d.noResults}</p>
                        <p className="home-top-meta">—</p>
                      </div>
                    ))}
              </div>
            </div>
            <div
              id="top-slide-businesses-panel"
              className={`home-top-slideshow-panel ${topSlideIndex === 2 ? 'home-top-slideshow-panel--active' : ''}`}
              role="tabpanel"
              aria-labelledby="top-slide-businesses-tab"
              aria-hidden={topSlideIndex !== 2}
            >
              <h2 className="home-section-title">{d.topBusinesses}</h2>
              <div className="home-top-cards-grid home-top-cards-grid--scroll">
                {topBusinesses.length > 0
                  ? topBusinesses.slice(0, TOP_HOME_SLIDE_LIMIT).map((biz) => (
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
                        <p className="home-top-name">{d.noResults}</p>
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
              onClick={() => setTopSlideIndex((i) => (i === 0 ? totalTopSlides - 1 : i - 1))}
            >
              ‹
            </button>
            <div className="home-top-slideshow-dots" role="tablist">
              <button
                id="top-slide-experts-tab"
                type="button"
                role="tab"
                aria-label={d.topExperts}
                aria-selected={topSlideIndex === 0}
                aria-controls="top-slide-experts-panel"
                className="home-top-slideshow-dot"
                onClick={() => setTopSlideIndex(0)}
              />
              <button
                id="top-slide-craftsmen-tab"
                type="button"
                role="tab"
                aria-label={d.topCraftsmen}
                aria-selected={topSlideIndex === 1}
                aria-controls="top-slide-craftsmen-panel"
                className="home-top-slideshow-dot"
                onClick={() => setTopSlideIndex(1)}
              />
              <button
                id="top-slide-businesses-tab"
                type="button"
                role="tab"
                aria-label={d.topBusinesses}
                aria-selected={topSlideIndex === 2}
                aria-controls="top-slide-businesses-panel"
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
                id="customer-browse-tab"
                type="button"
                role="tab"
                aria-selected={customerTab === 'browse'}
                aria-controls="customer-browse-panel"
                className={`dashboard-tab ${customerTab === 'browse' ? 'dashboard-tab--active' : ''}`}
                onClick={() => setCustomerTab('browse')}
              >
                {d.browseTab}
              </button>
              <button
                id="customer-posted-tab"
                type="button"
                role="tab"
                aria-selected={customerTab === 'posted'}
                aria-controls="customer-posted-panel"
                className={`dashboard-tab ${customerTab === 'posted' ? 'dashboard-tab--active' : ''}`}
                onClick={() => setCustomerTab('posted')}
              >
                {d.postedTab}
              </button>
            </div>

            {customerTab === 'browse' && (
              <div id="customer-browse-panel" role="tabpanel" aria-labelledby="customer-browse-tab">
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
                        <option value="">
                          {areaOptions.length ? d.chooseArea : d.areaPlaceholder}
                        </option>
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
                        onChange={(e) =>
                          setMinRating(e.target.value === '' ? '' : Number(e.target.value))
                        }
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
                        <option value="price_desc">
                          {d.sortPriceDesc ?? 'Price: high to low'}
                        </option>
                        <option value="completed_count">{d.sortPopular ?? 'Most orders'}</option>
                      </select>
                    </div>
                    <div
                      className="home-search-field home-search-field--full"
                      style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                    >
                      <input
                        type="checkbox"
                        id="verified-only"
                        checked={verifiedOnly}
                        onChange={(e) => setVerifiedOnly(e.target.checked)}
                      />
                      <label
                        htmlFor="verified-only"
                        className="home-search-label"
                        style={{ margin: 0 }}
                      >
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
                            {r.images?.[0] ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={toAbsoluteAssetUrl(r.images[0])}
                                alt=""
                                className="home-result-service-thumb"
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : null}
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
                                  <span
                                    className="home-result-badge"
                                    title={d.verified ?? 'Verified'}
                                  >
                                    {d.verified ?? '✓'}
                                  </span>
                                )}
                              </p>
                              <p className="home-result-meta">
                                {locale === 'ar' ? r.categoryNameAr : r.categoryNameEn}
                                {r.city && ` · ${r.city}`}
                                {r.avgRating != null && (
                                  <span>
                                    {' '}
                                    · {r.avgRating.toFixed(1)} ★
                                    {r.avgRating >= 4 ? ` · ${d.topRated ?? 'Top rated'}` : ''}
                                  </span>
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
              </div>
            )}

            {customerTab === 'posted' && (
              <div id="customer-posted-panel" role="tabpanel" aria-labelledby="customer-posted-tab">
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
              </div>
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
                  id="provider-overview-tab"
                  type="button"
                  role="tab"
                  aria-selected={providerTab === 'overview'}
                  aria-controls="provider-overview-panel"
                  className={`dashboard-tab ${providerTab === 'overview' ? 'dashboard-tab--active' : ''}`}
                  onClick={() => setProviderTab('overview')}
                >
                  {commonDict.overview ?? 'Overview'}
                </button>
                <button
                  id="provider-search-tab"
                  type="button"
                  role="tab"
                  aria-selected={providerTab === 'search'}
                  aria-controls="provider-search-panel"
                  className={`dashboard-tab ${providerTab === 'search' ? 'dashboard-tab--active' : ''}`}
                  onClick={() => setProviderTab('search')}
                >
                  {d.search ?? 'Search Services'}
                </button>
              </div>

              {providerTab === 'overview' && (
                <div
                  id="provider-overview-panel"
                  role="tabpanel"
                  aria-labelledby="provider-overview-tab"
                >
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
                </div>
              )}

              {providerTab === 'search' && (
                <div
                  id="provider-search-panel"
                  role="tabpanel"
                  aria-labelledby="provider-search-tab"
                >
                  <section className="home-search-card">
                    <div className="home-search-grid home-search-grid--4-cols">
                      <div className="home-search-field home-search-field--full">
                        <label className="home-search-label">{d.search}</label>
                        <input
                          type="search"
                          className="home-search-input"
                          placeholder={
                            authUser.role === 'business' && businessSearchMode === 'needs'
                              ? (dictionary.needs?.searchNeedsPlaceholder ??
                                'Search by title, description, or category')
                              : d.searchPlaceholder
                          }
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
                          <option value="">
                            {areaOptions.length ? d.chooseArea : d.areaPlaceholder}
                          </option>
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
                          onChange={(e) =>
                            setMinRating(e.target.value === '' ? '' : Number(e.target.value))
                          }
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
                          value={
                            authUser.role === 'business' && businessSearchMode === 'needs'
                              ? businessNeedsMinBudget === ''
                                ? ''
                                : businessNeedsMinBudget
                              : minPrice === ''
                                ? ''
                                : minPrice
                          }
                          onChange={(e) => {
                            const val =
                              e.target.value === '' ? '' : parseFloat(e.target.value) || 0;
                            if (authUser.role === 'business' && businessSearchMode === 'needs') {
                              setBusinessNeedsMinBudget(val);
                            } else {
                              setMinPrice(val);
                            }
                          }}
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
                          value={
                            authUser.role === 'business' && businessSearchMode === 'needs'
                              ? businessNeedsMaxBudget === ''
                                ? ''
                                : businessNeedsMaxBudget
                              : maxPrice === ''
                                ? ''
                                : maxPrice
                          }
                          onChange={(e) => {
                            const val =
                              e.target.value === '' ? '' : parseFloat(e.target.value) || 0;
                            if (authUser.role === 'business' && businessSearchMode === 'needs') {
                              setBusinessNeedsMaxBudget(val);
                            } else {
                              setMaxPrice(val);
                            }
                          }}
                        />
                      </div>
                      <div className="home-search-field">
                        <label className="home-search-label">{d.sort ?? 'Sort by'}</label>
                        <select
                          className="home-search-select"
                          value={
                            authUser.role === 'business' && businessSearchMode === 'needs'
                              ? businessNeedsSort
                              : sort
                          }
                          onChange={(e) => {
                            if (authUser.role === 'business' && businessSearchMode === 'needs') {
                              setBusinessNeedsSort(
                                e.target.value as 'newest' | 'budget_asc' | 'budget_desc',
                              );
                            } else {
                              setSort(e.target.value);
                            }
                          }}
                        >
                          <option value="newest">{d.sortNewest ?? 'Newest'}</option>
                          <option value="rating">{d.sortRating ?? 'Rating'}</option>
                          <option value="price_asc">
                            {d.sortPriceAsc ?? 'Price: low to high'}
                          </option>
                          <option value="price_desc">
                            {d.sortPriceDesc ?? 'Price: high to low'}
                          </option>
                          <option value="completed_count">{d.sortPopular ?? 'Most orders'}</option>
                        </select>
                      </div>
                      <div
                        className="home-search-field home-search-field--full home-search-controls-row"
                        style={{ justifyContent: businessSearchControlsAlign }}
                      >
                        <input
                          type="checkbox"
                          id="verified-only-provider"
                          checked={verifiedOnly}
                          onChange={(e) => setVerifiedOnly(e.target.checked)}
                        />
                        <label
                          htmlFor="verified-only-provider"
                          className="home-search-label"
                          style={{ margin: 0 }}
                        >
                          {d.verifiedOnly ?? 'Verified providers only'}
                        </label>
                        {authUser.role === 'business' && (
                          <>
                            <span className="home-search-label" style={{ margin: 0 }}>
                              {dictionary.common.services ?? 'Service'}
                            </span>
                            <label
                              htmlFor="business-search-mode-toggle"
                              className="home-toggle-switch"
                            >
                              <input
                                id="business-search-mode-toggle"
                                type="checkbox"
                                className="home-toggle-switch-input"
                                checked={businessSearchMode === 'needs'}
                                onChange={(e) => handleBusinessSearchModeChange(e.target.checked)}
                                aria-label="Toggle search mode between services and customer needs"
                              />
                              <span className="home-toggle-switch-track" aria-hidden="true">
                                <span className="home-toggle-switch-knob" />
                              </span>
                            </label>
                            <span className="home-search-label" style={{ margin: 0 }}>
                              {dictionary.needs?.customerNeeds ?? 'Customer Need'}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="home-search-btn"
                      onClick={() =>
                        void (authUser.role === 'business' && businessSearchMode === 'needs'
                          ? loadBusinessNeeds()
                          : handleSearch())
                      }
                      disabled={searching || businessNeedsLoading}
                    >
                      {searching || businessNeedsLoading ? dictionary.admin.loading : d.search}
                    </button>
                  </section>

                  {hasSearched && (
                    <section className="home-results-section">
                      <h2 className="home-section-title">
                        {d.results} (
                        {authUser.role === 'business' && businessSearchMode === 'needs'
                          ? businessOpenNeeds.length
                          : results.length}
                        )
                      </h2>
                      {authUser.role === 'business' && businessSearchMode === 'needs' ? (
                        businessNeedsLoading ? (
                          <p className="home-empty">{dictionary.admin.loading ?? 'Loading...'}</p>
                        ) : businessOpenNeeds.length === 0 ? (
                          <p className="home-empty">
                            {dictionary.needs?.noOpenNeeds ?? 'No open needs at the moment.'}
                          </p>
                        ) : (
                          <div className="home-results-grid">
                            {businessOpenNeeds.map((need) => {
                              const existingBid = businessMyBids.find((b) => b.need_id === need.id);
                              const mediaUrls = getNeedMediaUrls(need.reference_url);
                              const location = [need.city, need.country].filter(Boolean).join(', ');
                              const postedDate = need.created_at
                                ? new Date(need.created_at).toLocaleDateString(
                                    locale === 'ar' ? 'ar-EG' : 'en-US',
                                  )
                                : null;
                              const bidsCount = Number(need.bid_count ?? 0);
                              return (
                                <div key={need.id} className="home-result-card home-need-card">
                                  <div className="home-result-info home-need-card__info">
                                    <p className="home-result-title">{need.title}</p>
                                    <p className="home-result-meta">
                                      {need.description.slice(0, 220)}
                                      {need.description.length > 220 ? '...' : ''}
                                    </p>
                                    <p className="home-result-meta">
                                      {parseFloat(need.budget_amount).toFixed(2)} {need.currency}
                                      {` · ${need.budget_type === 'hourly' ? 'Hourly' : 'Fixed'}`}
                                      {need.timeline_days ? ` - ${need.timeline_days} days` : ''}
                                    </p>
                                    {(need.category_name_en || need.category_name_ar) && (
                                      <p className="home-result-meta">
                                        {dictionary.common.category ?? 'Category'}:{' '}
                                        {locale === 'ar'
                                          ? need.category_name_ar
                                          : need.category_name_en}
                                      </p>
                                    )}
                                    {location && (
                                      <p className="home-result-meta">
                                        {dictionary.common.location ?? 'Location'}: {location}
                                      </p>
                                    )}
                                    <p className="home-result-meta">
                                      {dictionary.needs?.postedBy ?? 'By'}: {need.customer_name}
                                      {postedDate
                                        ? ` · ${dictionary.common.date ?? 'Date'}: ${postedDate}`
                                        : ''}
                                    </p>
                                    <p className="home-result-meta">
                                      {dictionary.needs?.bids ?? 'Bids'}:{' '}
                                      {Number.isFinite(bidsCount) ? bidsCount : 0}
                                      {` · ${dictionary.common.media ?? 'Media'}: ${mediaUrls.length}`}
                                    </p>
                                    {mediaUrls.length > 0 && (
                                      <div className="home-need-card__media">
                                        {mediaUrls.slice(0, 3).map((url, idx) => {
                                          const full = resolvePublicAssetUrl(url) ?? url;
                                          const isImage =
                                            /\.(jpe?g|png|webp|gif)$/i.test(url) ||
                                            url.includes('/uploads/');
                                          if (!isImage) {
                                            return (
                                              <a
                                                key={`${need.id}-file-${idx}`}
                                                href={full}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="home-need-card__file"
                                              >
                                                File
                                              </a>
                                            );
                                          }
                                          return (
                                            <button
                                              key={`${need.id}-img-${idx}`}
                                              type="button"
                                              className="home-need-card__thumb"
                                              onClick={() => setPreviewServiceImage(full)}
                                            >
                                              {/* eslint-disable-next-line @next/next/no-img-element */}
                                              <img src={full} alt="" />
                                            </button>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                  <div className="home-need-card__actions">
                                    <button
                                      type="button"
                                      className="dashboard-link-btn"
                                      onClick={() => setSelectedBusinessNeed(need)}
                                    >
                                      {dictionary.common.viewDetails ?? 'View details'}
                                    </button>
                                    {existingBid ? (
                                      <button
                                        type="button"
                                        className="dashboard-btn dashboard-btn--secondary dashboard-btn--small"
                                        onClick={() => {
                                          setBusinessEditingBid(existingBid);
                                          setBusinessBidNeed(need);
                                          setBusinessBidAmountInput(existingBid.amount);
                                          setBusinessBidError(null);
                                        }}
                                        disabled={existingBid.status !== 'pending'}
                                      >
                                        Edit Bid
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        className="dashboard-primary-btn dashboard-primary-btn--small"
                                        onClick={() => {
                                          setBusinessEditingBid(null);
                                          setBusinessBidNeed(need);
                                          setBusinessBidAmountInput('');
                                          setBusinessBidError(null);
                                        }}
                                      >
                                        {dictionary.needs?.placeBid ?? 'Place Bid'}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )
                      ) : results.length === 0 ? (
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
                              {r.images?.[0] ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={toAbsoluteAssetUrl(r.images[0])}
                                  alt=""
                                  className="home-result-service-thumb"
                                  onClick={(e) => e.stopPropagation()}
                                />
                              ) : null}
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
                                    <span
                                      className="home-result-badge"
                                      title={d.verified ?? 'Verified'}
                                    >
                                      {d.verified ?? '✓'}
                                    </span>
                                  )}
                                </p>
                                <p className="home-result-meta">
                                  {locale === 'ar' ? r.categoryNameAr : r.categoryNameEn}
                                  {r.city && ` · ${r.city}`}
                                  {r.avgRating != null && (
                                    <span>
                                      {' '}
                                      · {r.avgRating.toFixed(1)} ★
                                      {r.avgRating >= 4 ? ` · ${d.topRated ?? 'Top rated'}` : ''}
                                    </span>
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
                </div>
              )}
            </>
          )}

        {/* Provider Detail Drawer - hidden when booking modal is open to avoid stacked overlays */}
        {selectedResult && !showBookingModal && !showNegotiationModal && (
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
              {(selectedResult.images ?? []).length > 0 ? (
                <div className="home-drawer-gallery">
                  {(selectedResult.images ?? []).map((u) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={u}
                      src={toAbsoluteAssetUrl(u)}
                      alt=""
                      onClick={(e) => {
                        e.stopPropagation();
                        setPreviewServiceImage(toAbsoluteAssetUrl(u));
                      }}
                    />
                  ))}
                </div>
              ) : null}
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
              <div className="home-drawer-actions home-drawer-actions--split">
                {selectedResult.isNegotiable && authUser?.role === 'customer' ? (
                  <button
                    type="button"
                    className="dashboard-btn dashboard-btn--secondary"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowNegotiationModal(true);
                    }}
                  >
                    {(dictionary as { negotiation?: { negotiatePrice?: string } }).negotiation
                      ?.negotiatePrice ?? 'Negotiate price'}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="dashboard-btn dashboard-btn--primary"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setBookingNegotiationId(null);
                    setBookingAgreedPrice(null);
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
            onClose={() => {
              setShowBookingModal(false);
              setBookingNegotiationId(null);
              setBookingAgreedPrice(null);
            }}
            service={selectedResult}
            accessToken={accessToken ?? ''}
            locale={locale}
            dictionary={dictionary}
            {...(bookingNegotiationId ? { negotiationId: bookingNegotiationId } : {})}
            {...(bookingAgreedPrice != null ? { agreedServicePrice: bookingAgreedPrice } : {})}
            onSuccess={() => {
              setShowBookingModal(false);
              setBookingNegotiationId(null);
              setBookingAgreedPrice(null);
              setSelectedResult(null);
            }}
          />
        )}
        {selectedResult && authUser?.role === 'customer' && (
          <NegotiationModal
            open={showNegotiationModal}
            onClose={() => setShowNegotiationModal(false)}
            service={selectedResult}
            accessToken={accessToken ?? ''}
            locale={locale}
            dictionary={dictionary}
            onBookWithAgreedPrice={(negotiationId, agreedPrice) => {
              setBookingNegotiationId(negotiationId);
              setBookingAgreedPrice(agreedPrice);
              setShowNegotiationModal(false);
              setShowBookingModal(true);
            }}
          />
        )}
        {previewServiceImage && (
          <ImagePreviewModal
            imageUrl={previewServiceImage}
            onClose={() => setPreviewServiceImage(null)}
            accessToken={accessToken}
          />
        )}
        {selectedBusinessNeed && (
          <div className="plan-modal-overlay" onClick={() => setSelectedBusinessNeed(null)}>
            <div
              className="plan-modal"
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: 640 }}
            >
              <h3 className="plan-modal-title">{selectedBusinessNeed.title}</h3>
              <p className="dashboard-card-meta" style={{ marginBottom: '0.5rem' }}>
                {parseFloat(selectedBusinessNeed.budget_amount).toFixed(2)}{' '}
                {selectedBusinessNeed.currency}
                {` · ${selectedBusinessNeed.budget_type === 'hourly' ? 'Hourly budget' : 'Fixed budget'}`}
                {selectedBusinessNeed.timeline_days
                  ? ` - ${selectedBusinessNeed.timeline_days} days`
                  : ''}
                {(selectedBusinessNeed.city || selectedBusinessNeed.country) &&
                  ` - ${[selectedBusinessNeed.city, selectedBusinessNeed.country].filter(Boolean).join(', ')}`}
              </p>
              {(selectedBusinessNeed.category_name_en || selectedBusinessNeed.category_name_ar) && (
                <p className="dashboard-card-meta" style={{ marginBottom: '0.5rem' }}>
                  {dictionary.common.category ?? 'Category'}:{' '}
                  {locale === 'ar'
                    ? selectedBusinessNeed.category_name_ar
                    : selectedBusinessNeed.category_name_en}
                </p>
              )}
              <p className="dashboard-card-meta" style={{ marginBottom: '0.75rem' }}>
                {dictionary.common.status ?? 'Status'}: {selectedBusinessNeed.status}
                {selectedBusinessNeed.created_at &&
                  ` · ${dictionary.common.date ?? 'Date'}: ${new Date(
                    selectedBusinessNeed.created_at,
                  ).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US')}`}
              </p>
              <p className="dashboard-card-desc" style={{ whiteSpace: 'pre-wrap' }}>
                {selectedBusinessNeed.description}
              </p>
              {getNeedMediaUrls(selectedBusinessNeed.reference_url).length > 0 && (
                <div className="dashboard-card-media" style={{ marginTop: '0.75rem' }}>
                  {getNeedMediaUrls(selectedBusinessNeed.reference_url).map((url, idx) => {
                    const full = resolvePublicAssetUrl(url) ?? url;
                    const isImage =
                      /\.(jpe?g|png|webp|gif)$/i.test(url) || url.includes('/uploads/');
                    if (!isImage) {
                      return (
                        <a
                          key={`modal-file-${idx}`}
                          href={full}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="dashboard-card-media-link"
                        >
                          File
                        </a>
                      );
                    }
                    return (
                      <button
                        key={`modal-img-${idx}`}
                        type="button"
                        className="dashboard-card-media-thumb"
                        onClick={() => setPreviewServiceImage(full)}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={full} alt="" />
                      </button>
                    );
                  })}
                </div>
              )}
              <div
                style={{
                  marginTop: '0.9rem',
                  borderTop: '1px solid hsl(var(--border))',
                  paddingTop: '0.8rem',
                }}
              >
                <p
                  className="dashboard-card-meta"
                  style={{ marginBottom: '0.5rem', fontWeight: 700 }}
                >
                  {dictionary.needs?.bids ?? 'Bids'} ({selectedNeedBids.length})
                </p>
                {selectedNeedBidsLoading ? (
                  <p className="dashboard-card-meta">{dictionary.admin.loading ?? 'Loading...'}</p>
                ) : selectedNeedBidsError ? (
                  <p className="dashboard-card-meta">{selectedNeedBidsError}</p>
                ) : selectedNeedBids.length === 0 ? (
                  <p className="dashboard-card-meta">
                    {dictionary.needs?.noBids ?? 'No bids yet for this need.'}
                  </p>
                ) : (
                  <div
                    style={{ display: 'grid', gap: '0.45rem', maxHeight: 220, overflowY: 'auto' }}
                  >
                    {selectedNeedBids.map((bid) => (
                      <div
                        key={bid.id}
                        style={{
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '0.55rem',
                          padding: '0.5rem 0.6rem',
                        }}
                      >
                        <p className="dashboard-card-meta" style={{ margin: 0 }}>
                          {bid.expert_name ?? 'Provider'}: {parseFloat(bid.amount).toFixed(2)}{' '}
                          {bid.currency || selectedBusinessNeed.currency}
                          {` · ${dictionary.common.status ?? 'Status'}: ${bid.status}`}
                        </p>
                        {bid.message ? (
                          <p
                            className="dashboard-card-meta"
                            style={{ margin: '0.25rem 0 0 0', whiteSpace: 'pre-wrap' }}
                          >
                            {bid.message}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="dashboard-form-row" style={{ marginTop: '1rem' }}>
                <button
                  type="button"
                  className="plan-modal-cancel"
                  onClick={() => setSelectedBusinessNeed(null)}
                >
                  {dictionary.common.back}
                </button>
                <button
                  type="button"
                  className="dashboard-primary-btn"
                  onClick={() => {
                    setSelectedBusinessNeed(null);
                    setBusinessEditingBid(null);
                    setBusinessBidNeed(selectedBusinessNeed);
                    setBusinessBidAmountInput('');
                    setBusinessBidError(null);
                  }}
                >
                  {dictionary.needs?.placeBid ?? 'Place Bid'}
                </button>
              </div>
            </div>
          </div>
        )}
        {businessBidNeed && (
          <div className="plan-modal-overlay" onClick={() => setBusinessBidNeed(null)}>
            <div
              className="plan-modal"
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: 480 }}
            >
              <h3 className="plan-modal-title">
                {dictionary.needs?.placeBid ?? 'Place Bid'}: {businessBidNeed.title}
              </h3>
              {businessBidError && <p className="dashboard-error">{businessBidError}</p>}
              <form className="dashboard-form" onSubmit={(e) => void handleBusinessBid(e)}>
                <input
                  name="amount"
                  type="number"
                  min="1"
                  step="0.01"
                  className="dashboard-input"
                  placeholder={
                    dictionary.needs?.bidAmountPlaceholder ?? 'Your total bid amount (EGP)'
                  }
                  value={businessBidAmountInput}
                  onChange={(e) => setBusinessBidAmountInput(e.target.value)}
                  required
                />
                {businessBidNeed.budget_type === 'hourly' ? (
                  <input
                    name="estimatedHours"
                    type="number"
                    min="1"
                    max="168"
                    className="dashboard-input"
                    defaultValue={businessEditingBid?.estimated_hours ?? ''}
                    placeholder="Estimated hours per week"
                  />
                ) : (
                  <input
                    name="deliveryDays"
                    type="number"
                    min="1"
                    max="365"
                    className="dashboard-input"
                    defaultValue={businessEditingBid?.delivery_days ?? ''}
                    placeholder={
                      dictionary.needs?.bidDeliveryPlaceholder ?? 'Delivery days (optional)'
                    }
                  />
                )}
                <textarea
                  name="message"
                  className="dashboard-textarea"
                  placeholder={
                    dictionary.needs?.bidMessagePlaceholder ?? 'Why are you the right fit?'
                  }
                  defaultValue={businessEditingBid?.message ?? ''}
                  minLength={5}
                  required
                />
                <div className="dashboard-form-row">
                  <button
                    type="button"
                    className="plan-modal-cancel"
                    onClick={() => setBusinessBidNeed(null)}
                  >
                    {dictionary.common.back}
                  </button>
                  <button
                    type="submit"
                    className="dashboard-primary-btn"
                    disabled={businessBidding}
                  >
                    {businessBidding ? '...' : (dictionary.needs?.submitBid ?? 'Submit Bid')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </Container>
    </main>
  );
};
