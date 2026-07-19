'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
// import { FormSelect } from './form-select';
import type { Engine } from './content/services-content';
// import { llmProviderLabel } from '@/lib/llm-provider-labels';

interface Prefs {
  disabled: string[];
  ranks: Record<string, number>;
}

/*
interface AiModel {
  id: string;
  provider: string;
  providerLabel?: string;
  label: string;
  inputPer1M: number;
  outputPer1M: number;
  accessType: string;
  requiresKeys: string[];
  available: boolean;
  defaultRank: number;
  capabilities?: { tools?: boolean; vision?: boolean; thinking?: boolean };
}

type RankingCategory = 'search' | 'llm';
*/

const LLM_RANK_PREFIX = 'llm:';

const ACCESS_BADGE: Record<string, string> = {
  free: 'bg-green-100 text-green-700',
  'self-hosted': 'bg-sky-100 text-sky-700',
  freemium: 'bg-amber-100 text-amber-700',
  commercial: 'bg-purple-100 text-purple-700',
};

const SEARCH_MODALITIES = ['web', 'news', 'images', 'videos', 'scholar', 'social', 'code', 'maps', 'archive', 'darkweb'] as const;

const MODALITY_LABEL: Record<string, string> = {
  web: 'Web', news: 'News', images: 'Images', videos: 'Videos',
  scholar: 'Scholar', social: 'Social', code: 'Code', maps: 'Maps',
  archive: 'Archive', darkweb: 'Dark Web',
  crawl: 'Crawlers',
};

/*
const CATEGORY_LABEL: Record<RankingCategory, string> = {
  search: 'Search',
  llm: 'LLM',
};
*/

function searchRankKey(modality: string, providerId: string): string {
  return `${modality}:${providerId}`;
}

function sortForModality(engines: Engine[], prefs: Prefs, modality: string): Engine[] {
  return [...engines].sort((a, b) => {
    const ra = prefs.ranks[searchRankKey(modality, a.id)] ?? prefs.ranks[a.id] ?? a.priority;
    const rb = prefs.ranks[searchRankKey(modality, b.id)] ?? prefs.ranks[b.id] ?? b.priority;
    return ra - rb;
  });
}

/*
function sortLlmModels(models: AiModel[], prefs: Prefs): AiModel[] {
  return [...models].sort((a, b) => {
    const ra = prefs.ranks[llmRankKey(a.id)] ?? a.defaultRank;
    const rb = prefs.ranks[llmRankKey(b.id)] ?? b.defaultRank;
    return ra - rb || a.label.localeCompare(b.label);
  });
}
*/

