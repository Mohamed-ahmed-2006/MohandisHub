export const SUGGESTED_SERVICE_TAGS = [
  'plumbing',
  'electrical',
  'carpentry',
  'design',
  'hvac',
  'inspection',
  'painting',
  'subcontracting',
  'سباكة',
  'كهرباء',
  'نجارة',
  'تصميم',
  'دهانات',
  'استشارات',
];

export function normalizeServiceTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF\s-_]/gi, '')
    .slice(0, 30);
}
