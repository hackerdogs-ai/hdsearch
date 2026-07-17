import type { Metadata } from 'next';
import './globals.css';
import { AuthFetchGuard } from '@/components/auth-fetch-guard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'hdsearch — one API for search, crawl & vector search',
  description:
    'Aggregated search, crawl and vector search across many engines with priority-ordered fallback, dedup and a caching layer. SerpAPI-style API + MCP server.',
  // Favicon: app/icon.svg (file-based metadata). Do NOT also set metadata.icons — duplicates /icon.svg fetches.
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Do NOT refresh JWT here — it blocked every page (home, search, docs) before first byte.
  // apiCall / dashboard gates refresh on demand via validCoreJwt().
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">
        <AuthFetchGuard />
        {children}
      </body>
    </html>
  );
}
