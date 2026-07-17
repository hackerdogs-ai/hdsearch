'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { clearNewApiKey } from '@/app/dashboard/account/actions';

interface KeyRecord {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  status: string;
  createdAt: string;
  lastUsedAt?: string;
}

export function ApiKeysManager({ initial, initialNewKey }: { initial: KeyRecord[]; initialNewKey?: string }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(initialNewKey ?? null);
  const [error, setError] = useState<string | null>(null);
  const cleared = useRef(false);

  useEffect(() => {
    if (initialNewKey && !cleared.current) {
      cleared.current = true;
      clearNewApiKey();
    }
  }, [initialNewKey]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/panel/api-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'failed');
      setCreated(data.key);
      setName('');
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm('Revoke this key? Apps using it will stop working immediately.')) return;
    await fetch(`/api/panel/api-keys/${id}`, { method: 'DELETE' });
    router.refresh();
  }

  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-ink-900">API Keys</h2>
      <p className="mt-1 text-sm text-ink-500">Keys for calling the hdsearch API. The full key is shown once at creation.</p>

      {created && (
        <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50 p-4">
          <p className="text-sm font-medium text-brand-800">Your new key — copy it now, it won’t be shown again:</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded bg-white px-3 py-2 text-sm">{created}</code>
            <button className="btn-ghost" onClick={() => navigator.clipboard.writeText(created)}>Copy</button>
            <button className="btn-ghost" onClick={() => setCreated(null)}>Done</button>
          </div>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Key name (e.g. production)" className="input" />
        <button onClick={create} disabled={busy} className="btn-primary whitespace-nowrap">
          {busy ? 'Creating…' : 'Create key'}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-5 divide-y divide-ink-100">
        {initial.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-400">No API keys yet.</p>
        ) : (
          initial.map((k) => (
            <div key={k.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink-900">{k.name}</span>
                  {k.status !== 'active' && <span className="chip bg-red-100 py-0.5 text-red-700">{k.status}</span>}
                </div>
                <code className="text-sm text-ink-400">{k.keyPrefix}…</code>
                <span className="ml-2 text-sm text-ink-400">
                  created {new Date(k.createdAt).toLocaleDateString()} · {k.lastUsedAt ? `used ${new Date(k.lastUsedAt).toLocaleDateString()}` : 'never used'}
                </span>
              </div>
              {k.status === 'active' && (
                <button onClick={() => revoke(k.id)} className="text-sm text-red-600 hover:underline">Revoke</button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
