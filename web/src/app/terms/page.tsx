import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { TermsDocument } from '@/components/terms-document';
import { getTermsMarkdown } from '@/lib/terms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Terms of Service — hdsearch' };

export default function TermsPage() {
  const content = getTermsMarkdown();
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <TermsDocument content={content} className="rounded-lg border border-ink-100 bg-white p-6 sm:p-8" />
      </main>
      <SiteFooter />
    </div>
  );
}
