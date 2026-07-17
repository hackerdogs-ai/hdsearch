// Browser-tier search history (the default for everyone, incl. anonymous users).
// Stored in localStorage; signed-in users additionally get the server-side Redis
// (3-day) and S3 (paid) tiers. Capped and de-duplicated, most-recent first.
export interface Recent {
  q: string;
  modality: string;
  ts: number;
}

const KEY = 'hd_recents';
const MAX = 50;

export function getRecents(): Recent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Recent[]) : [];
  } catch {
    return [];
  }
}

export function pushRecent(q: string, modality: string): void {
  if (typeof window === 'undefined' || !q.trim()) return;
  try {
    const list = getRecents().filter((r) => !(r.q === q && r.modality === modality));
    list.unshift({ q, modality, ts: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    window.dispatchEvent(new Event('hd-recents'));
  } catch {
    /* ignore quota errors */
  }
}

export function removeRecent(q: string, modality: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(getRecents().filter((r) => !(r.q === q && r.modality === modality))));
    window.dispatchEvent(new Event('hd-recents'));
  } catch {
    /* ignore */
  }
}

export function clearRecents(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event('hd-recents'));
}
