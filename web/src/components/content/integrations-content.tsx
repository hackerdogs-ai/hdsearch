import Link from 'next/link';
import { CodeBlock } from '@/components/code-block';

// Shared API & MCP body (REST API + MCP). Used by the public /integrations page
// and the dashboard API & MCP page. `docsHref`/`accountHref` adapt the links.
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8791';

export function IntegrationsContent({
  docsHref = '/docs',
  accountHref = '/dashboard/account',
}: {
  docsHref?: string;
  accountHref?: string;
}) {
  const mcpConfig = JSON.stringify(
    {
      mcpServers: {
        'hd-search': {
          command: 'node',
          args: ['dist/mcp/server.js'],
          env: { HDSEARCH_API_URL: API_URL, HDSEARCH_API_KEY: 'sk-hds-YOUR_KEY' },
        },
      },
    },
    null,
    2,
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">API &amp; MCP</h1>
        <p className="mt-1 text-sm text-ink-500">Call hdsearch from your code, or plug the MCP server into Claude &amp; your IDE.</p>
      </div>

      <section className="card p-6">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-ink-900">REST API</h2>
          <span className="chip">Dev-first</span>
        </div>
        <p className="mt-1 text-sm text-ink-500">
          Base URL <code className="rounded bg-ink-50 px-1.5 py-0.5">{API_URL}</code>. Authenticate with a{' '}
          <a href={accountHref} className="text-brand-600 underline">key</a> in the <code>Authorization</code> header.
        </p>
        <div className="mt-4 space-y-4">
          <CodeBlock code={`# Search (aggregate + facets)
curl ${API_URL}/v1/search \\
  -H "authorization: Bearer sk-hds-YOUR_KEY" \\
  -H "content-type: application/json" \\
  -d '{"q":"openai","modality":"web","mode":"aggregate","facets":true}'`} />
          <CodeBlock code={`# Crawl a URL → markdown
curl ${API_URL}/v1/crawl \\
  -H "authorization: Bearer sk-hds-YOUR_KEY" \\
  -H "content-type: application/json" \\
  -d '{"url":"https://example.com","formats":["markdown","links"]}'`} />
          <CodeBlock code={`# Vector search (DevTest+)
curl ${API_URL}/v1/search/vector \\
  -H "authorization: Bearer sk-hds-YOUR_KEY" \\
  -H "content-type: application/json" \\
  -d '{"q":"how do transformers work","namespace":"notes","k":5,"groundWithWeb":true}'`} />
        </div>
        <Link href={docsHref} className="btn-ghost mt-4">Full documentation →</Link>
      </section>

      <section className="card p-6">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-ink-900">MCP Server</h2>
          <span className="chip">Claude · IDEs · agents</span>
        </div>
        <p className="mt-1 text-sm text-ink-500">
          Exposes <code>hd_search</code>, <code>hd_crawl</code>, <code>hd_vector_search</code>, <code>hd_vector_index</code> and{' '}
          <code>hd_list_engines</code> as MCP tools. Add this to your client config:
        </p>
        <div className="mt-4"><CodeBlock lang="json" code={mcpConfig} /></div>
        <p className="mt-3 text-sm text-ink-400">
          The MCP server is a thin client over this API, so your quota, rate limits and per-user provider keys apply identically.
        </p>
      </section>
    </div>
  );
}
