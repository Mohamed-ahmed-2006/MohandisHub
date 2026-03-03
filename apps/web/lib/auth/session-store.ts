let inMemoryAccessToken: string | null = null;

export const sessionStore = {
  getAccessToken(): string | null {
    return inMemoryAccessToken;
  },
  setAccessToken(token: string): void {
    inMemoryAccessToken = token;
  },
  clear(): void {
    inMemoryAccessToken = null;
  },
};
