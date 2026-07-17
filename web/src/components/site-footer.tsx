import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="border-t border-ink-100 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-ink-500 sm:flex-row">
        <p>© {new Date().getFullYear()} hdsearch — search aggregator.</p>
        <nav className="flex flex-wrap items-center gap-4">
          <Link href="/api" prefetch={false} className="hover:text-ink-900">API Reference</Link>
          <Link href="/docs" prefetch={false} className="hover:text-ink-900">Documentation</Link>
          <Link href="/services" prefetch={false} className="hover:text-ink-900">Integrations</Link>
          <Link href="/integrations" prefetch={false} className="hover:text-ink-900">REST &amp; MCP</Link>
          <Link href="/terms" prefetch={false} className="hover:text-ink-900">Terms of Service</Link>
        </nav>
      </div>
    </footer>
  );
}
