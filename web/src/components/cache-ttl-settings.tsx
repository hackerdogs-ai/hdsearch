'use client';

import { useCallback, useEffect, useState } from 'react';

export const CACHE_TTL_OPTIONS = [
  { sec: 900, label: '15 min' },
  { sec: 1800, label: '30 min' },
  { sec: 3600, label: '1 hr' },
  { sec: 86400, label: '24 hr' },
] as const;

const DEFAULT_SEC = 900;

interface Prefs {
  disabled: string[];
  ranks: Record<string, number>;
  cacheTtlSec?: number;
}

export function CacheTtlSettings() {
  const [prefs, setPrefs] = useState<Prefs>({ disabled: [], ranks: {}, cacheTtlSec: DEFAULT_SEC });
  const [maxSec, setMaxSec] = useState<number>(86400);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const selected = prefs.cacheTtlSec ?? DEFAULT_SEC;

  useEffect(() => {
    fetch('/api/panel/provider-prefs')
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'Failed to load preferences');
        return j;
      })
      .then((data) => {
        if (data.prefs) setPrefs(data.prefs);
        if (typeof data.cacheTtlLimits?.maxSec === 'number') {
          setMaxSec(data.cacheTtlLimits.maxSec);
        }
        setLoaded(true);
      })
      .catch((e) => {
        setLoadError((e as Error).message || 'Failed to load');
        setLoaded(true);
      });
  }, []);

  const save = useCallback(async (cacheTtlSec: number) => {
    setSaving(true);
    setMessage(null);
    const next = { ...prefs, cacheTtlSec };
    try {
      const res = await fetch('/api/panel/provider-prefs', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (res.ok) {
        const j = await res.json();
        if (j.prefs) setPrefs(j.prefs);
        else setPrefs(next);
        setMessage('Saved');
        setTimeout(() => setMessage(null), 2000);
      } else {
        setMessage('Save failed');
      }
    } catch {
      setMessage('Save failed');
    } finally {
      setSaving(false);
    }
  }, [prefs]);

  const maxLabel =
    CACHE_TTL_OPTIONS.find((o) => o.sec === maxSec)?.label ?? `${Math.round(maxSec / 60)} min`;

  if (!loaded) {
    return (
      <div className="card animate-pulse p-6">
        <div className="h-5 w-40 rounded bg-ink-100" />
        <div className="mt-4 h-10 rounded-lg bg-ink-100" />
      </div>
    );
  }

  return (
    <div className="card p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">Result cache</h2>
          <p className="mt-1 max-w-xl text-sm text-ink-500">
            How long search and crawl results are reused before fetching live again from providers. Applies to all
            engines for your account, including when AI Search runs search or crawl tools.
          </p>
          <p className="mt-1 text-sm text-ink-400">Your plan allows up to {maxLabel}.</p>
        </div>
        {message && (
          <span className={`text-sm ${message === 'Saved' ? 'text-brand-700' : 'text-red-600'}`}>{message}</span>
        )}
      </div>

      {loadError && (
        <p className="mt-3 text-sm text-amber-700">{loadError}</p>
      )}

      <div className="mt-5">
        <div
          className="inline-flex w-full max-w-lg rounded-xl border border-ink-200 bg-ink-50 p-1"
          role="group"
          aria-label="Cache duration"
        >
          {CACHE_TTL_OPTIONS.map(({ sec, label }) => {
            const eligible = sec <= maxSec;
            const active = selected === sec;

            if (!eligible) {
              return (
                <div key={sec} className="flex-1 rounded-lg text-center" aria-label={`${label} — unavailable`}>
                  <span className="block rounded-lg px-3 py-2 text-sm font-medium text-ink-300">
                    {label}
                  </span>
                </div>
              );
            }

            return (
              <button
                key={sec}
                type="button"
                disabled={saving}
                onClick={() => {
                  if (sec === selected) return;
                  void save(sec);
                }}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active
                    ? 'bg-white text-brand-700 shadow-sm ring-1 ring-ink-200'
                    : 'text-ink-600 hover:bg-white/60 hover:text-ink-900 disabled:opacity-50'
                }`}
                aria-pressed={active}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
