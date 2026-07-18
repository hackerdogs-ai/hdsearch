'use client';

import { useCallback, useEffect, useState } from 'react';

interface Provider {
  id: string;
  name: string;
  description?: string;
  website?: string;
  docsUrl?: string;
  accessType: string;
  keyFields: string[];
  supportsStreaming: boolean;
  dynamic?: boolean;
  custom?: boolean;
}

const BLANK = {
  id: '',
  name: '',
  description: '',
  baseUrl: '',
  keyField: '',
  accessType: 'commercial',
  supportsStreaming: true,
};
type Form = typeof BLANK;

// Admin registry for LLM providers. Built-ins ship with the image and are read-only;
// anything added here is stored in S3 (SeaweedFS) and addressed as an
// OpenAI-compatible endpoint, so vLLM / LM Studio / DeepSeek / Together / etc. work.
export function ProviderRegistryManager() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [form, setForm] = useState<Form>(BLANK);
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await fetch('/api/panel/llm-providers').then((r) => r.json());
      setProviders(d.providers || []);
    } catch {
      setMsg({ kind: 'err', text: 'Could not load providers.' });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const startAdd = () => { setForm(BLANK); setEditing(false); setOpen(true); setMsg(null); };
  const startEdit = (p: Provider) => {
    setForm({
      id: p.id, name: p.name, description: p.description || '',
      baseUrl: '', keyField: p.keyFields?.[0] || p.id,
      accessType: p.accessType || 'commercial', supportsStreaming: p.supportsStreaming !== false,
    });
    setEditing(true); setOpen(true); setMsg(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.id.trim() || !form.name.trim() || !form.baseUrl.trim()) {
      setMsg({ kind: 'err', text: 'ID, name, and base URL are required.' });
      return;
    }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/panel/llm-providers', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form, keyField: form.keyField.trim() || form.id.trim() }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Save failed');
      setMsg({ kind: 'ok', text: `${editing ? 'Updated' : 'Added'} ${form.id}. Add its models below.` });
      setOpen(false); setForm(BLANK);
      await load();
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally { setBusy(false); }
  };

  const del = async (id: string) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/panel/llm-providers/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Delete failed');
      setMsg({ kind: 'ok', text: `Deleted ${id}.` });
      await load();
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-lg border border-ink-100 bg-white p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">LLM providers</h2>
          <p className="mt-0.5 text-sm text-ink-500">
            {providers.length} registered. Custom providers are stored in object storage and must expose an
            OpenAI-compatible API.
          </p>
        </div>
        <button type="button" onClick={startAdd} className="btn-primary text-sm">+ Add provider</button>
      </div>

      {msg && (
        <p className={`mt-3 rounded-md px-3 py-2 text-sm ${msg.kind === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {msg.text}
        </p>
      )}

      {open && (
        <form onSubmit={submit} className="mt-4 space-y-3 rounded-lg border border-ink-100 bg-ink-50/50 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Provider ID</span>
              <input className="input font-mono text-sm" value={form.id} disabled={editing}
                onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))} placeholder="deepseek" />
            </label>
            <label className="block">
              <span className="label">Display name</span>
              <input className="input" value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="DeepSeek" />
            </label>
            <label className="block sm:col-span-2">
              <span className="label">OpenAI-compatible base URL</span>
              <input className="input font-mono text-sm" value={form.baseUrl}
                onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} placeholder="https://api.deepseek.com/v1" />
            </label>
            <label className="block">
              <span className="label">Key field (credential name)</span>
              <input className="input font-mono text-sm" value={form.keyField}
                onChange={(e) => setForm((f) => ({ ...f, keyField: e.target.value }))} placeholder="defaults to the provider ID" />
            </label>
            <label className="block">
              <span className="label">Access type</span>
              <select className="input" value={form.accessType}
                onChange={(e) => setForm((f) => ({ ...f, accessType: e.target.value }))}>
                <option value="commercial">commercial</option>
                <option value="self-hosted">self-hosted</option>
                <option value="freemium">freemium</option>
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="label">Description</span>
              <input className="input" value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="optional" />
            </label>
          </div>
          <label className="flex items-center gap-1.5 text-sm text-ink-700">
            <input type="checkbox" checked={form.supportsStreaming}
              onChange={(e) => setForm((f) => ({ ...f, supportsStreaming: e.target.checked }))} />
            supports streaming
          </label>
          <div className="flex items-center gap-2">
            <button type="submit" disabled={busy} className="btn-primary text-sm disabled:opacity-50">
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Add provider'}
            </button>
            <button type="button" onClick={() => { setOpen(false); setForm(BLANK); }} className="btn-ghost text-sm">Cancel</button>
          </div>
          <p className="text-sm text-ink-400">
            After adding a provider, register its models below and add the API key under System keys.
          </p>
        </form>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink-100 text-ink-400">
              <th className="py-1.5 pr-2 font-medium">Provider</th>
              <th className="py-1.5 pr-2 font-medium">Key field</th>
              <th className="py-1.5 pr-2 font-medium">Type</th>
              <th className="py-1.5 pr-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p.id} className="border-b border-ink-50">
                <td className="py-1.5 pr-2">
                  <span className="font-medium text-ink-800">{p.name}</span>
                  <code className="ml-2 text-sm text-ink-400">{p.id}</code>
                  {p.custom && <span className="ml-2 chip bg-brand-50 py-0 text-sm text-brand-700">custom</span>}
                  {p.dynamic && <span className="ml-2 chip bg-sky-50 py-0 text-sm text-sky-700">auto-discovered</span>}
                </td>
                <td className="py-1.5 pr-2 font-mono text-sm text-ink-500">{p.keyFields?.join(', ') || '—'}</td>
                <td className="py-1.5 pr-2 text-ink-600">{p.accessType}</td>
                <td className="py-1.5 pr-2 text-right">
                  {p.custom ? (
                    <>
                      <button type="button" onClick={() => startEdit(p)} className="text-sm text-brand-600 hover:underline">Edit</button>
                      <button type="button" onClick={() => del(p.id)} disabled={busy} className="ml-3 text-sm text-red-600 hover:underline disabled:opacity-50">Delete</button>
                    </>
                  ) : (
                    <span className="text-sm text-ink-300">built-in</span>
                  )}
                </td>
              </tr>
            ))}
            {providers.length === 0 && (
              <tr><td colSpan={4} className="py-4 text-center text-ink-400">No providers registered.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