export function ProviderRanking({ engines }: { engines: Engine[] }) {
  const [prefs, setPrefs] = useState<Prefs>({ disabled: [], ranks: {} });
  // const [aiModels, setAiModels] = useState<AiModel[]>([]);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // const [category, setCategory] = useState<RankingCategory>('search');
  const [activeTab, setActiveTab] = useState<string>('web');
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragMod = useRef<string | null>(null);

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

    /*
    Promise.all([
      fetch('/api/panel/provider-prefs').then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'Failed to load provider preferences');
        return j;
      }),
      fetch('/api/ai/models').then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'Failed to load LLM models');
        return j;
      }),
    ])
      .then(([prefsData, modelsData]) => {
        if (prefsData.prefs) setPrefs(prefsData.prefs);
        if (modelsData.models) setAiModels(modelsData.models);
        setLoaded(true);
      })
      .catch((e) => {
        setLoadError((e as Error).message || 'Failed to load');
        setLoaded(true);
      });
    */
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

  const toggleEngine = useCallback((id: string) => {
    const next = { ...prefs };
    if (next.disabled.includes(id)) {
      next.disabled = next.disabled.filter((d) => d !== id);
    } else {
      next.disabled = [...next.disabled, id];
    }
    void save(next);
  }, [prefs, save]);

  /*
  const toggleModel = useCallback((id: string) => {
    const next = { ...prefs };
    if (next.disabled.includes(id)) {
      next.disabled = next.disabled.filter((d) => d !== id);
    } else {
      next.disabled = [...next.disabled, id];
    }
    void save(next);
  }, [prefs, save]);
  */

  const resetRanks = useCallback(() => {
    const next = { ...prefs, ranks: { ...prefs.ranks } };
    /*
    if (category === 'llm') {
      for (const k of Object.keys(next.ranks)) {
        if (k.startsWith(LLM_RANK_PREFIX)) delete next.ranks[k];
      }
    } else {
    */
    for (const k of Object.keys(next.ranks)) {
      if (!k.startsWith(LLM_RANK_PREFIX)) delete next.ranks[k];
    }
    // }
    void save(next);
  }, [prefs, save]);

  const handleSearchDrop = useCallback((modality: string) => {
    if (!dragId || !dragOverId || dragId === dragOverId) return;
    const pool = enginesForModality(engines, modality);
    const sorted = sortForModality(pool, prefs, modality);
    const ids = sorted.map((e) => e.id);
    const fromIdx = ids.indexOf(dragId);
    const toIdx = ids.indexOf(dragOverId);
    if (fromIdx < 0 || toIdx < 0) return;

    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, dragId);

    const next = { ...prefs, ranks: { ...prefs.ranks } };
    ids.forEach((id, i) => {
      next.ranks[searchRankKey(modality, id)] = i + 1;
    });
    void save(next);
  }, [dragId, dragOverId, engines, prefs, save]);

  /*
  const handleLlmDrop = useCallback(() => {
    if (!dragId || !dragOverId || dragId === dragOverId) return;
    const sorted = sortLlmModels(aiModels, prefs);
    const ids = sorted.map((m) => m.id);
    const fromIdx = ids.indexOf(dragId);
    const toIdx = ids.indexOf(dragOverId);
    if (fromIdx < 0 || toIdx < 0) return;

    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, dragId);

    const next = { ...prefs, ranks: { ...prefs.ranks } };
    ids.forEach((id, i) => {
      next.ranks[llmRankKey(id)] = i + 1;
    });
    void save(next);
  }, [aiModels, dragId, dragOverId, prefs, save]);
  */

  if (!loaded) return <div className="card p-6 text-sm text-ink-400">Loading ranking...</div>;

  const tabs = buildTabs(engines);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-ink-900">Provider Ranking</h2>
        <p className="mt-1 text-sm text-ink-500">
          Set search and crawl provider priority per modality. Drag to reorder — lower rank = tried first.{' '}
          <Link href="/dashboard/services" className="text-brand-600 hover:underline">
            Back to integrations
          </Link>
        </p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Search</h3>
        {/*
        <FormSelect
          label="Category"
          layout="inline"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value as RankingCategory);
            setDragId(null);
            setDragOverId(null);
            dragMod.current = null;
          }}
        >
          {(Object.keys(CATEGORY_LABEL) as RankingCategory[]).map((c) => (
            <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
          ))}
        </FormSelect>
        */}
        <div className="flex items-center gap-3">
          {message && (
            <span className={`text-sm ${message === 'Saved' ? 'text-green-600' : 'text-red-600'}`}>{message}</span>
          )}
          <button type="button" onClick={resetRanks} disabled={saving} className="btn-ghost btn-sm shrink-0">
            Reset
          </button>
        </div>
      </div>

      {loadError && (
        <div className="card border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Couldn&apos;t load provider preferences: {loadError}
        </div>
      )}

      <div className="flex flex-wrap gap-1 border-b border-ink-200">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-3 py-2 text-sm font-medium transition ${
                activeTab === t
                  ? 'border-b-2 border-brand-500 text-brand-700'
                  : 'text-ink-500 hover:text-ink-700'
              }`}
            >
              {MODALITY_LABEL[t] || t}
              <span className="ml-1 text-sm text-ink-400">
                ({enginesForModality(engines, t).length})
              </span>
            </button>
          ))}
        </div>

        <SearchRankingList
          engines={enginesForModality(engines, activeTab)}
          modality={activeTab}
          prefs={prefs}
          saving={saving}
          dragId={dragId}
          dragOverId={dragOverId}
          onDragStart={(id) => { setDragId(id); dragMod.current = activeTab; }}
          onDragEnd={() => { handleSearchDrop(activeTab); setDragId(null); setDragOverId(null); dragMod.current = null; }}
          onDragOver={(id) => { if (dragMod.current === activeTab) setDragOverId(id); }}
          onDragLeave={(id) => { if (dragOverId === id) setDragOverId(null); }}
          onToggle={toggleEngine}
      />

      {/*
      {category === 'search' ? (
        <>
          ...
        </>
      ) : (
        <LlmRankingList
          models={aiModels}
          loadError={loadError}
          prefs={prefs}
          saving={saving}
          dragId={dragId}
          dragOverId={dragOverId}
          onDragStart={(id) => { setDragId(id); dragMod.current = 'llm'; }}
          onDragEnd={() => { handleLlmDrop(); setDragId(null); setDragOverId(null); dragMod.current = null; }}
          onDragOver={(id) => { if (dragMod.current === 'llm') setDragOverId(id); }}
          onDragLeave={(id) => { if (dragOverId === id) setDragOverId(null); }}
          onToggle={toggleModel}
        />
      )}
      */}
    </div>
  );
}

function buildTabs(engines: Engine[]): string[] {
  const seen = new Set<string>();
  for (const e of engines) {
    if (e.modalities) {
      for (const m of e.modalities) seen.add(m);
    }
    if (e.category === 'crawl') seen.add('crawl');
  }
  const ordered: string[] = [];
  for (const m of SEARCH_MODALITIES) {
    if (seen.has(m)) ordered.push(m);
  }
  if (seen.has('crawl')) ordered.push('crawl');
  return ordered;
}

function enginesForModality(engines: Engine[], modality: string): Engine[] {
  if (modality === 'crawl') return engines.filter((e) => e.category === 'crawl');
  return engines.filter((e) => e.modalities?.includes(modality));
}

interface SearchRankingListProps {
  engines: Engine[];
  modality: string;
  prefs: Prefs;
  saving: boolean;
  dragId: string | null;
  dragOverId: string | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDragOver: (id: string) => void;
  onDragLeave: (id: string) => void;
  onToggle: (id: string) => void;
}

function SearchRankingList({ engines, modality, prefs, saving, dragId, dragOverId, onDragStart, onDragEnd, onDragOver, onDragLeave, onToggle }: SearchRankingListProps) {
  const sorted = sortForModality(engines, prefs, modality);

  if (sorted.length === 0) {
    return <div className="card p-8 text-center text-sm text-ink-400">No providers for this modality.</div>;
  }

  return (
    <div className="rounded-lg border border-ink-200 bg-white">
      {sorted.map((e, i) => {
        const disabled = prefs.disabled.includes(e.id);
        const noKey = e.requiresKeys.length > 0 && !e.available;
        const grayed = disabled || noKey;
        const isDragging = dragId === e.id;
        const isDragOver = dragOverId === e.id && dragId !== e.id;
        return (
          <RankingRow
            key={e.id}
            rank={i + 1}
            label={e.label}
            sublabel={e.id}
            accessType={e.accessType}
            grayed={grayed}
            isDragging={isDragging}
            isDragOver={isDragOver}
            bordered={i > 0}
            saving={saving}
            disabled={disabled}
            noKey={noKey}
            requiresKeys={e.requiresKeys.length > 0}
            onDragStart={() => onDragStart(e.id)}
            onDragEnd={onDragEnd}
            onDragOver={(ev) => { ev.preventDefault(); onDragOver(e.id); }}
            onDragLeave={() => onDragLeave(e.id)}
            onToggle={() => onToggle(e.id)}
          />
        );
      })}
    </div>
  );
}

/*
interface LlmRankingListProps {
  models: AiModel[];
  loadError: string | null;
  prefs: Prefs;
  saving: boolean;
  dragId: string | null;
  dragOverId: string | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDragOver: (id: string) => void;
  onDragLeave: (id: string) => void;
  onToggle: (id: string) => void;
}

function LlmRankingList({ models, loadError, prefs, saving, dragId, dragOverId, onDragStart, onDragEnd, onDragOver, onDragLeave, onToggle }: LlmRankingListProps) {
  const sorted = sortLlmModels(models, prefs);

  if (sorted.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-ink-400">
        {loadError ? (
          <>Couldn&apos;t load LLM models: {loadError}</>
        ) : (
          <>No LLM models configured.</>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-ink-200 bg-white">
      {sorted.map((m, i) => {
        const disabled = prefs.disabled.includes(m.id);
        const noKey = m.requiresKeys.length > 0 && !m.available;
        const grayed = disabled || noKey;
        const isDragging = dragId === m.id;
        const isDragOver = dragOverId === m.id && dragId !== m.id;
        const providerLabel = llmProviderLabel(m.provider, m.providerLabel);
        return (
          <RankingRow
            key={m.id}
            rank={i + 1}
            label={m.label}
            sublabel={`${providerLabel} · ${m.id}`}
            accessType={m.accessType}
            grayed={grayed}
            isDragging={isDragging}
            isDragOver={isDragOver}
            bordered={i > 0}
            saving={saving}
            disabled={disabled}
            noKey={noKey}
            requiresKeys={m.requiresKeys.length > 0}
            meta={`${(m.contextTokens / 1000).toFixed(0)}K context`}
            onDragStart={() => onDragStart(m.id)}
            onDragEnd={onDragEnd}
            onDragOver={(ev) => { ev.preventDefault(); onDragOver(m.id); }}
            onDragLeave={() => onDragLeave(m.id)}
            onToggle={() => onToggle(m.id)}
          />
        );
      })}
    </div>
  );
}
*/

interface RankingRowProps {
  rank: number;
  label: string;
  sublabel: string;
  accessType: string;
  grayed: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  bordered: boolean;
  saving: boolean;
  disabled: boolean;
  noKey: boolean;
  requiresKeys: boolean;
  meta?: string;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (ev: React.DragEvent) => void;
  onDragLeave: () => void;
  onToggle: () => void;
}

function RankingRow({
  rank, label, sublabel, accessType, grayed, isDragging, isDragOver, bordered, saving,
  disabled, noKey, requiresKeys, meta, onDragStart, onDragEnd, onDragOver, onDragLeave, onToggle,
}: RankingRowProps) {
  return (
    <div
      draggable={!saving}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      className={`flex items-center gap-3 px-4 py-3 ${
        bordered ? 'border-t border-ink-100' : ''
      } ${grayed ? 'opacity-50' : ''} ${
        isDragging ? 'bg-brand-50 opacity-70' : ''
      } ${isDragOver ? 'border-t-2 border-t-brand-500' : ''} cursor-grab active:cursor-grabbing`}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-100 text-sm font-bold text-ink-600">
        {rank}
      </span>

      <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-ink-300" fill="currentColor">
        <circle cx="9" cy="6" r="1.5" />
        <circle cx="15" cy="6" r="1.5" />
        <circle cx="9" cy="12" r="1.5" />
        <circle cx="15" cy="12" r="1.5" />
        <circle cx="9" cy="18" r="1.5" />
        <circle cx="15" cy="18" r="1.5" />
      </svg>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-ink-900">{label}</span>
          <span className={`chip py-0 text-sm ${ACCESS_BADGE[accessType] || ''}`}>
            {accessType}
          </span>
        </div>
        <code className="text-sm text-ink-400">{sublabel}</code>
      </div>

      <div className="shrink-0 text-sm text-right">
        {meta && <div className="text-ink-400">{meta}</div>}
        {noKey ? (
          <Link href="/dashboard/account?keys=llm" className="text-amber-600 hover:underline">
            Add key &rarr;
          </Link>
        ) : requiresKeys ? (
          <span className="text-green-600">Key ✓</span>
        ) : (
          <span className="text-ink-400">Free</span>
        )}
      </div>

      <button
        onClick={(ev) => { ev.stopPropagation(); onToggle(); }}
        disabled={saving || noKey}
        title={noKey ? 'Add provider key first' : disabled ? 'Enable' : 'Disable'}
        className={`flex h-5 w-9 shrink-0 items-center rounded-full transition ${
          !disabled && !noKey ? 'bg-brand-500' : 'bg-ink-200'
        }`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${
            !disabled && !noKey ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}
