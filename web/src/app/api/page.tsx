import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { SwaggerReference } from '@/components/swagger-reference';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'API Reference — hdsearch' };

// Public, login-free interactive API reference (Swagger UI over /openapi.json).
export default function PublicApiPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-ink-900">API Reference</h1>
          <p className="mt-1 text-sm text-ink-500">
            Interactive reference from the OpenAPI spec. Click <strong>Authorize</strong>, paste your{' '}
            <code>sk-hds-…</code> key, then use <strong>Try it out</strong> on any endpoint.
          </p>
        </div>
        <SwaggerReference />
      </main>
      <SiteFooter />
    </div>
  );
}
