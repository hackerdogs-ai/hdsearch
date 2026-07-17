'use client';

import { useEffect, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';

// Compact interactive map card for AI Search — the generative tool-UI for place queries
// (hd_maps / hd_search maps modality). Mirrors MapResults: OSM raster tiles (no key),
// MapLibre loaded lazily. Renders pins + a short scrollable list of places.
export interface Place {
  title: string;
  lat: number;
  lon: number;
  address?: string;
  kind?: string;
  url?: string;
}

const OSM_RASTER_STYLE = {
  version: 8,
  sources: {
    osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
} as const;

export function MapCard({ data }: { data: { query?: string; places?: Place[] } }) {
  const places = (data?.places || []).filter((p) => typeof p.lat === 'number' && typeof p.lon === 'number');
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [active, setActive] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!containerRef.current || !places.length) return;
    (async () => {
      const maplibre = (await import('maplibre-gl')).default;
      if (cancelled || !containerRef.current) return;
      const style = (process.env.NEXT_PUBLIC_MAP_STYLE as any) || (OSM_RASTER_STYLE as any);
      const map = new maplibre.Map({
        container: containerRef.current,
        style,
        center: [places[0]!.lon, places[0]!.lat],
        zoom: 11,
        attributionControl: { compact: true },
      });
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
      mapRef.current = map;
      map.on('load', () => {
        if (cancelled) return;
        const bounds = new maplibre.LngLatBounds();
        places.forEach((p, i) => {
          const marker = new maplibre.Marker({ color: '#0d9488' }).setLngLat([p.lon, p.lat]).addTo(map);
          marker.getElement().style.cursor = 'pointer';
          marker.getElement().addEventListener('click', () => focus(i));
          bounds.extend([p.lon, p.lat]);
        });
        if (places.length > 1) map.fitBounds(bounds, { padding: 40, maxZoom: 15, duration: 0 });
        else map.setZoom(14);
        setReady(true);
      });
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(places.map((p) => [p.lat, p.lon]))]);

  function focus(i: number) {
    setActive(i);
    const p = places[i];
    if (p && mapRef.current) mapRef.current.flyTo({ center: [p.lon, p.lat], zoom: 15, speed: 1.4 });
  }

  if (!places.length) return <p className="text-sm text-ink-400">No mappable places found.</p>;

  return (
    <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
      {/* list */}
      <ul className="order-2 max-h-64 space-y-1.5 overflow-auto sm:order-1">
        {places.map((p, i) => (
          <li key={i}>
            <button
              onClick={() => focus(i)}
              className={`w-full rounded-lg border p-2 text-left text-sm transition ${
                i === active ? 'border-brand-300 bg-brand-50' : 'border-ink-100 bg-white hover:bg-ink-50'
              }`}
            >
              <div className="flex items-start gap-1.5">
                <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink-900">{p.title}</span>
                  {p.address && <span className="block line-clamp-1 text-sm text-ink-500">{p.address}</span>}
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>
      {/* map */}
      <div className="order-1 sm:order-2">
        <div ref={containerRef} className="h-64 w-full overflow-hidden rounded-lg border border-ink-200 bg-ink-100" />
        {!ready && <p className="mt-1 text-sm text-ink-400">Loading map…</p>}
      </div>
    </div>
  );
}
