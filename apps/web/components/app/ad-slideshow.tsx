'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { advertisementsApiClient, type Advertisement } from '@/lib/advertisements/client';
import { isAdsUiEnabled } from '@/lib/advertisements/feature';
import { toAbsoluteAssetUrl } from '@/lib/asset-url';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';

type AdSlideshowProps = {
  locale: Locale;
  dictionary: Dictionary;
  accessToken: string;
  role?: string;
};

export const AdSlideshow = ({ locale, dictionary, accessToken, role }: AdSlideshowProps) => {
  const router = useRouter();
  const [ads, setAds] = useState<Advertisement[]>([]);
  const [slide, setSlide] = useState(0);
  const [loading, setLoading] = useState(true);
  const adsEnabled = isAdsUiEnabled();

  useEffect(() => {
    if (!adsEnabled) {
      setAds([]);
      setLoading(false);
      return;
    }
    let mounted = true;
    setLoading(true);
    const params = { locale, ...(role ? { role } : {}) };
    void advertisementsApiClient
      .getActiveAds(accessToken, params)
      .then((data) => {
        if (!mounted) return;
        setAds(data);
      })
      .catch(() => {
        if (!mounted) return;
        setAds([]);
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [accessToken, locale, role, adsEnabled]);

  const total = ads.length;
  useEffect(() => {
    if (total <= 1) return;
    const t = setInterval(() => setSlide((i) => (i + 1) % total), 5000);
    return () => clearInterval(t);
  }, [total]);

  const active = useMemo(() => (total > 0 ? ads[slide % total] : null), [ads, slide, total]);

  if (loading || !active) return null;

  const title = locale === 'ar' ? active.title_ar || active.title_en : active.title_en;
  const description =
    locale === 'ar' ? active.description_ar || active.description_en : active.description_en;
  const cta = locale === 'ar' ? active.cta_text_ar || active.cta_text_en : active.cta_text_en;
  const imageUrl = toAbsoluteAssetUrl(active.image_url);

  const onClick = async () => {
    try {
      await advertisementsApiClient.trackAdClick(accessToken, active.id);
    } catch {
      // no-op
    }
    if (active.link_type === 'profile') {
      router.push(buildLocalePath(locale, `/app/profile/${active.advertiser_id}`));
      return;
    }
    if (active.link_type === 'service' && active.link_target) {
      router.push(buildLocalePath(locale, `/app/services/${active.link_target}`));
      return;
    }
    if (active.link_type === 'need' && active.link_target) {
      router.push(buildLocalePath(locale, `/app/needs/${active.link_target}`));
      return;
    }
  };

  return (
    <section
      className="ad-slideshow"
      aria-label={dictionary.advertisements?.title ?? 'Advertisements'}
    >
      <div
        id="ad-slideshow-panel"
        className="ad-slideshow-banner"
        style={{ backgroundImage: `url(${imageUrl})` }}
        role="tabpanel"
      >
        <div className="ad-slideshow-overlay">
          <p className="ad-slideshow-badge">{dictionary.advertisements?.adLabel ?? 'Sponsored'}</p>
          <h2 className="ad-slideshow-title">{title}</h2>
          {description ? <p className="ad-slideshow-desc">{description}</p> : null}
          <button type="button" className="ad-slideshow-cta" onClick={() => void onClick()}>
            {cta ?? dictionary.advertisements?.cta?.open ?? 'Open'}
          </button>
        </div>
      </div>

      {total > 1 && (
        <div className="ad-slideshow-dots" role="tablist">
          {ads.map((ad, idx) => (
            <button
              key={ad.id}
              type="button"
              role="tab"
              aria-selected={slide === idx}
              aria-controls="ad-slideshow-panel"
              aria-label={`Ad ${idx + 1}`}
              className="ad-slideshow-dot"
              onClick={() => setSlide(idx)}
            />
          ))}
        </div>
      )}
    </section>
  );
};
