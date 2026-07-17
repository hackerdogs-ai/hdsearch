export type SearchDepth = 'low' | 'medium' | 'high';

export const SEARCH_DEPTH_OPTIONS: { value: SearchDepth; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export function parseSearchDepth(raw?: string | null): SearchDepth {
  if (raw === 'medium' || raw === 'high') return raw;
  return 'low';
}

export function searchDepthToMode(depth: SearchDepth): 'fallback' | 'aggregate' {
  return depth === 'low' ? 'fallback' : 'aggregate';
}
