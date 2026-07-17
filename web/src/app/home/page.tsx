import Link from 'next/link';
import { Suspense } from 'react';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { SearchBox } from '@/components/search-box';
import { aiSearchHref } from '@/lib/ai-routes';
import { searchHref } from '@/lib/search-routes';

const MODALITIES = ['web', 'news', 'images', 'videos', 'maps', 'scholar', 'shopping', 'code', 'social', 'archive', 'darkweb', 'semantic', 'ai'];

export const dynamic = 'force-dynamic';

const FEATURES = [
  { t: 'One API, many engines', d: 'Brave, SerpAPI, Serper, Tavily, Exa, OpenSERP, SearXNG, DuckDuckGo, Common Crawl, Ahmia and more — behind a single normalized response.' },
  { t: 'Priority fallback + dedup', d: 'Free & self-hosted engines first. If one fails, the next is tried. Duplicate results are merged across engines.' },
  { t: 'Crawl anything', d: 'Turn any URL into clean markdown/text/links/images via crawl4ai, Firecrawl, Jina Reader, with a built-in fallback.' },
  { t: 'Vector search', d: 'Embed + index documents in Redis with a TTL, then run semantic KNN search — optionally grounded with live web results.' },
  { t: 'Caching that protects you', d: 'A Redis cache layer with per-source TTLs keeps you from getting rate-limited or blocked by upstreams.' },
  { t: 'MCP + API', d: 'Call it from your code, or plug the MCP server into Claude and your IDE. Per-user encrypted provider keys.' },
];

export default function ProductHomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-brand-50 to-ink-50" />
        <div className="mx-auto max-w-4xl px-4 pb-16 pt-20 text-center">
          <span className="chip mb-5 bg-brand-100 text-brand-700">Search · Crawl · Vector · Darkweb</span>
          <h1 className="text-balance text-4xl font-extrabold tracking-tight text-ink-900 sm:text-5xl">
            One API for the entire searchable web
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-lg text-ink-500">
            Aggregated search, crawling and vector search across dozens of engines — with priority-ordered
            fallback, dedup, faceting and a caching layer that keeps you unblocked.
          </p>

          <div className="mx-auto mt-8 max-w-2xl">
            <Suspense>
              <SearchBox size="lg" />
            </Suspense>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-sm text-ink-500">
              {MODALITIES.map((m) => (
                <Link
                  key={m}
                  href={m === 'ai' ? aiSearchHref() : searchHref({ modality: m })}
                  prefetch={false}
                  className="chip capitalize hover:bg-ink-200"
                >
                  {m === 'ai' ? 'AI Search' : m}
                </Link>
              ))}
            </div>
          </div>

          <div className="mt-8 flex items-center justify-center gap-3">
            <a href="/login" className="btn-primary">Get an API key</a>
            <Link href="/docs" className="btn-ghost">Read the docs</Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.t} className="card p-5">
              <h3 className="font-semibold text-ink-900">{f.t}</h3>
              <p className="mt-2 text-base text-ink-500">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16">
        <div className="card overflow-hidden">
          <div className="border-b border-ink-100 px-5 py-3 text-sm font-medium text-ink-600">Quick start</div>
          <pre className="overflow-x-auto bg-ink-900 p-5 text-sm text-ink-100">
{`curl https://api.hdsearch.ai/v1/search \\
  -H "authorization: Bearer sk-hds-..." \\
  -H "content-type: application/json" \\
  -d '{ "q": "openai", "modality": "web", "mode": "aggregate", "facets": true }'`}
          </pre>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
