export type Locale = 'en' | 'ar';

/**
 * Locale strings are defined in `dictionaries/en.ts` and `dictionaries/ar.ts`. A hand-maintained
 * parallel type inevitably drifts and breaks `tsc`; keep this loose and rely on runtime checks.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Dictionary = any;
