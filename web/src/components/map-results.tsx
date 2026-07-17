'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Result } from './results';

// Maps modality view — plots geo-located results on a MapLibre GL map alongside a
// scrollable list. MapLibre is loaded lazily (client-only; it touches `window`).
// Tiles default to OpenStreetMap raster (no API key, self-host-friendly); override
// the style by setting NEXT_PUBLIC_MAP_STYLE to a self-hosted style.json.
interface Geo {
  lat: number;
  lon: number;
  label?: string;
  kind?: string;
}
function geoOf(r: Result): Geo | null {
  const g = r.extra?.geo;
  if (g && typeof g.lat === 'number' && typeof g.lon === 'number') return g as Geo;
  return null;
}

const OSM_RASTER_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
} as const;

export function MapResults({ results }: { results: Result[] }) {
  const points = useMemo(() => results.map((r) => ({ r, g: geoOf(r) })).filter((x): x is { r: Result; g: Geo } => !!x.g), [results]);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [active, setActive] = useState(0);
  const [ready, setReady] = useState(false);

  // init map once
  useEffect(() => {
    let cancelled = false;
    if (!containerRef.current || !points.length) return;
    (async () => {
      const maplibre = (await import('maplibre-gl')).default;
      if (cancelled || !containerRef.current) return;
      const style = process.env.NEXT_PUBLIC_MAP_STYLE || (OSM_RASTER_STYLE as any);
      const map = new maplibre.Map({
        container: containerRef.current,
        style,
        center: [points[0].g.lon, points[0].g.lat],
        zoom: 4,
        attributionControl: { compact: true },
      });
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
      mapRef.current = map;

      map.on('load', () => {
        if (cancelled) return;
        const bounds = new maplibre.LngLatBounds();
        points.forEach(({ r, g }, i) => {
          const el = document.createElement('button');
          el.className = 'hd-pin';
          el.setAttribute('aria-label', r.title);
          const marker = new maplibre.Marker({ color: '#0d9488' }).setLngLat([g.lon, g.lat]).addTo(map);
          marker.getElement().addEventListener('click', () => focus(i));
          markersRef.current.push(marker);
          bounds.extend([g.lon, g.lat]);
        });
        if (points.length > 1) map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 0 });
        else map.setZoom(13);
        setReady(true);
      });
    })();
    return () => {
      cancelled = true;
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);

  function focus(i: number) {
    setActive(i);
    const p = points[i];
    if (p && mapRef.current) mapRef.current.flyTo({ center: [p.g.lon, p.g.lat], zoom: 14, speed: 1.4 });
  }

  if (!points.length) {
    return <p className="py-16 text-center text-ink-500">No mappable places for this query. Try a place name, address, or landmark.</p>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      {/* result list */}
      <ul className="order-2 max-h-[70vh] space-y-2 overflow-auto lg:order-1">
        {points.map(({ r, g }, i) => (
          <li key={r.id}>
            <button
              onClick={() => focus(i)}
              className={`w-full rounded-lg border p-3 text-left transition ${
                i === active ? 'border-brand-300 bg-brand-50' : 'border-ink-200 bg-white hover:bg-ink-50'
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink-900">{r.title}</div>
                  {r.snippet && <div className="line-clamp-2 text-sm text-ink-500">{r.snippet}</div>}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {g.kind && <span className="chip py-0.5 text-sm">{g.kind}</span>}
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="chip py-0.5 text-sm text-brand-700 hover:underline"
                    >
                      OpenStreetMap ↗
                    </a>
                  </div>
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>

      {/* map */}
      <div className="order-1 lg:order-2">
        <div ref={containerRef} className="h-[70vh] w-full overflow-hidden rounded-xl border border-ink-200 bg-ink-100" />
        {!ready && <p className="mt-1 text-sm text-ink-400">Loading map…</p>}
      </div>
    </div>
  );
}
