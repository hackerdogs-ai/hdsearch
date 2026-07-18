'use client';

import { useEffect, useState } from 'react';

const OPTIONS = [
  { sec: 900, label: '15 min' },
  { sec: 1800, label: '30 min' },
  { sec: 3600, label: '1 hr' },
  { sec: 86400, label: '24 hr' },
] as const;

/** Admin control for system-wide result-cache default + hard max TTL. */
export function CacheTtlPolicy() {
  const [defaultSec, setDefaultSec] = useState<number | null>(null);
  const [maxSec, setMaxSec] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/panel/cache-ttl')
      .then((r) => r.json())
      .then((d) => {
        setDefaultSec(typeof d.defaultSec === 'number' ? d.defaultSec : 900);
        setMaxSec(typeof d.maxSec === 'number' ? d.maxSec : 86400);
      })
      .catch(() => setErr('Could not load cache TTL settings.'));
  }, []);

  async function save(nextDefault: number, nextMax: number) {
    if (nextDefault > nextMax) {
      setErr('Default TTL must be less than or equal to the hard max.');
      return;
    }
    setSaving(true);
    setErr(null);
    setSaved(false);
    try {
      const r = await fetch('/api/panel/cache-ttl', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ defaultSec: nextDefault, maxSec: nextMax }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || j.error || 'Save failed');
      setDefaultSec(j.defaultSec ?? nextDefault);
      setMaxSec(j.maxSec ?? nextMax);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setErr((e as Error).message || 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const loaded = defaultSec != null && maxSec != null;

  return (
    <div className="rounded-lg border border-ink-100 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">Result cache TTL</h2>
          <p className="mt-0.5 text-sm text-ink-500">
            System default and hard max for Redis search/crawl caching. API{' '}
            <code className="text-xs">ttl</code> uses the default when omitted or above the max.{' '}
            <code className="text-xs">noCache</code> still bypasses the cache.
          </p>
        </div>
        {saved && <span className="text-sm text-brand-700">Saved</span>}
      </div>

      {!loaded ? (
        <p className="mt-3 text-sm text-ink-400">Loading…</p>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium text-ink-700">Default TTL</span>
            <select
              className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900"
              value={defaultSec}
              disabled={saving}
              onChange={(e) => {
                const next = Number(e.target.value);
                void save(next, maxSec);
              }}
            >
              {OPTIONS.map(({ sec, label }) => (
                <option key={sec} value={sec} disabled={sec > maxSec}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-ink-700">Hard max TTL</span>
            <select
              className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900"
              value={maxSec}
              disabled={saving}
              onChange={(e) => {
                const next = Number(e.target.value);
                const nextDefault = defaultSec > next ? next : defaultSec;
                void save(nextDefault, next);
              }}
            >
              {OPTIONS.map(({ sec, label }) => (
                <option key={sec} value={sec}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
    </div>
  );
}
