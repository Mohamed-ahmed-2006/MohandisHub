import { DEFAULT_LOCALE } from './config';
import { arDictionary } from './dictionaries/ar';
import { enDictionary } from './dictionaries/en';
import type { Dictionary, Locale } from './types';

const dictionaryMap: Record<Locale, Dictionary> = {
  en: enDictionary,
  ar: arDictionary,
};

export const getDictionary = (locale: Locale): Dictionary => {
  return dictionaryMap[locale] ?? dictionaryMap[DEFAULT_LOCALE];
};
