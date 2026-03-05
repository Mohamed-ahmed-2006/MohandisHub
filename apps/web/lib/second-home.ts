import type { UserRole } from '@mohandishub/shared';

export type SuggestionsRoleKey = UserRole | 'unknown';

export const getSuggestionRoleKey = (role: UserRole | null): SuggestionsRoleKey => {
  if (role === 'customer' || role === 'expert' || role === 'business' || role === 'admin') {
    return role;
  }
  return 'unknown';
};

export const getServiceActionByRole = (role: UserRole): 'request' | 'offer' | 'activity' => {
  if (role === 'customer') {
    return 'request';
  }

  if (role === 'admin') {
    return 'activity';
  }

  return 'offer';
};
