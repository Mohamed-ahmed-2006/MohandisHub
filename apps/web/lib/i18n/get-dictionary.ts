import type { Dictionary, Locale } from './types';

export async function getDictionary(locale: Locale): Promise<Dictionary> {
  if (locale === 'en') {
    const { enDictionary } = await import('./dictionaries/en');
    return enDictionary;
  }
  const { arDictionary } = await import('./dictionaries/ar');
  return arDictionary;
}
