// Single-name geocoder for AI Search's plot-on-a-map tool. Resolves a place/region name
// (e.g. "Solomon Islands", "Cape York Peninsula, Australia") to a point. Photon (fast,
// autocomplete-oriented) is tried first; when its best match is WEAK — a hamlet/suburb
// rather than a country/region (Photon often lacks sovereign states like "Samoa") — we
// fall back to Nominatim, which is importance-ranked and authoritative for places. No key.
import { env } from '../env.js';
import { httpJson } from '../http.js';
import { log } from '../logger.js';

export interface GeoPoint {
  name: string; // the label the caller asked for
  lat: number;
  lon: number;
  address?: string; // resolved display name
  weak?: boolean; // best match was a low-confidence point (not an area/admin region)
}

const base = () => env.geocoderUrl.replace(/\/+$/, '');
// Authoritative fallback for place/region names. Self-host + override via env if desired.
const nominatimBase = () =>
  (env.geocoderEngine === 'nominatim' ? env.geocoderUrl : process.env.HDSEARCH_NOMINATIM_URL || 'https://nominatim.openstreetmap.org').replace(/\/+$/, '');
const cache = new Map<string, GeoPoint | null>();

// Prefer prominent AREA features (a country/territory/region with a bounding box) over
// obscure same-named points (e.g. "New Caledonia" the Pacific territory vs. a hamlet in
// Arkansas). Photon returns importance-ranked candidates; we re-rank by feature type.
function prominence(p: any): number {
  const order: Record<string, number> = { country: 6, state: 5, county: 4, region: 4, city: 3, district: 2, locality: 1, other: 1, street: 0, house: 0 };
  let s = order[p?.type] ?? 1;
  if (Array.isArray(p?.extent)) s += 3; // has a bounding box → it's an area, not a point
  if (p?.osm_key === 'boundary' && p?.osm_value === 'administrative') s += 2;
  if (p?.osm_key === 'place' && ['country', 'state', 'island', 'archipelago', 'region'].includes(p?.osm_value)) s += 2;
  return s;
}

// "Strong" = the match is an administrative area / country / region (an actual place a
// user means when naming a region), not an obscure same-named hamlet.
function isStrong(p: any): boolean {
  if (Array.isArray(p?.extent) && ['country', 'state', 'county', 'region'].includes(p?.type)) return true;
  if (p?.osm_key === 'boundary' && p?.osm_value === 'administrative') return true;
  if (p?.osm_key === 'place' && ['country', 'state', 'island', 'archipelago', 'region'].includes(p?.osm_value)) return true;
  return false;
}

// We're plotting REGIONS, so only accept place-like features (countries, regions, admin
// boundaries, natural features like capes) — never POIs. This stops a descriptive phrase
// like "Northeastern Australia" from snapping to "Northeastern Family Chinese Restaurant".
const PLACE_KEYS = new Set(['place', 'boundary', 'natural']);
const PLACE_CLASSES = new Set(['place', 'boundary', 'natural']); // Nominatim `class`

async function photon(name: string): Promise<GeoPoint | null> {
  const u = new URL(`${base()}/api`);
  u.searchParams.set('q', name);
  u.searchParams.set('limit', '10');
  const data = await httpJson<any>(u.toString(), { provider: 'maps', timeoutMs: 10000 });
  const feats: any[] = (data?.features || []).filter(
    (f: any) => Array.isArray(f?.geometry?.coordinates) && PLACE_KEYS.has(f?.properties?.osm_key),
  );
  if (!feats.length) return null; // no region-like match → caller falls back to Nominatim
  // highest prominence wins; ties keep Photon's own (importance) order
  let best = feats[0];
  let bestScore = prominence(best.properties);
  for (const f of feats.slice(1)) {
    const sc = prominence(f.properties);
    if (sc > bestScore) {
      best = f;
      bestScore = sc;
    }
  }
  const [lon, lat] = best.geometry.coordinates;
  const p = best.properties || {};
  const address = [p.name, p.state, p.country].filter(Boolean).join(', ') || undefined;
  return { name, lat, lon, address, weak: !isStrong(p) };
}

// Nominatim is rate-limited (≤1 req/s on the public instance) → serialize calls through a
// chain that spaces them out, and send a descriptive User-Agent per its usage policy.
let nomChain: Promise<unknown> = Promise.resolve();
function enqueueNominatim<T>(fn: () => Promise<T>): Promise<T> {
  const run = nomChain.then(fn, fn);
  // space the NEXT call ~1.1s after this one settles (whether it resolved or threw)
  nomChain = run.then(
    () => new Promise((r) => setTimeout(r, 1100)),
    () => new Promise((r) => setTimeout(r, 1100)),
  );
  return run;
}

async function nominatim(name: string): Promise<GeoPoint | null> {
  return enqueueNominatim(async () => {
    const u = new URL(`${nominatimBase()}/search`);
    u.searchParams.set('q', name);
    u.searchParams.set('format', 'json');
    u.searchParams.set('limit', '5');
    const res = await fetch(u.toString(), {
      headers: { 'User-Agent': 'hd-search/1.0 (AI Search plot-on-map geocoder)', 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any[];
    // first importance-ranked PLACE-like result (skip POIs/buildings)
    const f = (data || []).find((x) => PLACE_CLASSES.has(x?.class)) || null;
    if (!f) return null;
    return { name, lat: Number(f.lat), lon: Number(f.lon), address: f.display_name };
  });
}

/** Geocode one place name → point, or null if unresolved. Never throws. */
export async function geocodeOne(name: string): Promise<GeoPoint | null> {
  const q = name.trim();
  if (!q) return null;
  if (cache.has(q)) return cache.get(q)!;

  let pt: GeoPoint | null = null;
  try {
    if (env.geocoderEngine === 'nominatim') {
      pt = await nominatim(q);
    } else {
      pt = await photon(q);
      // Photon missed a real region (returned only obscure points) → ask Nominatim.
      if (!pt || pt.weak) {
        const auth = await nominatim(q).catch(() => null);
        if (auth) pt = auth;
      }
    }
  } catch (e) {
    log.warn('geocodeOne failed', { name: q, err: (e as Error).message });
  }

  const ok = pt && Number.isFinite(pt.lat) && Number.isFinite(pt.lon) ? { name: pt.name, lat: pt.lat, lon: pt.lon, address: pt.address } : null;
  cache.set(q, ok);
  return ok;
}

/** Geocode many names in parallel, preserving order; unresolved names are dropped. */
export async function geocodeMany(names: string[]): Promise<GeoPoint[]> {
  const pts = await Promise.all(names.slice(0, 40).map((n) => geocodeOne(n)));
  return pts.filter((p): p is GeoPoint => !!p);
}
