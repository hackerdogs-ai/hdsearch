import type { Metadata } from 'next';
import './globals.css';
import { AuthFetchGuard } from '@/components/auth-fetch-guard';
import { RecentsScope } from '@/components/recents-scope';
import { recentsScope } from '@/lib/recents';
import { getSession } from '@/lib/session';

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
      <head>
        {/*
          Start the icon font with the HTML instead of after globals.css parses.
          Icons are ligatures rendered with font-display: block, so until the
          font lands they occupy space but paint nothing — preloading keeps that
          window to a few ms rather than a visible gap. crossOrigin is required
          on font preloads even same-origin, or the fetch is made twice.
        */}
        <link
          rel="preload"
          href="/fonts/material-symbols-outlined.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body className="min-h-screen font-sans">
        <AuthFetchGuard />
        {/* Namespace localStorage search history per account (shared-browser safety). */}
        <RecentsScope scope={recentsScope(getSession()?.sub)} />
        {children}
      </body>
    </html>
  );
}
