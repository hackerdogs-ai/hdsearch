import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { DocsContent } from '@/components/content/docs-content';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Documentation — hdsearch' };

export default function PublicDocsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <DocsContent apiHref="/api" />
      </main>
      <SiteFooter />
    </div>
  );
}
