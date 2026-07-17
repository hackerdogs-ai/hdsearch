// Maps / geocoding provider for the `maps` modality. Turns a place query into
// geo-located results (lat/lon + address) that the web app plots on a MapLibre map.
// Self-hostable by design: defaults to the public Photon (komoot) instance but
// HDSEARCH_GEOCODER_URL can point at your own Photon or Nominatim container —
// both build on OpenStreetMap data, same philosophy as openserp/crawl4ai.
import { env } from '../../env.js';
import { httpJson } from '../../http.js';
import { mkResult } from '../util.js';
import type { SearchProvider } from '../types.js';
import type { NormalizedResult, SearchRequest } from '../../types.js';

export const maps: SearchProvider = {
  id: 'maps',
  label: 'Maps (OpenStreetMap geocoder)',
  category: 'search',
  accessType: 'self-hosted',
  defaultPriority: 15,
  modalities: ['maps'],
  cacheTtlSec: 86400,
  docsUrl: 'https://photon.komoot.io/',
  endpoint: 'GET {GEOCODER_URL}/api?q={q} (Photon) or /search (Nominatim)',
  description: 'Geocodes a place query to lat/lon results (OpenStreetMap via Photon or Nominatim). Self-hostable.',
  async search(req: SearchRequest): Promise<NormalizedResult[]> {
    // A geocoder always returns its closest *fuzzy* match, so a non-place query like a
    // domain ("sumologic.om") lands on an unrelated place ("Sunlogic"). Reject obvious
    // non-geographic input up front → the UI shows the "no mappable places" state.
    if (looksNonGeographic(req.q)) return [];
    const base = env.geocoderUrl.replace(/\/$/, '');
    const limit = Math.min(req.limit, 50);
    return env.geocoderEngine === 'nominatim'
      ? nominatim(base, req, limit)
      : photon(base, req, limit);
  },
};

// True for inputs that aren't places: URLs, bare domains (single token ending in a
// TLD, e.g. "sumologic.om"), and emails. Place names with dots ("St. Louis",
// "Washington, D.C.") contain spaces and aren't caught.
function looksNonGeographic(q: string): boolean {
  const s = q.trim();
  if (/^(?:https?:\/\/|www\.)/i.test(s)) return true; // URL
  if (/\S+@\S+\.\S+/.test(s)) return true; // email
  if (!/\s/.test(s) && /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,24}$/i.test(s)) return true; // bare domain
  return false;
}

// US state codes — used to disambiguate "<city> <ST>" queries. Without a comma the
// OSM geocoder mis-parses "dublin ca" as Dublin, Ireland; inserting the comma
// ("dublin, CA") makes it resolve to Dublin, California.
const US_STATE_CODES = new Set(
  ('al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy dc').split(' '),
);

// "<city> <ST>" / "<city>,<ST>" with a US state code → "<city>, ST". Idempotent;
// leaves everything else untouched.
function normalizeUsCityState(s: string): string {
  const m = s.trim().match(/^(.+?)[,\s]+([a-z]{2})$/i);
  const city = m?.[1];
  const st = m?.[2];
  if (city && st && US_STATE_CODES.has(st.toLowerCase())) return `${city.trim()}, ${st.toUpperCase()}`;
  return s;
}

// A bounding box [minLon, minLat, maxLon, maxLat] + center, used to keep results
// near the place named in the query (e.g. "coffee in San Ramon, CA").
interface Area {
  lat: number;
  lon: number;
  bbox: [number, number, number, number];
}

// Split "<what> in|near|around|at <where>" (or "what - where") into the category
// phrase + the place to geo-restrict by.
function parseQuery(q: string): { what: string; where: string | null } {
  const s = q.trim().replace(/[?.!]+$/, '');
  const dash = s.match(/^(.+?)\s+[-–—]\s+(.{2,})$/);
  if (dash?.[1] && dash?.[2]) return { what: dash[1].trim(), where: dash[2].trim() };
  const m = s.match(/^(.+?)\s+(?:in|near|around|at|within|inside|by)\s+(.{2,})$/i);
  if (m?.[1] && m?.[2]) return { what: m[1].trim(), where: m[2].trim() };
  return { what: s, where: null };
}

