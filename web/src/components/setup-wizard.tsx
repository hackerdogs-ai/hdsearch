'use client';

import { useCallback, useEffect, useState } from 'react';

type Svc = { key: string; label: string; required: boolean; url: string; accessKey?: string; provider?: string };
type Result = { reachable: boolean; ms?: number; detail?: string };
type Vals = Record<string, { url: string; accessKey?: string; secretKey?: string; provider?: string }>;

const DATASTORES = ['database', 'redis', 's3', 'embeddings'];
const PROVIDERS = ['searxng', 'openserp', 'crawl4ai', 'browserless', 'tor'];
/** Boot-snapshotted clients — changing these is what triggers a restart prompt. */
const RESTART_KEYS = ['database', 'redis', 's3', 'tor'] as const;
const HINT: Record<string, string> = {
  database: 'Postgres / TimescaleDB connection string.',
  redis: 'Redis (with the RediSearch module) — used for cache + vector search.',
  s3: 'S3-compatible object store (SeaweedFS / MinIO / AWS) for crawl archives + files.',
  embeddings: 'Embeddings server (MiniLM) for vector search & RAG.',
  searxng: 'Self-hosted meta-search.',
  openserp: 'Multi-engine SERP scraper.',
  crawl4ai: 'Crawler for the /crawl endpoint.',
  browserless: 'Headless Chrome for JS-rendered pages.',
  tor: 'Tor SOCKS proxy for .onion darkweb search (optional).',
};

