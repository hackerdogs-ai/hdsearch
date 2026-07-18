'use client';

import { useCallback, useEffect, useState } from 'react';

interface Smtp {
  host: string;
  port: number;
  user: string;
  from: string;
  secure: boolean;
  hasPassword: boolean;
}

/**
 * Admin SMTP configuration. Turning this on unlocks password reset and
 * magic-link sign-in for every user. The password is written once and stored
 * AES-256-GCM encrypted — it is never sent back to the browser.
 */
export function EmailSettings() {
  const [smtp, setSmtp] = useState<Smtp | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [password, setPassword] = useState('');
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await fetch('/api/panel/email').then((r) => r.json());
      if (d.smtp) setSmtp(d.smtp);
      setEnabled(!!d.enabled);
    } catch {
      setMsg({ kind: 'err', text: 'Could not load email settings.' });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const set = <K extends keyof Smtp>(k: K, v: Smtp[K]) =>
    setSmtp((s) => (s ? { ...s, [k]: v } : s));

  async function save() {
    if (!smtp) return;
    setBusy(true);
    setMsg(null);
    try {
      const body: Record<string, unknown> = {
        host: smtp.host, port: Number(smtp.port), user: smtp.user, from: smtp.from, secure: smtp.secure,
      };
      // Only send the password when the admin typed one — omitting it keeps the stored value.
      if (password) body.password = password;
      const r = await fetch('/api/panel/email', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Save failed');
      setPassword('');
      setMsg({ kind: 'ok', text: 'Email settings saved.' });
      await load();
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally { setBusy(false); }
  }

  async function test() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/panel/email', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(testTo ? { to: testTo } : {}),
      });
      const d = await r.json().catch(() => ({}));
      setMsg(d.ok ? { kind: 'ok', text: d.message || 'SMTP verified.' } : { kind: 'err', text: d.error || 'Test failed.' });
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally { setBusy(false); }
  }

  if (!smtp) return <div className="rounded-lg border border-ink-100 bg-white p-4 text-sm text-ink-400">Loading email settings…</div>;

  return (
    <div className="rounded-lg border border-ink-100 bg-white p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">Email (SMTP)</h2>
          <p className="mt-0.5 text-sm text-ink-500">
            {enabled
              ? 'Configured — password reset and sign-in links are available to users.'
              : 'Not configured. Set a host and From address to enable password reset and sign-in links.'}
          </p>
        </div>
        <span className={`chip py-0 text-sm ${enabled ? 'bg-green-100 text-green-700' : 'bg-ink-100 text-ink-500'}`}>
          {enabled ? 'enabled' : 'off'}
        </span>
      </div>

      {msg && (
        <p className={`mt-3 rounded-md px-3 py-2 text-sm ${msg.kind === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {msg.text}
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">SMTP host</span>
          <input className="input font-mono text-sm" value={smtp.host}
            onChange={(e) => set('host', e.target.value)} placeholder="smtp.example.com" />
        </label>
        <label className="block">
          <span className="label">Port</span>
          <input type="number" className="input" value={smtp.port}
            onChange={(e) => set('port', Number(e.target.value) as Smtp['port'])} placeholder="587" />
        </label>
        <label className="block">
          <span className="label">Username</span>
          <input className="input" value={smtp.user}
            onChange={(e) => set('user', e.target.value)} placeholder="optional for open relays" autoComplete="off" />
        </label>
        <label className="block">
          <span className="label">Password</span>
          <input type="password" className="input" value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={smtp.hasPassword ? '•••••••• (stored — leave blank to keep)' : 'optional'}
            autoComplete="new-password" />
        </label>
        <label className="block sm:col-span-2">
          <span className="label">From address</span>
          <input className="input" value={smtp.from}
            onChange={(e) => set('from', e.target.value)} placeholder="hdsearch@example.com" />
        </label>
      </div>

      <label className="mt-3 flex items-center gap-1.5 text-sm text-ink-700">
        <input type="checkbox" checked={smtp.secure} onChange={(e) => set('secure', e.target.checked)} />
        Use TLS on connect (port 465). Leave off for STARTTLS on 587.
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={busy} className="btn-primary text-sm disabled:opacity-50">
          {busy ? 'Working…' : 'Save settings'}
        </button>
        <input className="input max-w-[16rem] text-sm" value={testTo}
          onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com (optional)" />
        <button type="button" onClick={test} disabled={busy} className="btn-ghost text-sm disabled:opacity-50">
          Test connection
        </button>
      </div>
      <p className="mt-2 text-sm text-ink-400">
        Leave the test address blank to only verify the connection. Settings here override
        the <code>SMTP_*</code> environment variables.
      </p>
    </div>
  );
}