// Generic place-category → OpenStreetMap tag (key:value) map. Lets "<category> in
// <place>" return only matching POIs (e.g. coffee→cafe) instead of anything whose
// name contains the word. Lookup is normalized (lowercased, de-pluralized, articles
// and "best/nearby/…" stripped) and also matches the category as a whole word
// anywhere in the phrase, so it stays generic across many query shapes.
const CATEGORY_TAGS: Record<string, string> = {
  // food & drink
  coffee: 'amenity:cafe', cafe: 'amenity:cafe', 'coffee shop': 'amenity:cafe', espresso: 'amenity:cafe',
  restaurant: 'amenity:restaurant', food: 'amenity:restaurant', dining: 'amenity:restaurant', diner: 'amenity:restaurant', eatery: 'amenity:restaurant',
  bar: 'amenity:bar', pub: 'amenity:pub', brewery: 'craft:brewery', winery: 'craft:winery',
  'fast food': 'amenity:fast_food', 'ice cream': 'amenity:ice_cream', bakery: 'shop:bakery',
  // lodging
  hotel: 'tourism:hotel', motel: 'tourism:motel', hostel: 'tourism:hostel', lodging: 'tourism:hotel', 'bed and breakfast': 'tourism:guest_house',
  // shops / money / fuel
  supermarket: 'shop:supermarket', grocery: 'shop:supermarket', 'grocery store': 'shop:supermarket', mall: 'shop:mall', store: 'shop', shop: 'shop',
  pharmacy: 'amenity:pharmacy', drugstore: 'amenity:pharmacy', bank: 'amenity:bank', atm: 'amenity:atm',
  'gas station': 'amenity:fuel', 'gas stations': 'amenity:fuel', petrol: 'amenity:fuel', fuel: 'amenity:fuel',
  'ev charging': 'amenity:charging_station', 'charging station': 'amenity:charging_station',
  // health
  hospital: 'amenity:hospital', clinic: 'amenity:clinic', doctor: 'amenity:doctors', dentist: 'amenity:dentist', vet: 'amenity:veterinary', veterinary: 'amenity:veterinary',
  // education
  school: 'amenity:school', university: 'amenity:university', college: 'amenity:college', library: 'amenity:library', kindergarten: 'amenity:kindergarten',
  // leisure / culture
  park: 'leisure:park', playground: 'leisure:playground', gym: 'leisure:fitness_centre', fitness: 'leisure:fitness_centre', pool: 'leisure:swimming_pool',
  museum: 'tourism:museum', gallery: 'tourism:gallery', cinema: 'amenity:cinema', movie: 'amenity:cinema', theatre: 'amenity:theatre', theater: 'amenity:theatre', zoo: 'tourism:zoo',
  // transport
  airport: 'aeroway:aerodrome', parking: 'amenity:parking', 'train station': 'railway:station', 'bus stop': 'highway:bus_stop', 'subway station': 'railway:station',
  // civic / services
  police: 'amenity:police', 'fire station': 'amenity:fire_station', 'post office': 'amenity:post_office',
  church: 'amenity:place_of_worship', mosque: 'amenity:place_of_worship', temple: 'amenity:place_of_worship', synagogue: 'amenity:place_of_worship',
  hairdresser: 'shop:hairdresser', salon: 'shop:hairdresser', laundry: 'shop:laundry',
};

