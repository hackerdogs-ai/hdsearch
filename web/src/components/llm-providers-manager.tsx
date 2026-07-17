'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { llmProviderLabel } from '@/lib/llm-provider-labels';

interface Prefs {
  disabled: string[];
  ranks: Record<string, number>;
}

interface AiModel {
  id: string;
  provider: string;
  providerLabel?: string;
  label: string;
  contextTokens: number;
  maxOutputTokens: number;
  inputPer1M: number;
  outputPer1M: number;
  capabilities: { tools: boolean; vision: boolean; thinking: boolean; streaming: boolean };
  accessType: string;
  requiresKeys: string[];
  available: boolean;
}

const ACCESS_BADGE: Record<string, string> = {
  free: 'bg-green-100 text-green-700',
  'self-hosted': 'bg-sky-100 text-sky-700',
  freemium: 'bg-amber-100 text-amber-700',
  commercial: 'bg-purple-100 text-purple-700',
};

export function LlmProvidersManager() {
  const [prefs, setPrefs] = useState<Prefs>({ disabled: [], ranks: {} });
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [aiModels, setAiModels] = useState<AiModel[]>([]);
  const [aiPlan, setAiPlan] = useState<string>('');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    Promise.all([
      fetch('/api/panel/provider-prefs').then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'Failed to load provider preferences');
        return j;
      }),
      fetch('/api/ai/models?catalog=1').then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'Failed to load LLM models');
        return j;
      }),
    ])
      .then(([prefsData, modelsData]) => {
        if (prefsData.prefs) setPrefs(prefsData.prefs);
        if (modelsData.models) setAiModels(modelsData.models);
        if (modelsData.plan) setAiPlan(modelsData.plan);
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

  if (!loaded) return <div className="card p-6 text-sm text-ink-400">Loading LLM providers...</div>;

  const q = filter.toLowerCase();
  const filteredModels = q
    ? aiModels.filter(
        (m) =>
          m.label.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q) ||
          m.provider.toLowerCase().includes(q),
      )
    : aiModels;
  const enabledLlm = filteredModels.filter((m) => !prefs.disabled.includes(m.id)).length;

  const byProvider = new Map<string, AiModel[]>();
  for (const m of filteredModels) {
    const g = byProvider.get(m.provider) || [];
    g.push(m);
    byProvider.set(m.provider, g);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">LLM Providers</h2>
          <p className="mt-1 text-sm text-ink-500">
            {enabledLlm} of {filteredModels.length} models enabled{aiPlan ? ` (${aiPlan} plan)` : ''}.
            Toggle models on or off for AI Search. Pick your active model from the dropdown in AI Search.{' '}
            <Link href="/dashboard/services" className="text-brand-600 hover:underline">
              Back to integrations
            </Link>
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
          Couldn&apos;t load LLM providers: {loadError}
        </div>
      )}

      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Search models..."
        className="w-full rounded-lg border border-ink-200 px-4 py-2 text-sm focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100"
      />

      {filteredModels.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-400">No LLM models match your search.</div>
      ) : (
        Array.from(byProvider.entries()).map(([providerId, models]) => (
          <section key={providerId}>
            <div className="mb-3 flex items-center gap-2">
              <span className="chip bg-indigo-100 py-0.5 text-sm text-indigo-700">
                {llmProviderLabel(providerId, models[0]?.providerLabel)}
              </span>
              <span className="text-sm text-ink-400">
                ({models.filter((m) => !prefs.disabled.includes(m.id)).length}/{models.length})
              </span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {models.map((m) => {
                const disabled = prefs.disabled.includes(m.id);
                const noKey = m.requiresKeys.length > 0 && !m.available;
                return (
                  <div
                    key={m.id}
                    className={`card relative flex flex-col p-4 transition-shadow hover:shadow-md ${
                      disabled ? 'opacity-60' : ''
                    }`}
                  >
                    <button
                      onClick={() => toggle(m.id)}
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

                    <div className="pr-12">
                      <h4 className="font-semibold text-ink-900">{m.label}</h4>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className={`chip py-0 text-sm ${ACCESS_BADGE[m.accessType] || ''}`}>
                          {m.accessType}
                        </span>
                        <code className="text-sm text-ink-400">{m.id}</code>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1">
                      {m.capabilities.tools && <span className="chip bg-sky-50 py-0.5 text-sm text-sky-700">tools</span>}
                      {m.capabilities.vision && <span className="chip bg-sky-50 py-0.5 text-sm text-sky-700">vision</span>}
                      {m.capabilities.thinking && <span className="chip bg-sky-50 py-0.5 text-sm text-sky-700">thinking</span>}
                      {m.capabilities.streaming && <span className="chip bg-sky-50 py-0.5 text-sm text-sky-700">streaming</span>}
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-1 text-sm text-ink-500">
                      <span>Context: {(m.contextTokens / 1000).toFixed(0)}K</span>
                      <span>Output: {(m.maxOutputTokens / 1000).toFixed(0)}K</span>
                      <span>In: ${m.inputPer1M}/1M</span>
                      <span>Out: ${m.outputPer1M}/1M</span>
                    </div>

                    <div className="mt-auto pt-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className={m.available ? 'text-green-600' : 'text-amber-600'}>
                          {m.available ? (
                            'Available ✓'
                          ) : m.requiresKeys.length > 0 ? (
                            <Link href="/dashboard/account?keys=llm" className="hover:underline">
                              Add key &rarr;
                            </Link>
                          ) : (
                            'Unavailable'
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
