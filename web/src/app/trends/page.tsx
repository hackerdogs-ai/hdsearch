import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { TrendsView } from '@/components/trends-view';
import { fetchTrendsPage } from '@/lib/trends';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export default async function TrendsPage() {
  const data = await fetchTrendsPage();
  const sections = data?.sections ?? [];
  const windowHours = data?.windowHours ?? 24;

  return (
    <div className="flex min-h-screen flex-col bg-ink-50">
      <SiteHeader />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <header className="mb-8 border-b border-ink-200 pb-6">
          <h1 className="text-3xl font-normal tracking-tight text-ink-900">Trends</h1>
          <p className="mt-1 text-sm text-ink-500">
            Recent headlines across news, cybersecurity, government, and geopolitics · last {windowHours}h
          </p>
        </header>

        <TrendsView sections={sections} windowHours={windowHours} />
      </main>

      <SiteFooter />
    </div>
  );
}
