import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { ServicesContent, type Engine } from '@/components/content/services-content';
import { apiCall, ApiError } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Integrations — hdsearch' };

export default async function PublicServicesPage() {
  let engines: Engine[] = [];
  let error: string | null = null;
  try {
    // anonymous: fetch the public engine catalogue as the shared demo identity
    const r = await apiCall('/v1/engines', { asUser: 'public-demo' });
    engines = (r.engines || []) as Engine[];
  } catch (e) {
    error = e instanceof ApiError ? e.message : 'failed to load';
  }
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <ServicesContent engines={engines} error={error} />
      </main>
      <SiteFooter />
    </div>
  );
}
