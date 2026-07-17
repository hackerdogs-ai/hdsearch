// Trends page data — categorized recent headlines (News, Cybersecurity, Govt, GD*).
import { cacheGet, cacheSet, singleFlight } from './cache.js';
import { env } from './env.js';
import { log } from './logger.js';
import {
  TREND_SECTIONS,
  fetchCategoryHeadlines,
  hdFeedsConfigured,
  pingHdFeeds,
  type TrendArticle,
} from './hdfeedsClient.js';

export type { TrendArticle };

export interface TrendSection {
  id: string;
  label: string;
  items: TrendArticle[];
}

export interface TrendsPageResponse {
  sections: TrendSection[];
  windowHours: number;
  generatedAt: string;
  cached: boolean;
}

async function produceTrendsPage(windowHours: number, perSection: number): Promise<Omit<TrendsPageResponse, 'cached'>> {
  const sections: TrendSection[] = [];

  if (!hdFeedsConfigured()) {
    log.info('trends page skipped — hdfeeds not configured');
  } else if (!(await pingHdFeeds())) {
    log.warn('trends page — hdfeeds offline');
  } else {
    // Fetch categories sequentially — parallel RediSearch queries can time out hd-feeds Redis.
    for (const sec of TREND_SECTIONS) {
      const items = await fetchCategoryHeadlines(sec.category, windowHours, perSection);
      sections.push({ id: sec.id, label: sec.label, items });
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  return {
    sections,
    windowHours,
    generatedAt: new Date().toISOString(),
  };
}

export async function getTrendsPage(opts?: { windowHours?: number; limit?: number }): Promise<TrendsPageResponse> {
  const windowHours = opts?.windowHours ?? env.trendsWindowHours;
  const perSection = opts?.limit ?? env.trendsLimit;
  const cacheKey = `trends:v4:page:${windowHours}:${perSection}`;

  const cached = await cacheGet<Omit<TrendsPageResponse, 'cached'>>('trends', cacheKey);
  if (cached) {
    const cachedTotal = cached.sections.reduce((n, s) => n + s.items.length, 0);
    if (cachedTotal > 0) {
      log.info('trends page served', {
        cached: true,
        sections: cached.sections.length,
        articles: cachedTotal,
        windowHours,
      });
      return { ...cached, cached: true };
    }
  }

  const value = await singleFlight(`trends:${cacheKey}`, () => produceTrendsPage(windowHours, perSection));
  const total = value.sections.reduce((n, s) => n + s.items.length, 0);
  if (total > 0) cacheSet('trends', cacheKey, value, env.trendsCacheTtlSec);
  log.info('trends page served', { cached: false, sections: value.sections.length, articles: total, windowHours });
  return { ...value, cached: false };
}
