// Server-side fetch for the /trends page.
import 'server-only';
import { config } from './config';
import type { TrendsPageData } from './trends-types';

export type { TrendsPageData } from './trends-types';

export async function fetchTrendsPage(): Promise<TrendsPageData | null> {
  try {
    const res = await fetch(`${config.apiUrl}/v1/trends`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as TrendsPageData;
  } catch {
    return null;
  }
}
