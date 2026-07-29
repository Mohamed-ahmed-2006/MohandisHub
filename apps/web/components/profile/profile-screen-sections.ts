export type ProfileSectionId = 'account' | 'preferences' | 'profile' | 'verification' | 'wallet';

export type ProfileSection = {
  id: ProfileSectionId;
  anchorId: string;
};

const SECTION_CONFIG: ProfileSection[] = [
  { id: 'account', anchorId: 'account-settings' },
  { id: 'preferences', anchorId: 'notification-preferences' },
  { id: 'profile', anchorId: 'profile-settings' },
  { id: 'verification', anchorId: 'verification-settings' },
  { id: 'wallet', anchorId: 'wallet-settings' },
];

export function getVisibleProfileSections(role?: string | null): ProfileSection[] {
  const hasRoleProfile = role === 'expert' || role === 'craftsman' || role === 'business';

  return SECTION_CONFIG.filter((section) => {
    if (section.id === 'account' || section.id === 'preferences' || section.id === 'wallet') return true;
    return hasRoleProfile;
  });
}
