export const getApiBaseUrl = (): string => {
  const value = process.env.NEXT_PUBLIC_API_URL;

  if (value && value.trim().length > 0) {
    return value.trim();
  }

  return '';
};
