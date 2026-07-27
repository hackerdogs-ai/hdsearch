'use client';

import { useCallback, useEffect, useState } from 'react';
import { AiControlHelp } from '@/components/ai/ai-control-help';

export const CACHE_TTL_OPTIONS = [
  { sec: 900, label: '15 min' },
  { sec: 1800, label: '30 min' },
  { sec: 3600, label: '1 hr' },
  { sec: 86400, label: '24 hr' },
] as const;

export const HISTORY_TTL_OPTIONS = [
  { sec: 1 * 24 * 3600, label: '1 day' },
  { sec: 3 * 24 * 3600, label: '3 days' },
  { sec: 7 * 24 * 3600, label: '7 days' },
  { sec: 14 * 24 * 3600, label: '14 days' },
  { sec: 30 * 24 * 3600, label: '30 days' },
] as const;

const DEFAULT_RESULT_SEC = 900;
const DEFAULT_HISTORY_SEC = 3 * 24 * 3600;

interface Prefs {
  disabled: string[];
  ranks: Record<string, number>;
  cacheTtlSec?: number;
  historyTtlSec?: number;
}

type SegmentOption = { sec: number; label: string };

function SegmentControl({
  options,
  selected,
  saving,
  onSelect,
  ariaLabel,
  maxSec,
}: {
  options: readonly SegmentOption[];
  selected: number;
  saving: boolean;
  onSelect: (sec: number) => void;
  ariaLabel: string;
  maxSec?: number;
}) {
  return (
    <div
      className="inline-flex w-full max-w-2xl rounded-xl border border-ink-200 bg-ink-50 p-1"
      role="group"
      aria-label={ariaLabel}
    >
      {options.map(({ sec, label }) => {
        const eligible = maxSec == null || sec <= maxSec;
        const active = selected === sec;

        if (!eligible) {
          return (
            <div key={sec} className="flex-1 rounded-lg text-center" aria-label={`${label} — unavailable`}>
              <span className="block rounded-lg px-2 py-2 text-sm font-medium text-ink-300">{label}</span>
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
              onSelect(sec);
            }}
            className={`flex-1 rounded-lg px-2 py-2 text-sm font-medium transition ${
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
  );
}

export function CacheTtlSettings() {
  const [prefs, setPrefs] = useState<Prefs>({
    disabled: [],
    ranks: {},
    cacheTtlSec: DEFAULT_RESULT_SEC,
    historyTtlSec: DEFAULT_HISTORY_SEC,
  });
  const [maxSec, setMaxSec] = useState<number>(86400);
  const [defaultSec, setDefaultSec] = useState<number>(DEFAULT_RESULT_SEC);
  const [historyDefaultSec, setHistoryDefaultSec] = useState<number>(DEFAULT_HISTORY_SEC);
  const [historyOptions, setHistoryOptions] = useState<SegmentOption[]>([...HISTORY_TTL_OPTIONS]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const selectedResult = prefs.cacheTtlSec ?? defaultSec;
  const selectedHistory = prefs.historyTtlSec ?? historyDefaultSec;

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
        if (typeof data.cacheTtlLimits?.defaultSec === 'number') {
          setDefaultSec(data.cacheTtlLimits.defaultSec);
        }
        if (typeof data.historyTtlLimits?.defaultSec === 'number') {
          setHistoryDefaultSec(data.historyTtlLimits.defaultSec);
        }
        if (Array.isArray(data.historyTtlLimits?.options) && data.historyTtlLimits.options.length) {
          setHistoryOptions(
            data.historyTtlLimits.options.map((o: { sec: number; label: string }) => ({
              sec: o.sec,
              label: o.label,
            })),
          );
        }
        setLoaded(true);
      })
      .catch((e) => {
        setLoadError((e as Error).message || 'Failed to load');
        setLoaded(true);
      });
  }, []);

  const savePrefs = useCallback(
    async (patch: Partial<Pick<Prefs, 'cacheTtlSec' | 'historyTtlSec'>>) => {
      setSaving(true);
      setMessage(null);
      const next = { ...prefs, ...patch };
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
    },
    [prefs],
  );

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
    <div className="card space-y-8 p-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-900">
            Result Cache
            <AiControlHelp label="Result Cache">
              <p>
                How long search and crawl results are reused when a request does not set{' '}
                <code className="text-xs">ttl</code>. API calls may override this (up to the admin hard max).
              </p>
              <p className="mt-2 text-ink-500">Maximum cache duration: {maxLabel}.</p>
            </AiControlHelp>
          </h2>
          {message && (
            <span className={`text-sm ${message === 'Saved' ? 'text-brand-700' : 'text-red-600'}`}>{message}</span>
          )}
        </div>

        {loadError && <p className="mt-3 text-sm text-amber-700">{loadError}</p>}

        <div className="mt-5">
          <SegmentControl
            options={CACHE_TTL_OPTIONS}
            selected={selectedResult}
            saving={saving}
            maxSec={maxSec}
            ariaLabel="Result Cache duration"
            onSelect={(sec) => void savePrefs({ cacheTtlSec: sec })}
          />
        </div>
      </div>

      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-900">
          History Cache
          <AiControlHelp label="History Cache">
            <p>
              How long signed-in search history and AI conversations stay in the server Redis window. Longer values keep
              synced history available across devices for more days. A durable archive is still written separately.
            </p>
            <p className="mt-2 text-ink-500">Default: 3 days.</p>
          </AiControlHelp>
        </h2>

        <div className="mt-5">
          <SegmentControl
            options={historyOptions}
            selected={selectedHistory}
            saving={saving}
            ariaLabel="History Cache duration"
            onSelect={(sec) => void savePrefs({ historyTtlSec: sec })}
          />
        </div>
      </div>
    </div>
  );
}