// Returns the matched OSM tag plus a canonical singular term to use as the search
// text (e.g. "pharmacies" → term "pharmacy" matches "CVS Pharmacy", not the literal
// plural). `undefined` when the phrase names no known category.
function categoryTag(what: string): { tag: string; term: string } | undefined {
  let w = what.toLowerCase().trim();
  for (let i = 0; i < 3; i++) {
    const next = w
      .replace(/^(?:find|search for|locate|show me|looking for)\s+(?:the\s+)?(?:nearest|nearby|closest|local|best|top|good|cheap|popular\s+)?/i, '')
      .replace(/^(the|a|an|some|best|top|good|nearby|local|nearest|cheap|popular)\s+/g, '')
      .trim();
    if (next === w) break;
    w = next;
  }
  const hit = (key: string) => ({ tag: CATEGORY_TAGS[key] as string, term: key });
  // exact, then de-pluralized, then any known category as a whole word in the phrase
  if (CATEGORY_TAGS[w]) return hit(w);
  const singular = w.replace(/(ie)s$/, 'y').replace(/s$/, '');
  if (CATEGORY_TAGS[singular]) return hit(singular);
  for (const key of Object.keys(CATEGORY_TAGS)) {
    if (new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`).test(w)) return hit(key);
  }
  return undefined;
}

// For no-location queries (e.g. a landmark with worldwide namesakes), keep only the
// results clustered near the top/best match so the map doesn't zoom out to the globe.
function trimGeoOutliers(results: NormalizedResult[], maxDeg = 3): NormalizedResult[] {
  if (results.length <= 1) return results;
  const g0 = (results[0]!.extra as any)?.geo;
  if (!g0) return results;
  return results.filter((r) => {
    const g = (r.extra as any)?.geo;
    return !g || (Math.abs(g.lat - g0.lat) <= maxDeg && Math.abs(g.lon - g0.lon) <= maxDeg);
  });
}

// Pad a center (no polygon) into a ~±0.3° (~30 km) box; or convert a Photon
// `extent` ([w, n, e, s]) into [minLon, minLat, maxLon, maxLat] with a small pad.
function areaFrom(lat: number, lon: number, extent?: number[]): Area {
  if (Array.isArray(extent) && extent.length === 4) {
    const [w, n, e, s] = extent as [number, number, number, number];
    const p = 0.05;
    return { lat, lon, bbox: [Math.min(w, e) - p, Math.min(n, s) - p, Math.max(w, e) + p, Math.max(n, s) + p] };
  }
  const p = 0.3;
  return { lat, lon, bbox: [lon - p, lat - p, lon + p, lat + p] };
}

// Overpass API — the right tool for "all <category> in <area>". Photon/Nominatim
// are geocoders (name→place) and miss POIs like CVS/Walgreens that aren't named
// after their category; Overpass queries OSM directly by tag within a bbox.
async function overpassPOIs(area: Area, tag: string, limit: number): Promise<NormalizedResult[]> {
  const [k, v] = tag.split(':');
  const [minLon, minLat, maxLon, maxLat] = area.bbox;
  const filter = v ? `["${k}"="${v}"]` : `["${k}"]`;
  // (south,west,north,east); nwr = node/way/relation; `out center` gives ways a point
  const ql = `[out:json][timeout:20];(nwr${filter}(${minLat},${minLon},${maxLat},${maxLon}););out center ${Math.min(limit * 3, 60)};`;
  const data = await httpJson<any>(env.overpassUrl, {
    provider: 'maps',
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(ql),
    timeoutMs: 25000,
  });
  const dist = (el: any) => {
    const la = el.lat ?? el.center?.lat;
    const lo = el.lon ?? el.center?.lon;
    return typeof la === 'number' ? (la - area.lat) ** 2 + (lo - area.lon) ** 2 : Infinity;
  };
  return ((data?.elements as any[]) || [])
    .filter((el) => el?.tags?.name && (typeof el.lat === 'number' || typeof el.center?.lat === 'number'))
    .sort((a, b) => dist(a) - dist(b)) // nearest the place center first
    .slice(0, limit)
    .map((el, i) => {
      const lat = el.lat ?? el.center.lat;
      const lon = el.lon ?? el.center.lon;
      const t = el.tags || {};
      const address = [
        [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '),
        [t['addr:city'], t['addr:state']].filter(Boolean).join(', '),
      ]
        .filter(Boolean)
        .join(' · ');
      return mkResult('maps', 'maps', {
        title: t.name,
        url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
        snippet: address || (v ? `${k}/${v}` : k),
        rank: i,
        extra: { geo: { lat, lon, label: t.name, kind: v ? `${k}/${v}` : k } },
      });
    });
}

// Geocode just the "where" phrase to a bounding area (Photon, single best match).
async function photonArea(base: string, where: string, lang?: string): Promise<Area | null> {
  try {
    const u = new URL(`${base}/api`);
    u.searchParams.set('q', where);
    u.searchParams.set('limit', '1');
    if (lang) u.searchParams.set('lang', lang.slice(0, 2));
    const data = await httpJson<any>(u.toString(), { provider: 'maps', timeoutMs: 10000 });
    const f = data?.features?.[0];
    if (!f?.geometry?.coordinates) return null;
    const [lon, lat] = f.geometry.coordinates;
    return areaFrom(lat, lon, f.properties?.extent);
  } catch {
    return null;
  }
}

// --- Photon (Elasticsearch over OSM) — GeoJSON FeatureCollection ----------------
async function photon(base: string, req: SearchRequest, limit: number): Promise<NormalizedResult[]> {
  // If the query names a place, bound + bias the search to it so we don't return
  // globally-matched pins. If it also names a category (coffee, hotel, …), restrict
  // to that OSM tag so we return matching POIs, not anything containing the word.
  // Falls back to an unbounded full-query search if a constrained search is empty.
  const { what, where } = parseQuery(req.q);
  const area = where ? await photonArea(base, normalizeUsCityState(where), req.lang) : null;
  const cat = area ? categoryTag(what) : undefined; // category only makes sense with a place

  // category + place → ask Overpass for the actual POIs of that tag in the area
  // (handles "pharmacies" → CVS/Walgreens, which a name-based geocoder misses).
  if (cat && area) {
    try {
      const pois = await overpassPOIs(area, cat.tag, limit);
      if (pois.length) return pois;
    } catch {
      /* Overpass down/slow → fall through to the Photon text search below */
    }
  }

  const fetchPhoton = async (opts: { area: boolean; tag: boolean }): Promise<any[]> => {
    const u = new URL(`${base}/api`);
    // with a category tag, search the canonical category term (so name-ranking is
    // clean) + the tag filter; otherwise search the full query text.
    // no area → normalize a bare "<city> <ST>" so "dublin ca" isn't read as Ireland
    u.searchParams.set('q', opts.tag && cat ? cat.term : opts.area ? req.q : normalizeUsCityState(req.q));
    u.searchParams.set('limit', String(limit));
    if (req.lang) u.searchParams.set('lang', req.lang.slice(0, 2));
    if (opts.area && area) {
      u.searchParams.set('bbox', area.bbox.join(','));
      u.searchParams.set('lat', String(area.lat));
      u.searchParams.set('lon', String(area.lon));
      u.searchParams.set('location_bias_scale', '0.8');
    }
    if (opts.tag && cat) u.searchParams.set('osm_tag', cat.tag);
    const data = await httpJson<any>(u.toString(), { provider: 'maps', timeoutMs: 15000 });
    return data?.features || [];
  };

  // most → least constrained, so we never return an empty map for a valid query
  let features: any[] = await fetchPhoton({ area: !!area, tag: !!cat });
  if (features.length === 0 && cat) features = await fetchPhoton({ area: !!area, tag: false });
  if (features.length === 0 && area) features = await fetchPhoton({ area: false, tag: false });

  const results = features
    .filter((f) => Array.isArray(f?.geometry?.coordinates))
    .slice(0, limit)
    .map((f, i) => {
      const [lon, lat] = f.geometry.coordinates;
      const p = f.properties || {};
      const address = [
        [p.name, p.housenumber && p.street ? `${p.street} ${p.housenumber}` : p.street].filter(Boolean).join(', '),
        [p.postcode, p.city || p.town || p.village].filter(Boolean).join(' '),
        [p.state, p.country].filter(Boolean).join(', '),
      ]
        .filter(Boolean)
        .join(' · ');
      const osmType = ({ N: 'node', W: 'way', R: 'relation' } as Record<string, string>)[p.osm_type] || 'node';
      return mkResult('maps', 'maps', {
        title: p.name || address || `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
        url: p.osm_id ? `https://www.openstreetmap.org/${osmType}/${p.osm_id}` : `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}`,
        snippet: address || `${p.osm_key || ''} ${p.osm_value || ''}`.trim(),
        rank: i,
        extra: {
          geo: { lat, lon, label: p.name || address, kind: [p.osm_key, p.osm_value].filter(Boolean).join('/') },
        },
      });
    });
  // no explicit place → cluster around the best match so the map doesn't go global
  return area ? results : trimGeoOutliers(results);
}

