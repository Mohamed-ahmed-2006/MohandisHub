// ---------------------------------------------------------------------------
// Plan types — subscription/plan at user level (default: free)
// Other plans can be added manually by admin later.
// ---------------------------------------------------------------------------

export type PlanSlug = string; // 'free' | 'premium' | ... (admin-defined)

export type Plan = {
  id: string;
  slug: PlanSlug;
  name: string;
};

/** Default plan assigned to new users. */
export const DEFAULT_PLAN_SLUG = 'free' as const;
