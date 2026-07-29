let inMemoryAccessToken: string | null = null;

const ACCESS_TOKEN_STORAGE_KEY = 'mohandishub-access-token';

export const sessionStore = {
  getAccessToken(): string | null {
    if (inMemoryAccessToken) return inMemoryAccessToken;
    if (typeof window !== 'undefined') {
      try {
        return window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
      } catch {
        return null;
      }
    }
    return null;
  },
  setAccessToken(token: string): void {
    inMemoryAccessToken = token;
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
      } catch {
        // Ignore quota / privacy errors
      }
    }
  },
  clear(): void {
    inMemoryAccessToken = null;
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
      } catch {
        // Ignore quota / privacy errors
      }
    }
  },
};
