'use client';

import { createContext, useCallback, useContext, useState } from 'react';

export type ProfileModalInitialData = {
  displayName?: string;
  avatarUrl?: string | null;
  role?: string;
};

type ProfileModalContextValue = {
  profileModalUserId: string | null;
  profileModalInitialData: ProfileModalInitialData | null;
  openProfileModal: (userId: string, initialData?: ProfileModalInitialData) => void;
  closeProfileModal: () => void;
};

const ProfileModalContext = createContext<ProfileModalContextValue | null>(null);

export function ProfileModalProvider({ children }: { children: React.ReactNode }) {
  const [profileModalUserId, setProfileModalUserId] = useState<string | null>(null);
  const [profileModalInitialData, setProfileModalInitialData] =
    useState<ProfileModalInitialData | null>(null);

  const openProfileModal = useCallback((userId: string, initialData?: ProfileModalInitialData) => {
    setProfileModalUserId(userId);
    setProfileModalInitialData(initialData ?? null);
  }, []);

  const closeProfileModal = useCallback(() => {
    setProfileModalUserId(null);
    setProfileModalInitialData(null);
  }, []);

  const value: ProfileModalContextValue = {
    profileModalUserId,
    profileModalInitialData,
    openProfileModal,
    closeProfileModal,
  };

  return <ProfileModalContext.Provider value={value}>{children}</ProfileModalContext.Provider>;
}

export function useProfileModal() {
  const ctx = useContext(ProfileModalContext);
  if (!ctx) {
    throw new Error('useProfileModal must be used within ProfileModalProvider');
  }
  return ctx;
}
