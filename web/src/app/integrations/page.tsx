import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { IntegrationsContent } from '@/components/content/integrations-content';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'API & MCP — hdsearch' };

export default function PublicIntegrationsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <IntegrationsContent docsHref="/docs" accountHref="/login" />
      </main>
      <SiteFooter />
    </div>
  );
}
