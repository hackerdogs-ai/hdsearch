import type { SearchModality } from '@/components/search-modality-nav';

export type ModalityMeta = {
  icon: string;
  label: string;
  /** Compact label for the tiny caption under nav icons (must fit the icon width). */
  short?: string;
  title: string;
};

/** Icons + labels for modality tabs and composer dropdown. */
export const MODALITY_META: Record<SearchModality, ModalityMeta> = {
  web: { icon: 'travel_explore', label: 'Web', title: 'Web search' },
  news: { icon: 'brand_awareness', label: 'News', title: 'News' },
  images: { icon: 'image', label: 'Images', title: 'Images' },
  videos: { icon: 'smart_display', label: 'Videos', title: 'Videos' },
  maps: { icon: 'map', label: 'Maps', title: 'Maps and places' },
  scholar: { icon: 'newsstand', label: 'Scholar', title: 'Scholar' },
  shopping: { icon: 'shopping_bag_speed', label: 'Shopping', short: 'Shop', title: 'Shopping' },
  code: { icon: 'code', label: 'Code', title: 'Code search' },
  social: { icon: 'diversity_3', label: 'Social', title: 'Social' },
  archive: { icon: 'archive', label: 'Archive', title: 'Archive (Common Crawl)' },
  darkweb: { icon: 'phishing', label: 'Darkweb', short: 'Dark', title: 'Darkweb' },
  semantic: {
    icon: 'search_insights',
    label: 'Semantic',
    short: 'Semantic',
    title: 'Semantic search — ranked by meaning, grounded with live web',
  },
  ai: {
    icon: 'forum',
    label: 'AI Search',
    short: 'AI',
    title: 'AI Search — conversational answers with citations',
  },
};

export function modalityLabel(m: string): string {
  const meta = MODALITY_META[m as SearchModality];
  return meta?.label ?? m;
}

/** Short caption for the nav icon (falls back to the full label). */
export function modalityShort(m: string): string {
  const meta = MODALITY_META[m as SearchModality];
  return meta?.short ?? meta?.label ?? m;
}

export function modalityTitle(m: string): string {
  const meta = MODALITY_META[m as SearchModality];
  return meta?.title ?? modalityLabel(m);
}

/** Modalities available in the inline composer dropdown (same order as header). */
export const COMPOSER_MODALITIES = [
  'web',
  'news',
  'images',
  'videos',
  'maps',
  'scholar',
  'shopping',
  'code',
  'social',
  'archive',
  'darkweb',
  'semantic',
  'ai',
] as const satisfies readonly SearchModality[];
