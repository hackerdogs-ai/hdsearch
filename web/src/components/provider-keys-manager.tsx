'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FormSelect } from './form-select';
import { SecretInput } from './secret-input';

interface StoredKey {
  provider: string;
  field: string;
  masked: string;
  status: string;
  updatedAt: string;
}

interface ProviderOption {
  id: string;
  label: string;
  requiresKeys: string[];
}

type KeysCategory = 'search' | 'llm';

const CATEGORY_LABEL: Record<KeysCategory, string> = {
  search: 'Search',
  llm: 'LLM',
};

const CATEGORY_HELP: Record<KeysCategory, string> = {
  search: 'Your own keys for commercial search and crawl engines (SerpAPI, Brave, Tavily…). Stored encrypted (AES-256-GCM) and used only for your searches.',
  llm: 'Your own keys for LLM providers (Anthropic, OpenAI, Google…). Stored encrypted (AES-256-GCM) and used only for your AI Mode requests.',
};

function catalogFields(providers: ProviderOption[]): Set<string> {
  const out = new Set<string>();
  for (const p of providers) {
    out.add(p.id);
    for (const f of p.requiresKeys) out.add(f);
  }
  return out;
}

function keyInCategory(k: StoredKey, fields: Set<string>): boolean {
  return fields.has(k.field) || fields.has(k.provider);
}

function labelForKey(k: StoredKey, providers: ProviderOption[]): string {
  const byId = providers.find((p) => p.id === k.provider);
  if (byId) return byId.label;
  const byField = providers.find((p) => p.requiresKeys.includes(k.field));
  return byField?.label || k.provider;
}

function multiFieldForKey(k: StoredKey, providers: ProviderOption[]): boolean {
  const p = providers.find((x) => x.id === k.provider || x.requiresKeys.includes(k.field));
  return (p?.requiresKeys.length ?? 0) > 1;
}

export function ProviderKeysManager({
  initial,
  searchProviders,
  llmProviders,
  encryptionAvailable,
  initialCategory = 'search',
}: {
  initial: StoredKey[];
  searchProviders: ProviderOption[];
  llmProviders: ProviderOption[];
  encryptionAvailable: boolean;
  initialCategory?: KeysCategory;
}) {
  const router = useRouter();
  const [category, setCategory] = useState<KeysCategory>(initialCategory);

  const activeProviders = category === 'search' ? searchProviders : llmProviders;
  const activeFields = useMemo(() => catalogFields(activeProviders), [activeProviders]);

  const [provider, setProvider] = useState('');
  const [field, setField] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const first = activeProviders[0];
    setProvider(first?.id || '');
    setField(first?.requiresKeys[0] || first?.id || '');
    setSecret('');
    setError(null);
  }, [category, activeProviders]);

  const fieldsForProvider = activeProviders.find((e) => e.id === provider)?.requiresKeys || [provider];
  const multiField = fieldsForProvider.length > 1;
  const visibleKeys = initial.filter((k) => keyInCategory(k, activeFields));

  async function save() {
    if (!secret.trim() || !provider) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/panel/provider-keys', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider, field: field || provider, secret: secret.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'failed');
      setSecret('');
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(f: string) {
    if (!confirm(`Delete the ${f} credential?`)) return;
    await fetch(`/api/panel/provider-keys/${encodeURIComponent(f)}`, { method: 'DELETE' });
    router.refresh();
  }

  function onCategoryChange(next: KeysCategory) {
    setCategory(next);
    const url = new URL(window.location.href);
    if (next === 'search') url.searchParams.delete('keys');
    else url.searchParams.set('keys', 'llm');
    window.history.replaceState(null, '', url.pathname + url.search);
  }

  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-ink-900">Provider Keys</h2>
      <p className="mt-1 text-sm text-ink-500">{CATEGORY_HELP[category]}</p>

      {!encryptionAvailable && (
        <div className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Encryption isn’t configured on the API (set <code>HDSEARCH_ENCRYPTION_KEY</code>). Saving keys is disabled.
        </div>
      )}

      <div className="mt-4">
        <FormSelect
          label="Category"
          layout="inline"
          value={category}
          onChange={(e) => onCategoryChange(e.target.value as KeysCategory)}
        >
          {(Object.keys(CATEGORY_LABEL) as KeysCategory[]).map((c) => (
            <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
          ))}
        </FormSelect>
      </div>

      {activeProviders.length === 0 ? (
        <p className="mt-4 text-sm text-ink-400">No {CATEGORY_LABEL[category].toLowerCase()} providers require keys.</p>
      ) : (
        <div className={`mt-4 grid gap-2 ${multiField ? 'sm:grid-cols-[1fr_1fr_2fr_auto]' : 'sm:grid-cols-[1fr_2fr_auto]'}`}>
          <select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              const f = activeProviders.find((x) => x.id === e.target.value)?.requiresKeys[0] || e.target.value;
              setField(f);
            }}
            className="select w-full"
          >
            {activeProviders.map((e) => (
              <option key={e.id} value={e.id}>{e.label}</option>
            ))}
          </select>
          {multiField && (
            <select value={field} onChange={(e) => setField(e.target.value)} className="select w-full">
              {fieldsForProvider.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          )}
          <SecretInput
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Paste the secret"
            disabled={!encryptionAvailable}
          />
          <button onClick={save} disabled={busy || !encryptionAvailable} className="btn-primary btn-sm whitespace-nowrap">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-5 divide-y divide-ink-100">
        {visibleKeys.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-400">
            No {CATEGORY_LABEL[category].toLowerCase()} provider keys stored.
          </p>
        ) : (
          visibleKeys.map((k) => (
            <div key={k.field} className="flex items-center justify-between gap-3 py-3">
              <div>
                <span className="font-medium text-ink-900">{labelForKey(k, activeProviders)}</span>
                {multiFieldForKey(k, activeProviders) && (
                  <span className="ml-2 text-sm text-ink-400">field: {k.field}</span>
                )}
                <code className="ml-2 text-sm text-ink-500">{k.masked}</code>
              </div>
              <button onClick={() => remove(k.field)} className="text-sm text-red-600 hover:underline">Delete</button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
