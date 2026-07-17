// Shared Integrations body — renders the engine catalogue grouped by category. The
// page fetches engines (dashboard: as the user; public: as the demo identity) and
// passes them in.
export interface Engine {
  id: string;
  label: string;
  category: string;
  accessType: string;
  modalities?: string[];
  priority: number;
  enabled: boolean;
  requiresKeys: string[];
  available?: boolean;
  docsUrl?: string;
  endpoint?: string;
  description?: string;
  rendersJs?: boolean;
  capabilities?: { screenshot?: boolean; pdf?: boolean };
}

const ACCESS_BADGE: Record<string, string> = {
  free: 'bg-green-100 text-green-700',
  'self-hosted': 'bg-sky-100 text-sky-700',
  freemium: 'bg-amber-100 text-amber-700',
  commercial: 'bg-purple-100 text-purple-700',
};

export function ServicesContent({ engines, error }: { engines: Engine[]; error?: string | null }) {
  const groups = ['search', 'darkweb', 'crawl'] as const;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Integrations</h1>
        <p className="mt-1 text-sm text-ink-500">
          Engines available through hdsearch, in priority order. You always call the hdsearch API and pass the
          engine <code>id</code> — the providers are abstracted, so you never call them directly. By default the best
          engine is chosen by priority with automatic fallback. Free &amp; self-hosted are tried first; commercial
          engines need a key under <span className="font-medium">Account → Provider keys</span>.
        </p>
      </div>

      {error && <div className="card border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Couldn’t load integrations ({error}).</div>}

      {groups.map((g) => {
        const list = engines.filter((e) => e.category === g);
        if (list.length === 0) return null;
        return (
          <section key={g}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">{g}</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {list.map((e) => (
                <div key={e.id} className="card p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate font-semibold text-ink-900">{e.label}</h3>
                        <span className={`chip py-0.5 ${ACCESS_BADGE[e.accessType] || ''}`}>{e.accessType}</span>
                      </div>
                      <code className="text-sm text-ink-400">{e.id}</code>
                    </div>
                    <span className="chip shrink-0 py-0.5">#{e.priority}</span>
                  </div>
                  {e.description && <p className="mt-2 text-sm text-ink-600">{e.description}</p>}
                  {e.modalities && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {e.modalities.map((m) => (<span key={m} className="chip py-0.5 text-sm capitalize">{m}</span>))}
                    </div>
                  )}
                  {g === 'crawl' && (e.rendersJs || e.capabilities?.screenshot || e.capabilities?.pdf) && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {e.rendersJs && <span className="chip bg-sky-50 py-0.5 text-sm text-sky-700">renders JS</span>}
                      {e.capabilities?.screenshot && <span className="chip bg-sky-50 py-0.5 text-sm text-sky-700">screenshot</span>}
                      {e.capabilities?.pdf && <span className="chip bg-sky-50 py-0.5 text-sm text-sky-700">pdf</span>}
                    </div>
                  )}
                  {/* Abstracted usage — call hdsearch with this engine id; the provider
                      itself is never called directly by the user. */}
                  <div className="mt-2 rounded bg-ink-50 px-2 py-1.5 text-sm text-ink-600">
                    <span className="text-ink-400">Use via the API:&nbsp;</span>
                    <code className="break-all">
                      {g === 'crawl'
                        ? `POST /v1/crawl { "engine": "${e.id}", "url": "…" }`
                        : `POST /v1/search { "engine": "${e.id}", "q": "…" }`}
                    </code>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className={e.available ? 'text-green-600' : 'text-ink-400'}>
                      {e.requiresKeys.length === 0 ? 'No key required' : e.available ? 'Key configured ✓' : `Needs: ${e.requiresKeys.join(', ')}`}
                    </span>
                    {e.docsUrl && (
                      <a href={e.docsUrl} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">Provider docs ↗</a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
