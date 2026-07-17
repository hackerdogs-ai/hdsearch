'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Engine } from './content/services-content';

interface Prefs {
  disabled: string[];
  ranks: Record<string, number>;
  cacheTtlSec?: number;
}

const ACCESS_BADGE: Record<string, string> = {
  free: 'bg-green-100 text-green-700',
  'self-hosted': 'bg-sky-100 text-sky-700',
  freemium: 'bg-amber-100 text-amber-700',
  commercial: 'bg-purple-100 text-purple-700',
};

const CATEGORY_ICON: Record<string, string> = {
  search: 'M15.5 14h-.8l-.3-.3a6.5 6.5 0 10-.7.7l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0a4.5 4.5 0 110-9 4.5 4.5 0 010 9z',
  darkweb: 'M12 1a9 9 0 00-9 9c0 7 9 13 9 13s9-6 9-13a9 9 0 00-9-9zm0 12a3 3 0 110-6 3 3 0 010 6z',
  crawl: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-.61.08-1.21.21-1.78L8.99 15v1c0 1.1.9 2 2 2v1.93A8.01 8.01 0 014 12zm13.89 5.4A2 2 0 0016 16h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41A7.98 7.98 0 0120 12c0 2.08-.8 3.97-2.11 5.4z',
};

const CATEGORY_LABEL: Record<string, string> = {
  search: 'Search Engines',
  darkweb: 'Dark Web',
  crawl: 'Web Crawlers',
};

export function ProviderRankingManager({ engines }: { engines: Engine[] }) {
  const [prefs, setPrefs] = useState<Prefs>({ disabled: [], ranks: {} });
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    fetch('/api/panel/provider-prefs')
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'Failed to load provider preferences');
        return j;
      })
      .then((prefsData) => {
        if (prefsData.prefs) setPrefs(prefsData.prefs);
        setLoaded(true);
      })
      .catch((e) => {
        setLoadError((e as Error).message || 'Failed to load');
        setLoaded(true);
      });
  }, []);

  const save = useCallback(async (next: Prefs) => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/panel/provider-prefs', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (res.ok) {
        setPrefs(next);
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
  }, []);

  const toggle = useCallback((id: string) => {
    const next = { ...prefs };
    if (next.disabled.includes(id)) {
      next.disabled = next.disabled.filter((d) => d !== id);
    } else {
      next.disabled = [...next.disabled, id];
    }
    void save(next);
  }, [prefs, save]);

  if (!loaded) return <div className="card p-6 text-sm text-ink-400">Loading providers...</div>;

  const groups = ['search', 'darkweb', 'crawl'] as const;
  const enabledCount = engines.filter((e) => !prefs.disabled.includes(e.id)).length;
  const q = filter.toLowerCase();
  const filteredEngines = q ? engines.filter((e) => e.label.toLowerCase().includes(q) || e.id.toLowerCase().includes(q) || e.category.toLowerCase().includes(q)) : engines;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">Integrations</h2>
          <p className="mt-1 text-sm text-ink-500">
            {enabledCount} of {engines.length} search providers enabled.
            Toggle providers on/off. Use{' '}
            <Link href="/dashboard/services/ranking" className="text-brand-600 hover:underline">Ranking</Link>{' '}
            to set priority order and{' '}
            <Link href="/dashboard/services/llm-providers" className="text-brand-600 hover:underline">LLM Providers</Link>{' '}
            to enable or disable AI models.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {message && (
            <span className={`text-sm ${message === 'Saved' ? 'text-green-600' : 'text-red-600'}`}>{message}</span>
          )}
        </div>
      </div>

      {loadError && (
        <div className="card border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Couldn&apos;t load integrations data: {loadError}
        </div>
      )}

      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Search providers..."
        className="w-full rounded-lg border border-ink-200 px-4 py-2 text-sm focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100"
      />

      {groups.map((cat) => {
        const list = filteredEngines
          .filter((e) => e.category === cat)
          .sort((a, b) => a.priority - b.priority);
        if (list.length === 0) return null;
        return (
          <section key={cat}>
            <div className="mb-3 flex items-center gap-2">
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-ink-400" fill="currentColor">
                <path d={CATEGORY_ICON[cat] || CATEGORY_ICON.search} />
              </svg>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
                {CATEGORY_LABEL[cat] || cat}
              </h3>
              <span className="text-sm text-ink-400">
                ({list.filter((e) => !prefs.disabled.includes(e.id)).length}/{list.length})
              </span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((e) => {
                const disabled = prefs.disabled.includes(e.id);
                const noKey = e.requiresKeys.length > 0 && !e.available;
                return (
                  <div
                    key={e.id}
                    className={`card relative flex flex-col p-4 transition-shadow hover:shadow-md ${
                      disabled ? 'opacity-60' : ''
                    }`}
                  >
                    {/* Toggle switch — top right */}
                    <button
                      onClick={() => toggle(e.id)}
                      disabled={saving || noKey}
                      title={noKey ? 'Add provider key first' : disabled ? 'Enable' : 'Disable'}
                      className={`absolute right-3 top-3 flex h-5 w-9 shrink-0 items-center rounded-full transition ${
                        !disabled && !noKey ? 'bg-brand-500' : 'bg-ink-200'
                      }`}
                    >
                      <span
                        className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${
                          !disabled && !noKey ? 'translate-x-4' : 'translate-x-0.5'
                        }`}
                      />
                    </button>

                    {/* Header: name + badges */}
                    <div className="pr-12">
                      <h4 className="font-semibold text-ink-900">{e.label}</h4>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className={`chip py-0 text-sm ${ACCESS_BADGE[e.accessType] || ''}`}>
                          {e.accessType}
                        </span>
                        <code className="text-sm text-ink-400">{e.id}</code>
                      </div>
                    </div>

                    {/* Description */}
                    {e.description && (
                      <p className="mt-2 line-clamp-2 text-sm text-ink-600">{e.description}</p>
                    )}

                    {/* Modalities */}
                    {e.modalities && e.modalities.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {e.modalities.map((m) => (
                          <span key={m} className="chip py-0.5 text-sm capitalize">{m}</span>
                        ))}
                      </div>
                    )}

                    {/* Crawl capabilities */}
                    {e.category === 'crawl' && (e.rendersJs || e.capabilities?.screenshot || e.capabilities?.pdf) && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {e.rendersJs && <span className="chip bg-sky-50 py-0.5 text-sm text-sky-700">renders JS</span>}
                        {e.capabilities?.screenshot && <span className="chip bg-sky-50 py-0.5 text-sm text-sky-700">screenshot</span>}
                        {e.capabilities?.pdf && <span className="chip bg-sky-50 py-0.5 text-sm text-sky-700">pdf</span>}
                      </div>
                    )}

                    {/* Footer: key status + docs */}
                    <div className="mt-auto pt-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className={noKey ? 'text-amber-600' : e.requiresKeys.length > 0 ? 'text-green-600' : 'text-ink-400'}>
                          {noKey ? (
                            <Link href="/dashboard/account" className="hover:underline">
                              Add key &rarr;
                            </Link>
                          ) : e.requiresKeys.length > 0 ? (
                            'Key configured ✓'
                          ) : (
                            'No key needed'
                          )}
                        </span>
                        {e.docsUrl && (
                          <a href={e.docsUrl} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                            Docs ↗
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

    </div>
  );
}