// Geocode the "where" phrase to a bounding area via Nominatim (uses boundingbox).
async function nominatimArea(base: string, where: string, lang?: string): Promise<Area | null> {
  try {
    const u = new URL(`${base}/search`);
    u.searchParams.set('q', where);
    u.searchParams.set('format', 'jsonv2');
    u.searchParams.set('limit', '1');
    if (lang) u.searchParams.set('accept-language', lang);
    const rows = await httpJson<any[]>(u.toString(), { provider: 'maps', timeoutMs: 10000, headers: { 'user-agent': 'hd-search/1.0 (maps modality)' } });
    const r = rows?.[0];
    if (!r?.lat || !r?.lon) return null;
    // Nominatim boundingbox = [south, north, west, east]
    const bb = (r.boundingbox || []).map(Number);
    const extent = bb.length === 4 ? [bb[2], bb[1], bb[3], bb[0]] : undefined; // → [w,n,e,s]
    return areaFrom(Number(r.lat), Number(r.lon), extent);
  } catch {
    return null;
  }
}

// --- Nominatim (OSM search) — JSON array ---------------------------------------
async function nominatim(base: string, req: SearchRequest, limit: number): Promise<NormalizedResult[]> {
  // Nominatim has no osm_tag filter; it relies on its own "special phrase" parsing
  // of the text query for categories, so we keep the full query + a bounded viewbox.
  const { where } = parseQuery(req.q);
  const area = where ? await nominatimArea(base, normalizeUsCityState(where), req.lang) : null;

  const fetchNominatim = async (withArea: boolean): Promise<any[]> => {
    const u = new URL(`${base}/search`);
    u.searchParams.set('q', withArea ? req.q : normalizeUsCityState(req.q));
    u.searchParams.set('format', 'jsonv2');
    u.searchParams.set('addressdetails', '1');
    u.searchParams.set('limit', String(limit));
    if (req.lang) u.searchParams.set('accept-language', req.lang);
    if (withArea && area) {
      // viewbox = minLon,minLat,maxLon,maxLat; bounded=1 restricts to it
      u.searchParams.set('viewbox', area.bbox.join(','));
      u.searchParams.set('bounded', '1');
    }
    return (
      (await httpJson<any[]>(u.toString(), {
        provider: 'maps',
        timeoutMs: 15000,
        headers: { 'user-agent': 'hd-search/1.0 (maps modality)' },
      })) || []
    );
  };

  let rows: any[] = await fetchNominatim(!!area);
  if (area && rows.length === 0) rows = await fetchNominatim(false); // never go empty

  const results = (rows || [])
    .filter((r) => r.lat && r.lon)
    .slice(0, limit)
    .map((r, i) => {
      const lat = Number(r.lat);
      const lon = Number(r.lon);
      return mkResult('maps', 'maps', {
        title: r.name || (r.display_name || '').split(',')[0] || `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
        url: r.osm_type && r.osm_id ? `https://www.openstreetmap.org/${r.osm_type}/${r.osm_id}` : `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}`,
        snippet: r.display_name || `${r.type || ''} ${r.category || ''}`.trim(),
        rank: i,
        extra: {
          geo: { lat, lon, label: r.display_name, kind: [r.category, r.type].filter(Boolean).join('/') },
        },
      });
    });
  return area ? results : trimGeoOutliers(results);
}
