import type { ApiSuccessBody } from '@mohandishub/shared';

import { getApiBaseUrl } from '@/lib/env';

export type ActivityItem = {
  id: string;
  type: string;
  amount: string;
  balance_after: string;
  status: string;
  description: string | null;
  reference_type: string | null;
  created_at: string;
};

export type ActivityListResponse = {
  items: ActivityItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export async function getMyActivity(
  accessToken: string,
  page = 1,
  limit = 20,
): Promise<ActivityListResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/users/me/activity?page=${page}&limit=${limit}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('Failed to fetch activity');
  const json = (await res.json()) as ApiSuccessBody<ActivityListResponse>;
  return json.data;
}
