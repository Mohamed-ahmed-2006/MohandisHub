export function parseNeedReferenceUrls(raw: string | null): string[] {
  if (!raw || !raw.trim()) return [];
  const t = raw.trim();
  if (t.startsWith('[')) {
    try {
      const arr = JSON.parse(t) as unknown;
      return Array.isArray(arr) ? arr.filter((u): u is string => typeof u === 'string') : [];
    } catch {
      return [t];
    }
  }
  return [t];
}
