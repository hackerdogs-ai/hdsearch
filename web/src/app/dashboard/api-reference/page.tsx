import { SwaggerReference } from '@/components/swagger-reference';

export const dynamic = 'force-dynamic';

export default function ApiReferencePage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">API Reference</h1>
        <p className="mt-1 text-sm text-ink-500">
          Interactive reference from the OpenAPI spec. Click <strong>Authorize</strong>, paste your{' '}
          <code>sk-hds-…</code> key, then use <strong>Try it out</strong> on any endpoint.
        </p>
      </div>
      <SwaggerReference />
    </div>
  );
}
