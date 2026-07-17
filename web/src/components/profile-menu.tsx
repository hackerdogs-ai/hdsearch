'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// User profile avatar + dropdown (mirrors worldmonitor's hd-profile-menu). Shows the
// profile image, or initials when there's none, and opens a menu with identity + links.
export interface ProfileMenuProps {
  name?: string;
  email?: string;
  picture?: string;
  role?: string; // 'admin' | 'user'
  plan?: string; // display label, e.g. "Free"
}

function initialsOf(name?: string, email?: string): string {
  const n = (name || '').trim();
  if (n) {
    const parts = n.split(/\s+/);
    const first = parts[0]?.[0] ?? '';
    const last = parts.length > 1 ? parts[parts.length - 1]![0] : '';
    return `${first}${last}`.toUpperCase() || '?';
  }
  return (email?.[0] || '?').toUpperCase();
}

const ITEMS = [
  { href: '/dashboard/account', label: 'Manage', icon: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 20a8 8 0 0116 0' },
  { href: '/dashboard/history', label: 'Search History', icon: 'M12 8v4l3 3M12 3a9 9 0 100 18 9 9 0 000-18z' },
  { href: '/dashboard/account', label: 'Account', icon: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 20a8 8 0 0116 0' },
];

const MENU_ITEM_CLASS =
  'flex cursor-pointer items-center gap-2.5 px-4 py-2 text-sm text-ink-700 hover:bg-ink-50';

export function ProfileMenu({ name, email, picture, role, plan }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({ top: 0, left: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setMenuStyle({
        top: rect.bottom + 8,
        left: rect.right,
        transform: 'translateX(-100%)',
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('click', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('click', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const initials = initialsOf(name, email);
  const isAdmin = role === 'admin';

  const menu = open ? (
    <div
      ref={menuRef}
      role="menu"
      style={menuStyle}
      className="fixed z-[9999] w-64 overflow-hidden rounded-xl border border-ink-100 bg-white shadow-lg"
    >
      {/* header */}
      <div className="flex items-center gap-3 border-b border-ink-100 px-4 py-3">
        <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-brand-100">
          {picture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={picture} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <span className="text-sm font-semibold text-brand-700">{initials}</span>
          )}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink-900">{name || 'User'}</div>
          <div className="truncate text-sm text-ink-400">{email}</div>
          <div className="mt-1 flex items-center gap-1.5">
            {isAdmin && <span className="chip bg-ink-900 px-1.5 py-0 text-sm text-white">Admin</span>}
            <span className="chip bg-brand-50 px-1.5 py-0 text-sm text-brand-700">Plan: {plan || 'Free'}</span>
          </div>
        </div>
      </div>

      {/* items */}
      <nav className="py-1">
        {ITEMS.map((it) => (
          <Link
            key={it.label}
            href={it.href}
            prefetch={false}
            role="menuitem"
            onMouseEnter={() => router.prefetch(it.href)}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              e.preventDefault();
              setOpen(false);
              router.push(it.href);
            }}
            className={MENU_ITEM_CLASS}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-ink-400" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d={it.icon} />
            </svg>
            {it.label}
          </Link>
        ))}
      </nav>

      <div className="border-t border-ink-100 py-1">
        <a
          href="/api/auth/logout"
          role="menuitem"
          className={`${MENU_ITEM_CLASS} text-red-600 hover:bg-red-50`}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
          </svg>
          Sign out
        </a>
      </div>
    </div>
  ) : null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={name || email || 'Account'}
        className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 border-green-500 bg-brand-100 transition hover:shadow-[0_0_0_2px_rgba(34,197,94,0.3)] focus:outline-none focus:shadow-[0_0_0_2px_rgba(34,197,94,0.4)]"
      >
        {picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={picture} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <span className="text-sm font-semibold text-brand-700">{initials}</span>
        )}
      </button>

      {mounted && menu ? createPortal(menu, document.body) : null}
    </div>
  );
}
