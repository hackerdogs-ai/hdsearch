import Link from 'next/link';
import { CodeBlock } from '@/components/code-block';
import { CodeTabs } from '@/components/code-tabs';
import { searchSnippets, crawlSnippets, vectorSnippets, engineSnippets, listEnginesSnippet } from '@/lib/snippets';

// Shared developer-docs body. Used by both the public /docs page and the
// dashboard Documentation page. `apiHref` points at the interactive reference
// (public /api or /dashboard/api-reference).
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8791';

const ENDPOINTS = [
  { m: 'POST', p: '/v1/search', d: 'Aggregated search. Body: q, modality, engine?, mode(fallback|aggregate), limit, page, country?, lang?, freshness?, facets, noCache, ttl? (sec; admin default if omitted or above hard max).' },
  { m: 'POST', p: '/v1/search/vector', d: 'Semantic KNN over a namespace. Body: q, namespace, k, groundWithWeb.' },
  { m: 'POST', p: '/v1/search/vector/index', d: 'Embed + index documents. Body: documents[], namespace, ttl (default 24h).' },
  { m: 'POST', p: '/v1/crawl', d: 'Crawl a URL. Body: url, engine?, formats[](markdown|text|html|links|images|screenshot|pdf), render, store. screenshot/pdf return data URLs.' },
  { m: 'GET', p: '/v1/archive', d: 'Fetch a web-archive capture (the archived page, not the live site). Query: provider(wayback|commoncrawl), url, ts, format(json|html). Returns markdown/text or the archived HTML.' },
  { m: 'GET/DELETE', p: '/v1/history', d: 'Your search history — a 3-day Redis window plus a durable S3 archive. DELETE clears it.' },
  { m: 'GET', p: '/v1/engines', d: 'List engines. Query: category(search|crawl|darkweb), modality.' },
  { m: 'GET', p: '/v1/account', d: 'Profile, plan and current monthly usage.' },
  { m: 'GET', p: '/openapi.json', d: 'Full OpenAPI 3.1 spec.' },
];
const MODALITIES = ['web', 'news', 'images', 'videos', 'maps', 'scholar', 'shopping', 'code', 'social', 'archive', 'darkweb'];

export function DocsContent({ apiHref = '/api' }: { apiHref?: string }) {
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Documentation</h1>
          <p className="mt-1 text-sm text-ink-500">How to call the search, crawl and vector APIs.</p>
        </div>
        <Link href={apiHref} className="btn-primary">Interactive API Reference →</Link>
      </div>

      <section className="card p-6">
        <h2 className="text-lg font-semibold text-ink-900">Authentication</h2>
        <p className="mt-1 text-sm text-ink-600">
          All endpoints require an API key (create one under Account → API Keys). Pass it as a bearer token.
        </p>
        <div className="mt-3"><CodeBlock code={`Authorization: Bearer sk-hds-...`} lang="http" /></div>
      </section>

      <section className="card p-6">
        <h2 className="text-lg font-semibold text-ink-900">Endpoints</h2>
        <ul className="mt-3 divide-y divide-ink-100">
          {ENDPOINTS.map((e) => (
            <li key={e.p} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:gap-4">
              <span className="flex shrink-0 items-baseline gap-2">
                <span className={`chip py-0.5 ${e.m === 'GET' ? 'bg-sky-100 text-sky-700' : 'bg-brand-100 text-brand-700'}`}>{e.m}</span>
                <code className="text-sm font-medium text-ink-900">{e.p}</code>
              </span>
              <span className="text-sm text-ink-500">{e.d}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card p-6">
        <h2 className="text-lg font-semibold text-ink-900">Modalities</h2>
        <p className="mt-1 text-sm text-ink-600">Pass <code>modality</code> to target a content type:</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {MODALITIES.map((m) => (<span key={m} className="chip capitalize">{m}</span>))}
        </div>
      </section>

      <section className="card p-6">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-ink-900">Code examples</h2>
          <span className="chip">cURL · Python · Node · TypeScript · Go · C#</span>
        </div>
        <p className="mt-1 text-sm text-ink-600">Copy-paste client snippets in your language. Replace <code>sk-hds-YOUR_KEY</code> with a key from Account → API Keys.</p>

        <h3 className="mt-5 text-sm font-semibold text-ink-700">Search (aggregate + facets)</h3>
        <div className="mt-2"><CodeTabs snippets={searchSnippets(API_URL)} /></div>
        <p className="mt-2 text-sm text-ink-500">The response includes <code>results[]</code> (normalized + deduped), <code>enginesUsed[]</code> and <code>facets[]</code>.</p>

        <h3 className="mt-6 text-sm font-semibold text-ink-700">Crawl a URL → markdown</h3>
        <div className="mt-2"><CodeTabs snippets={crawlSnippets(API_URL)} /></div>

        <h3 className="mt-6 text-sm font-semibold text-ink-700">Vector (semantic) search</h3>
        <div className="mt-2"><CodeTabs snippets={vectorSnippets(API_URL)} /></div>
      </section>

      <section className="card p-6">
        <h2 className="text-lg font-semibold text-ink-900">Use a specific engine</h2>
        <p className="mt-1 text-sm text-ink-600">
          By default hdsearch picks the best engine by priority and falls back automatically. To force one,
          pass <code>engine</code> with an engine id (e.g. <code>searxng</code>, <code>brave</code>,{' '}
          <code>ahmia</code>). The call shape stays the same — you always hit hdsearch, never the provider directly.
        </p>
        <div className="mt-3"><CodeTabs snippets={engineSnippets(API_URL)} /></div>

        <h3 className="mt-5 text-sm font-semibold text-ink-700">List available engines</h3>
        <p className="mt-1 text-sm text-ink-600">
          Discover engine ids, their modalities, access type, and whether a key is needed —
          via <code>GET /v1/engines</code> (or see the <a href="/services" className="text-brand-600 underline">Integrations</a> page).
        </p>
        <div className="mt-2"><CodeBlock code={listEnginesSnippet(API_URL)} /></div>
      </section>

      <section className="card p-6">
        <h2 className="text-lg font-semibold text-ink-900">Interactive reference</h2>
        <p className="mt-1 text-sm text-ink-600">
          Explore and try every endpoint live (with your API key) in the{' '}
          <Link href={apiHref} className="text-brand-600 underline">API Reference</Link>, rendered from the
          OpenAPI spec at <a href={`${API_URL}/openapi.json`} target="_blank" rel="noreferrer" className="text-brand-600 underline">/openapi.json</a>.
        </p>
      </section>
    </div>
  );
}