/** First-run infrastructure setup, and (edit mode) the Settings config editor. */
export function SetupWizard({ edit = false }: { edit?: boolean }) {
  const [svcs, setSvcs] = useState<Svc[]>([]);
  const [vals, setVals] = useState<Vals>({});
  const [results, setResults] = useState<Record<string, Result | 'testing'>>({});
  const [step, setStep] = useState(edit ? 1 : 0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/setup/status', { cache: 'no-store' });
        const d = await r.json();
        const list: Svc[] = d.services || [];
        setSvcs(list);
        const v: Vals = {};
        for (const s of list) v[s.key] = { url: s.url || '', accessKey: s.accessKey, provider: s.provider };
        setVals(v);
      } catch { /* api down — user configures blind */ }
      setLoading(false);
    })();
  }, []);

  const test = useCallback(async (key: string) => {
    setResults((r) => ({ ...r, [key]: 'testing' }));
    try {
      const r = await fetch('/api/setup/test', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ service: key, url: vals[key]?.url }),
      });
      const d = await r.json();
      setResults((rs) => ({ ...rs, [key]: { reachable: !!d.reachable, ms: d.ms, detail: d.detail } }));
    } catch (e) {
      setResults((rs) => ({ ...rs, [key]: { reachable: false, detail: (e as Error).message } }));
    }
  }, [vals]);

  // auto-test the datastores when entering their step (so defaults pre-validate)
  useEffect(() => {
    if (loading) return;
    const keys = step === 1 ? DATASTORES : step === 2 ? PROVIDERS : [];
    keys.forEach((k) => { if (!results[k]) test(k); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, loading]);

  const req = (k: string) => svcs.find((s) => s.key === k)?.required;
  const ok = (k: string) => { const r = results[k]; return r && r !== 'testing' && r.reachable; };
  // datastores step proceeds when every REQUIRED service is reachable
  const canProceed = step !== 1 || DATASTORES.filter(req).every(ok);

  // Preview whether Review should warn about restart (DB/Redis/S3/Tor vs load-time values).
  const wouldNeedRestart = RESTART_KEYS.some((k) => {
    const initial = svcs.find((s) => s.key === k);
    const v = vals[k];
    if (!v || !initial) return false;
    if ((v.url || '').trim() !== (initial.url || '').trim()) return true;
    if (k === 's3' && (v.accessKey || '') !== (initial.accessKey || '')) return true;
    if (k === 's3' && v.secretKey) return true;
    return false;
  });

  const finish = async () => {
    setSaving(true);
    const payload: any = { complete: true };
    for (const k of [...DATASTORES, ...PROVIDERS]) {
      const v = vals[k]; if (!v) continue;
      payload[k] = { url: v.url, ...(v.accessKey ? { accessKey: v.accessKey } : {}), ...(v.secretKey ? { secretKey: v.secretKey } : {}), ...(v.provider ? { provider: v.provider } : {}) };
    }
    try {
      const r = await fetch('/api/setup/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      if (r.ok) {
        const d = await r.json().catch(() => ({}));
        setRestartRequired(!!d.restartRequired);
        setDone(true);
      }
    } finally { setSaving(false); }
  };

  const set = (k: string, field: string, value: string) => {
    setVals((v) => ({ ...v, [k]: { ...v[k], [field]: value } }));
    setResults((r) => ({ ...r, [k]: undefined as any })); // editing invalidates the last test
  };

  if (loading) return <div className="card p-8 text-center text-sm text-ink-400">Loading setup…</div>;

  if (done) return (
    <div className="card mx-auto w-full max-w-lg p-8 text-center">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-green-100 text-2xl text-green-700">✓</div>
      <h2 className="text-xl font-bold text-ink-900">{edit ? 'Configuration saved' : 'Setup complete'}</h2>
      {restartRequired ? (
        <>
          <p className="mt-2 text-sm text-ink-500">
            Endpoints saved. <strong>Restart the API</strong> to apply database, Redis, storage, or Tor changes:
          </p>
          <pre className="mt-3 overflow-x-auto rounded bg-ink-800 px-3 py-2 text-left text-sm text-white">docker restart hds-api</pre>
        </>
      ) : (
        <p className="mt-2 text-sm text-ink-500">
          {edit ? 'Endpoints saved. No API restart needed.' : 'Endpoints saved. You can continue to sign-in.'}
        </p>
      )}
      <a href={edit ? '/dashboard/admin' : '/login'} className="btn-primary mt-6 inline-block">
        {edit ? 'Back to admin' : 'Continue to sign-in →'}
      </a>
    </div>
  );

  const ServiceRow = ({ k }: { k: string }) => {
    const s = svcs.find((x) => x.key === k);
    const r = results[k];
    return (
      <div className="rounded-lg border border-ink-100 p-4">
        <div className="flex items-center justify-between gap-2">
          <label className="text-sm font-semibold text-ink-800">
            {s?.label || k} {s?.required ? <span className="text-red-500">*</span> : <span className="text-ink-400">(optional)</span>}
          </label>
          {r === 'testing' ? <span className="text-sm text-ink-400">testing…</span>
            : r ? (r.reachable ? <span className="chip bg-green-100 text-green-700">✓ reachable{r.ms != null ? ` · ${r.ms}ms` : ''}</span>
              : <span className="chip bg-red-100 text-red-700">✗ {r.detail || 'unreachable'}</span>) : null}
        </div>
        <p className="mt-0.5 text-sm text-ink-400">{HINT[k]}</p>
        <div className="mt-2 flex gap-2">
          <input className="input flex-1 font-mono text-sm" value={vals[k]?.url || ''} onChange={(e) => set(k, 'url', e.target.value)} placeholder={`${k} endpoint`} />
          <button onClick={() => test(k)} className="btn-ghost whitespace-nowrap text-sm">Test</button>
        </div>
        {k === 's3' && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input className="input text-sm" value={vals.s3?.accessKey || ''} onChange={(e) => set('s3', 'accessKey', e.target.value)} placeholder="access key" />
            <input className="input text-sm" type="password" value={vals.s3?.secretKey || ''} onChange={(e) => set('s3', 'secretKey', e.target.value)} placeholder="secret key (unchanged if blank)" />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="card w-full max-w-2xl p-8">
      {/* progress */}
      {!edit && (
        <div className="mb-6 flex items-center gap-2 text-sm">
          {['Welcome', 'Datastores', 'Providers', 'Review'].map((t, i) => (
            <div key={t} className="flex items-center gap-2">
              <span className={`grid h-6 w-6 place-items-center rounded-full text-sm ${i <= step ? 'bg-brand-500 text-white' : 'bg-ink-100 text-ink-400'}`}>{i + 1}</span>
              <span className={i === step ? 'font-semibold text-ink-900' : 'text-ink-400'}>{t}</span>
              {i < 3 && <span className="h-px w-6 bg-ink-200" />}
            </div>
          ))}
        </div>
      )}

      {step === 0 && (
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Welcome to HD-Search</h1>
          <p className="mt-2 text-sm text-ink-500">
            Let's connect HD-Search to your infrastructure. Defaults point at the bundled
            services on <code>hdsearchnet</code> — if you're running the full or infra stack,
            they'll already be reachable and you can click straight through. Running your own
            Postgres / Redis / storage? Enter their addresses and we'll verify each one.
          </p>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <h2 className="text-xl font-bold text-ink-900">Datastores</h2>
          <p className="text-sm text-ink-500">Required services (<span className="text-red-500">*</span>) must be reachable to continue.</p>
          {DATASTORES.map((k) => <ServiceRow key={k} k={k} />)}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <h2 className="text-xl font-bold text-ink-900">Search & crawl providers</h2>
          <p className="text-sm text-ink-500">All optional — HD-Search degrades gracefully if any is unavailable.</p>
          {PROVIDERS.map((k) => <ServiceRow key={k} k={k} />)}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <h2 className="text-xl font-bold text-ink-900">Review</h2>
          {[...DATASTORES, ...PROVIDERS].map((k) => (
            <div key={k} className="flex items-center justify-between border-b border-ink-100 py-1.5 text-sm">
              <span className="text-ink-500">{svcs.find((s) => s.key === k)?.label || k}</span>
              <span className="flex items-center gap-2">
                <code className="text-sm text-ink-400">{vals[k]?.url || '—'}</code>
                {ok(k) ? <span className="text-green-600">✓</span> : results[k] && results[k] !== 'testing' ? <span className="text-amber-500">?</span> : null}
              </span>
            </div>
          ))}
          {wouldNeedRestart && (
            <p className="pt-2 text-sm text-ink-400">
              Changing database, Redis, storage, or Tor requires an API restart to reconnect.
            </p>
          )}
        </div>
      )}

      {/* nav */}
      <div className="mt-8 flex items-center justify-between">
        <button onClick={() => setStep((s) => Math.max(edit ? 1 : 0, s - 1))} disabled={step === (edit ? 1 : 0)} className="btn-ghost text-sm disabled:opacity-40">← Back</button>
        {step < 3 ? (
          <button onClick={() => setStep((s) => s + 1)} disabled={!canProceed} className="btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-40"
            title={!canProceed ? 'Make the required services reachable to continue' : ''}>
            Next →
          </button>
        ) : (
          <button onClick={finish} disabled={saving} className="btn-primary text-sm disabled:opacity-50">{saving ? 'Saving…' : edit ? 'Save configuration' : 'Finish setup'}</button>
        )}
      </div>
    </div>
  );
}
