import Link from 'next/link';
import { Brand } from './brand';
import { ProfileMenu } from './profile-menu';
import { getSession } from '@/lib/session';

// Marketing/site header. Server component — reflects login state.
export async function SiteHeader() {
  const user = getSession();

  return (
    <header className="sticky top-0 z-20 border-b border-ink-100 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Brand />
        <nav className="hidden items-center gap-1 md:flex">
          <Link href="/api" prefetch={false} className="nav-link">API Reference</Link>
          <Link href="/docs" prefetch={false} className="nav-link">Docs</Link>
          <Link href="/services" prefetch={false} className="nav-link">Integrations</Link>
          <Link href="/integrations" prefetch={false} className="nav-link">REST &amp; MCP</Link>
          <Link href="/terms" prefetch={false} className="nav-link">Terms of Service</Link>
        </nav>
        <div className="flex items-center gap-3">
          {user ? (
            <ProfileMenu
              name={user.name ?? undefined}
              email={user.email ?? undefined}
              picture={user.picture ?? undefined}
            />
          ) : (
            <a href="/login" className="btn-primary">Sign in</a>
          )}
        </div>
      </div>
    </header>
  );
}
