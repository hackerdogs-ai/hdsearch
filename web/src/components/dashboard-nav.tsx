'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';

const ITEMS: { href: string; label: string; icon: string; adminOnly?: boolean }[] = [
  { href: '/dashboard/account', label: 'Account', icon: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 20a8 8 0 0116 0' },
  { href: '/dashboard/api-reference', label: 'API Reference', icon: 'M8 9h8M8 13h6M4 5h16v14H4z' },
  { href: '/dashboard', label: 'Dashboard', icon: 'M3 12l9-9 9 9M5 10v10h14V10' },
  { href: '/dashboard/docs', label: 'Documentation', icon: 'M4 4h12l4 4v12H4zM14 4v4h4' },
  { href: '/dashboard/integrations', label: 'API & MCP', icon: 'M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1' },
  { href: '/dashboard/services/ranking', label: 'Ranking', icon: 'M3 5h12M3 10h8M3 15h4M19 5v14l-4-4' },
  { href: '/dashboard/services/llm-providers', label: 'LLM Providers', icon: 'M12 2a2 2 0 012 2v1h2a2 2 0 012 2v2h1a2 2 0 010 4h-1v2a2 2 0 01-2 2h-2v1a2 2 0 01-4 0v-1H8a2 2 0 01-2-2v-2H5a2 2 0 010-4h1V7a2 2 0 012-2h2V4a2 2 0 012-2z' },
  { href: '/dashboard/history', label: 'Search History', icon: 'M12 8v4l3 3M12 3a9 9 0 100 18 9 9 0 000-18z' },
  { href: '/dashboard/services', label: 'Integrations', icon: 'M4 6h16M4 12h16M4 18h16' },
  { href: '/dashboard/admin', label: 'System Admin', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z', adminOnly: true },
];

export function DashboardNav({ role }: { role?: string }) {
  const path = usePathname();
  const isAdmin = role === 'admin';

  const items = useMemo(
    () => [...ITEMS]
      .filter((it) => !it.adminOnly || isAdmin)
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })),
    [isAdmin],
  );

  return (
    <nav className="space-y-1">
      {items.map((it) => {
        const active = it.href === '/dashboard' || it.href === '/dashboard/services'
          ? path === it.href
          : path.startsWith(it.href);
        return (
          <Link key={it.href} href={it.href} prefetch={false} className={`nav-link ${active ? 'nav-link-active' : ''}`}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d={it.icon} />
            </svg>
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
