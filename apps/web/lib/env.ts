const DEFAULT_API_URL = 'http://localhost:4000';

export const getApiBaseUrl = (): string => {
  const value = process.env.NEXT_PUBLIC_API_URL;

  if (value && value.trim().length > 0) {
    return value;
  }

  return DEFAULT_API_URL;
};
