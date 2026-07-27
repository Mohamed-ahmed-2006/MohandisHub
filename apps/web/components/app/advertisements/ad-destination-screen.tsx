'use client';

import type { PublicUserProfile, Service } from '@mohandishub/shared';
import Image from 'next/image';
import { useEffect, useState } from 'react';

import { SiteLogo } from '@/components/site-logo';
import { toAbsoluteAssetUrl } from '@/lib/asset-url';
import type { Locale } from '@/lib/i18n/types';
import { profilesApiClient } from '@/lib/profiles/client';
import { servicesApiClient } from '@/lib/services/client';

type ProfileProps = { locale: Locale; providerId: string };
type ServiceProps = { locale: Locale; serviceId: string };

export const AdvertisedProviderScreen = ({ locale, providerId }: ProfileProps) => {
  const [profile, setProfile] = useState<PublicUserProfile | null>(null);
  const [error, setError] = useState(false);
  const isAr = locale === 'ar';
  const tr = (en: string, ar: string) => (isAr ? ar : en);

  useEffect(() => {
    let active = true;
    void profilesApiClient
      .getPublicProfile(providerId)
      .then((value) => {
        if (active) setProfile(value);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [providerId]);

  if (error) {
    return (
      <main className="home-empty">
        {tr('Provider profile is unavailable.', 'ملف مقدم الخدمة غير متاح.')}
      </main>
    );
  }
  if (!profile) return <main className="home-empty">{tr('Loading…', 'جارٍ التحميل…')}</main>;

  const detail =
    profile.expertProfile ?? profile.craftsmanProfile ?? profile.businessProfile ?? null;
  const heading =
    profile.businessProfile?.companyName ??
    profile.expertProfile?.title ??
    profile.craftsmanProfile?.title ??
    profile.displayName;
  const description =
    profile.businessProfile?.description ??
    profile.expertProfile?.bio ??
    profile.craftsmanProfile?.bio ??
    null;
  const city =
    profile.businessProfile?.city ??
    profile.expertProfile?.city ??
    profile.craftsmanProfile?.city ??
    null;

  return (
    <main className="profile-main" dir={isAr ? 'rtl' : 'ltr'}>
      <article className="dashboard-card">
        {profile.avatarUrl ? (
          <Image
            className="profile-avatar"
            src={toAbsoluteAssetUrl(profile.avatarUrl)}
            alt={profile.displayName}
            width={160}
            height={160}
          />
        ) : (
          <SiteLogo className="profile-avatar" />
        )}
        <p className="ad-slideshow-badge">{tr('Sponsored destination', 'وجهة إعلان ممول')}</p>
        <h1>{heading}</h1>
        {heading !== profile.displayName ? <h2>{profile.displayName}</h2> : null}
        {description ? <p>{description}</p> : null}
        {city ? (
          <p>
            {tr('Location', 'الموقع')}: {city}
          </p>
        ) : null}
        {'averageRating' in (detail ?? {}) && detail?.averageRating != null ? (
          <p>
            {tr('Rating', 'التقييم')}: {detail.averageRating.toFixed(1)} ({detail.reviewCount})
          </p>
        ) : null}
      </article>
    </main>
  );
};

export const AdvertisedServiceScreen = ({ locale, serviceId }: ServiceProps) => {
  const [service, setService] = useState<Service | null>(null);
  const [error, setError] = useState(false);
  const isAr = locale === 'ar';
  const tr = (en: string, ar: string) => (isAr ? ar : en);

  useEffect(() => {
    let active = true;
    void servicesApiClient
      .getServiceDetail(serviceId)
      .then((value) => {
        if (active) setService(value);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [serviceId]);

  if (error) {
    return <main className="home-empty">{tr('Service is unavailable.', 'الخدمة غير متاحة.')}</main>;
  }
  if (!service) return <main className="home-empty">{tr('Loading…', 'جارٍ التحميل…')}</main>;

  return (
    <main className="profile-main" dir={isAr ? 'rtl' : 'ltr'}>
      <article className="dashboard-card">
        {service.images[0] ? (
          <Image
            className="service-card-image"
            src={toAbsoluteAssetUrl(service.images[0])}
            alt={service.title}
            width={1200}
            height={675}
          />
        ) : null}
        <p className="ad-slideshow-badge">{tr('Sponsored destination', 'وجهة إعلان ممول')}</p>
        <h1>{service.title}</h1>
        {service.description ? <p>{service.description}</p> : null}
        <p>
          {service.price != null
            ? `${service.price.toFixed(2)} ${service.currency}`
            : tr('Contact for price', 'تواصل لمعرفة السعر')}
        </p>
        <p>
          {tr('Completed orders', 'الطلبات المكتملة')}: {service.orderCount}
        </p>
        {service.avgRating != null ? (
          <p>
            {tr('Rating', 'التقييم')}: {service.avgRating.toFixed(1)}
          </p>
        ) : null}
      </article>
    </main>
  );
};
