'use client';

import type { PublicUserProfile } from '@mohandishub/shared';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { chatApiClient } from '@/lib/chat/client';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';
import { profilesApiClient } from '@/lib/profiles/client';

import type { ProfileModalInitialData } from './profile-modal-context';

import './user-profile-modal.css';

type UserProfileModalProps = {
  userId: string;
  initialData: ProfileModalInitialData | null;
  onClose: () => void;
  locale: Locale;
  dictionary: Dictionary;
};

const ROLE_LABELS: Record<string, string> = {
  expert: 'Expert',
  business: 'Business',
  customer: 'Customer',
};

export function UserProfileModal({
  userId,
  initialData,
  onClose,
  locale,
  dictionary,
}: UserProfileModalProps) {
  const router = useRouter();
  const { accessToken, isAuthenticated, authUser } = useAuth();
  const [profile, setProfile] = useState<PublicUserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messageLoading, setMessageLoading] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await profilesApiClient.getPublicProfile(userId, accessToken ?? undefined);
      setProfile(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load profile');
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [userId, accessToken]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) onClose();
    },
    [onClose],
  );

  const handleMessage = useCallback(async () => {
    if (!accessToken || !isAuthenticated || !profile) return;
    setMessageLoading(true);
    try {
      const { conversationId } = await chatApiClient.startConversation(accessToken, profile.userId);
      onClose();
      router.push(buildLocalePath(locale, `/app/chat?c=${conversationId}`));
    } catch {
      setMessageLoading(false);
    }
  }, [accessToken, isAuthenticated, profile, onClose, router, locale]);

  const roleLabel = (dictionary.profileModal as { roleExpert?: string; roleBusiness?: string; roleCustomer?: string })?.roleExpert
    ?? ROLE_LABELS[profile?.role ?? initialData?.role ?? ''] ?? profile?.role ?? '';

  const msgLabel = (dictionary.profileModal as { message?: string })?.message ?? 'Message';
  const closeLabel = (dictionary.profileModal as { close?: string })?.close ?? 'Close';
  const verifiedLabel = (dictionary.profileModal as { verified?: string })?.verified ?? 'Verified';

  return (
    <div
      ref={overlayRef}
      className="user-profile-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-profile-modal-title"
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
    >
      <div className="user-profile-modal" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="user-profile-modal-close"
          onClick={onClose}
          aria-label={closeLabel}
        >
          ×
        </button>

        {loading ? (
          <div className="user-profile-modal-loading">
            <div className="user-profile-modal-skeleton user-profile-modal-skeleton-avatar" />
            <div className="user-profile-modal-skeleton user-profile-modal-skeleton-name" />
            <div className="user-profile-modal-skeleton user-profile-modal-skeleton-meta" />
          </div>
        ) : error ? (
          <div className="user-profile-modal-error">
            <p>{error}</p>
            <button type="button" className="user-profile-modal-btn user-profile-modal-btn--primary" onClick={onClose}>
              {closeLabel}
            </button>
          </div>
        ) : profile ? (
          <>
            <div className="user-profile-modal-cover" />
            <div className="user-profile-modal-body">
              <div className="user-profile-modal-avatar-wrap">
                {profile.avatarUrl ? (
                  <Image
                    src={profile.avatarUrl}
                    alt=""
                    width={96}
                    height={96}
                    className="user-profile-modal-avatar"
                  />
                ) : (
                  <span className="user-profile-modal-avatar-fallback">
                    {profile.displayName.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <h2 id="user-profile-modal-title" className="user-profile-modal-name">
                {profile.displayName}
              </h2>
              <div className="user-profile-modal-badges">
                <span className="user-profile-modal-role">{ROLE_LABELS[profile.role] ?? profile.role}</span>
                {(profile.expertProfile?.verificationStatus === 'verified' ||
                  profile.businessProfile?.verificationStatus === 'verified') && (
                  <span className="user-profile-modal-verified">{verifiedLabel}</span>
                )}
              </div>

              {profile.expertProfile && (
                <div className="user-profile-modal-section">
                  {profile.expertProfile.title && (
                    <p className="user-profile-modal-headline">{profile.expertProfile.title}</p>
                  )}
                  {profile.expertProfile.headline && !profile.expertProfile.title && (
                    <p className="user-profile-modal-headline">{profile.expertProfile.headline}</p>
                  )}
                  {profile.expertProfile.bio && (
                    <p className="user-profile-modal-bio">{profile.expertProfile.bio}</p>
                  )}
                  {profile.expertProfile.specializations?.length > 0 && (
                    <p className="user-profile-modal-meta">
                      {profile.expertProfile.specializations.slice(0, 5).join(' · ')}
                    </p>
                  )}
                  {(profile.expertProfile.city || profile.expertProfile.hourlyRate != null) && (
                    <p className="user-profile-modal-meta">
                      {[profile.expertProfile.city, profile.expertProfile.hourlyRate != null && `${profile.expertProfile.hourlyRate} USD/hr`]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                  {(profile.expertProfile.averageRating != null || profile.expertProfile.reviewCount > 0) && (
                    <p className="user-profile-modal-meta">
                      {profile.expertProfile.averageRating != null &&
                        `${profile.expertProfile.averageRating.toFixed(1)} ★`}
                      {profile.expertProfile.reviewCount > 0 &&
                        ` · ${profile.expertProfile.reviewCount} reviews`}
                    </p>
                  )}
                </div>
              )}

              {profile.businessProfile && (
                <div className="user-profile-modal-section">
                  <p className="user-profile-modal-company">{profile.businessProfile.companyName}</p>
                  {(profile.businessProfile.industry || profile.businessProfile.city) && (
                    <p className="user-profile-modal-meta">
                      {[profile.businessProfile.industry, profile.businessProfile.city].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  {profile.businessProfile.description && (
                    <p className="user-profile-modal-bio">{profile.businessProfile.description}</p>
                  )}
                  {(profile.businessProfile.averageRating != null || profile.businessProfile.reviewCount > 0) && (
                    <p className="user-profile-modal-meta">
                      {profile.businessProfile.averageRating != null &&
                        `${profile.businessProfile.averageRating.toFixed(1)} ★`}
                      {profile.businessProfile.reviewCount > 0 &&
                        ` · ${profile.businessProfile.reviewCount} reviews`}
                    </p>
                  )}
                </div>
              )}

              {profile.customerProfile && !profile.expertProfile && !profile.businessProfile && (
                <div className="user-profile-modal-section">
                  {(profile.customerProfile.city || profile.customerProfile.country) && (
                    <p className="user-profile-modal-meta">
                      {[profile.customerProfile.city, profile.customerProfile.country].filter(Boolean).join(', ')}
                    </p>
                  )}
                </div>
              )}

              {isAuthenticated && profile.userId && authUser?.id !== profile.userId && (
                <div className="user-profile-modal-actions">
                  <button
                    type="button"
                    className="user-profile-modal-btn user-profile-modal-btn--primary"
                    onClick={handleMessage}
                    disabled={messageLoading}
                  >
                    {messageLoading ? (dictionary.common?.loading ?? 'Loading...') : msgLabel}
                  </button>
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
