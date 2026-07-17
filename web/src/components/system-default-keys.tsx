'use client';

import { useCallback, useEffect, useState } from 'react';
import { SecretInput } from './secret-input';
import { llmProviderLabel } from '@/lib/llm-provider-labels';

interface DefaultKey {
  id: number;
  provider: string;
  field: string;
  planId: string;
  masked: string;
  label: string | null;
  status: string;
  createdBy: string;
  updatedAt: string;
}

const PLANS = ['free', 'dev', 'devtest', 'production', 'enterprise'] as const;

const LLM_PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic', field: 'anthropic' },
  { id: 'openai', name: 'OpenAI', field: 'openai' },
  { id: 'xai', name: 'xAI (Grok)', field: 'xai' },
  { id: 'google', name: 'Google', field: 'google' },
  { id: 'aws_bedrock', name: 'AWS Bedrock', field: 'aws_access_key' },
  { id: 'azure', name: 'Azure OpenAI', field: 'azure_openai' },
  { id: 'openrouter', name: 'OpenRouter', field: 'openrouter' },
  { id: 'groq', name: 'Groq', field: 'groq' },
  { id: 'mistral', name: 'Mistral AI', field: 'mistral' },
];

const PLAN_BADGE: Record<string, string> = {
  free: 'bg-green-100 text-green-700',
  dev: 'bg-sky-100 text-sky-700',
  devtest: 'bg-amber-100 text-amber-700',
  production: 'bg-purple-100 text-purple-700',
  enterprise: 'bg-pink-100 text-pink-700',
};

export function SystemDefaultKeys() {
  const [keys, setKeys] = useState<DefaultKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [formProvider, setFormProvider] = useState(LLM_PROVIDERS[0]!.id);
  const [formPlan, setFormPlan] = useState<string>('free');
  const [formSecret, setFormSecret] = useState('');
  const [formLabel, setFormLabel] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/panel/admin-keys');
      const d = await r.json();
      if (d.keys) setKeys(d.keys);
    } catch {
      setMessage({ text: 'Failed to load keys', ok: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const flash = (text: string, ok: boolean) => {
    setMessage({ text, ok });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleSave = async () => {
    if (!formSecret.trim()) return;
    const prov = LLM_PROVIDERS.find((p) => p.id === formProvider);
    if (!prov) return;
    setSaving(true);
    try {
      const res = await fetch('/api/panel/admin-keys', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: prov.id,
          field: prov.field,
          planId: formPlan,
          secret: formSecret,
          label: formLabel || undefined,
        }),
      });
      if (res.ok) {
        flash('Default key saved', true);
        setFormSecret('');
        setFormLabel('');
        setShowForm(false);
        await load();
      } else {
        const d = await res.json().catch(() => ({}));
        flash(d.error || 'Save failed', false);
      }
    } catch {
      flash('Save failed', false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (field: string, planId: string) => {
    if (!confirm(`Delete the default ${field} key for ${planId} plan?`)) return;
    setSaving(true);
    try {
      const res = await fetch('/api/panel/admin-keys', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ field, planId }),
      });
      if (res.ok) {
        flash('Key deleted', true);
        await load();
      } else {
        flash('Delete failed', false);
      }
    } catch {
      flash('Delete failed', false);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="card p-6 text-sm text-ink-400">Loading system keys...</div>;

  const grouped = new Map<string, DefaultKey[]>();
  for (const k of keys) {
    const g = grouped.get(k.provider) || [];
    g.push(k);
    grouped.set(k.provider, g);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-ink-900">Default Provider Keys</h2>
          <p className="mt-1 text-sm text-ink-500">
            System-level API keys assigned per plan tier. Users without their own key
            automatically use the default for their plan. Keys are encrypted at rest (AES-256-GCM).
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {message && (
            <span className={`whitespace-nowrap text-sm ${message.ok ? 'text-green-600' : 'text-red-600'}`}>{message.text}</span>
          )}
          <button onClick={() => setShowForm(!showForm)} className="btn-primary whitespace-nowrap text-sm">
            {showForm ? 'Cancel' : '+ Add Key'}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="card space-y-4 border-2 border-brand-200 p-5">
          <h3 className="font-semibold text-ink-900">Add / Update Default Key</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-700">Provider</label>
              <select
                value={formProvider}
                onChange={(e) => setFormProvider(e.target.value)}
                className="w-full rounded border border-ink-200 px-3 py-2 text-sm"
              >
                {LLM_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.field})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-700">Plan Tier</label>
              <select
                value={formPlan}
                onChange={(e) => setFormPlan(e.target.value)}
                className="w-full rounded border border-ink-200 px-3 py-2 text-sm"
              >
                {PLANS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink-700">API Key</label>
            <SecretInput
              value={formSecret}
              onChange={(e) => setFormSecret(e.target.value)}
              placeholder="sk-ant-... or similar"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink-700">Label (optional)</label>
            <input
              type="text"
              value={formLabel}
              onChange={(e) => setFormLabel(e.target.value)}
              placeholder="e.g. Production Anthropic key"
              className="w-full rounded border border-ink-200 px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !formSecret.trim()}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Default Key'}
          </button>
        </div>
      )}

      {keys.length === 0 && !showForm ? (
        <div className="card p-8 text-center text-sm text-ink-400">
          No default keys configured yet. Click "+ Add Key" to assign a default provider key to a plan tier.
        </div>
      ) : (
        <div className="space-y-4">
          {Array.from(grouped.entries()).map(([provider, provKeys]) => (
            <div key={provider} className="card overflow-hidden">
              <div className="border-b border-ink-100 bg-ink-50 px-4 py-2.5">
                <h3 className="text-sm font-semibold text-ink-700">
                  {LLM_PROVIDERS.find((p) => p.id === provider)?.name || llmProviderLabel(provider)}
                </h3>
              </div>
              <div className="divide-y divide-ink-100">
                {provKeys.map((k) => (
                  <div key={`${k.field}-${k.planId}`} className="flex items-center gap-3 px-4 py-3">
                    <span className={`chip py-0.5 text-sm ${PLAN_BADGE[k.planId] || ''}`}>
                      {k.planId}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <code className="text-sm text-ink-500">{k.field}</code>
                        {k.label && <span className="text-sm text-ink-400">— {k.label}</span>}
                      </div>
                      <div className="mt-0.5 text-sm text-ink-400">
                        <span className="font-mono">{k.masked}</span>
                        {' · '}
                        <span>Updated {new Date(k.updatedAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <span className={`chip py-0 text-sm ${k.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-ink-100 text-ink-500'}`}>
                      {k.status}
                    </span>
                    <button
                      onClick={() => handleDelete(k.field, k.planId)}
                      disabled={saving}
                      className="text-sm text-red-500 hover:text-red-700 hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card bg-ink-50 p-4">
        <h3 className="text-sm font-semibold text-ink-700">Key Resolution Order</h3>
        <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-ink-600">
          <li><strong>Per-user key</strong> — User's own encrypted key (highest priority)</li>
          <li><strong>Plan default key</strong> — System key for the user's plan tier (set here)</li>
          <li><strong>Dev fallback</strong> — Environment variable (.env), only in dev mode</li>
        </ol>
      </div>
    </div>
  );
}
