'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { aiSearchHref } from '@/lib/ai-routes';
import { searchHref } from '@/lib/search-routes';
import { getRecents, clearRecents, type Recent } from '@/lib/recents';
import { SearchModalityIcon } from '@/components/search-modality-icon';

// Tiered search history. Browser tier (localStorage) works for everyone; the
// server tier is the signed-in Redis 3-day window (paid users also get a durable
// S3 archive). Both are listed with one-click clear.
interface ServerEntry {
  q: string;
  modality: string;
  ts: number;
  count?: number;
  source?: 'search' | 'ai';
  model?: string;
}

// AI conversations — full threads (title + message count), distinct from the
// query-recents ServerEntry list. Backed by /api/ai/threads (Redis + paid S3).
interface AiThreadEntry {
  threadId: string;
  title: string;
  ts: number;
  messageCount: number;
  model?: string;
}

const TIER_LABEL: Record<string, string> = {
  browser: 'Browser only',
  redis: 'Synced · 3-day server history',
  'redis+archive': 'Synced · 3-day server history + durable archive (paid)',
};

export function SearchHistoryPanel() {
  const [recents, setRecents] = useState<Recent[]>([]);
  const [server, setServer] = useState<ServerEntry[]>([]);
  const [tier, setTier] = useState<string>('browser');
  const [loading, setLoading] = useState(true);

  const [aiThreads, setAiThreads] = useState<AiThreadEntry[]>([]);
  const [aiTier, setAiTier] = useState<string>('browser');
  const [aiLoading, setAiLoading] = useState(true);

  useEffect(() => {
    const sync = () => setRecents(getRecents());
    sync();
    window.addEventListener('hd-recents', sync);
    return () => window.removeEventListener('hd-recents', sync);
  }, []);

  async function loadServer() {
    try {
      const r = await fetch('/api/history', { cache: 'no-store' });
      const j = await r.json();
      setServer(j.entries || []);
      setTier(j.tier || 'browser');
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }
  async function loadAiThreads() {
    try {
      const r = await fetch('/api/ai/threads', { cache: 'no-store' });
      const j = await r.json();
      setAiThreads(j.entries || []);
      setAiTier(j.tier || 'browser');
    } catch {
      /* ignore */
    } finally {
      setAiLoading(false);
    }
  }
  useEffect(() => {
    loadServer();
    loadAiThreads();
  }, []);

  async function clearServer() {
    await fetch('/api/history', { method: 'DELETE' });
    setServer([]);
  }
  async function clearAiThreads() {
    if (!confirm('Delete all AI conversations from your account? This removes them from Redis and durable archive.')) return;
    await fetch('/api/ai/threads', { method: 'DELETE' });
    setAiThreads([]);
  }

  return (
    <div className="space-y-4">
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Browser tier */}
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-900">This browser</h2>
          {recents.length > 0 && (
            <button onClick={() => clearRecents()} className="text-sm text-ink-400 hover:text-red-600">Clear</button>
          )}
        </div>
        <p className="mt-0.5 text-sm text-ink-400">Stored locally on this device — available even when signed out.</p>
        <ul className="mt-3 space-y-1">
          {recents.length === 0 && <li className="py-6 text-center text-sm text-ink-400">No recent searches on this device.</li>}
          {recents.slice(0, 12).map((r) => (
            <li key={`${r.modality}:${r.q}:${r.ts}`}>
              <Link
                href={searchHref({ q: r.q, modality: r.modality })}
                className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-ink-50"
              >
                <span className="min-w-0 flex-1 truncate text-ink-800">{r.q}</span>
                <SearchModalityIcon modality={r.modality} className="ml-auto" />
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {/* Server tier */}
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-900">Your account</h2>
          {server.length > 0 && (
            <button onClick={clearServer} className="text-sm text-ink-400 hover:text-red-600">Clear</button>
          )}
        </div>
        <p className="mt-0.5 text-sm text-ink-400">{TIER_LABEL[tier] || TIER_LABEL.browser}</p>
        <ul className="mt-3 space-y-1">
          {loading && <li className="py-6 text-center text-sm text-ink-400">Loading…</li>}
          {!loading && server.length === 0 && (
            <li className="py-6 text-center text-sm text-ink-400">
              {tier === 'browser' ? 'Sign in to sync history across devices.' : 'No server history yet.'}
            </li>
          )}
          {server.slice(0, 12).map((e) => (
            <li key={`${e.modality}:${e.q}:${e.ts}`}>
              <Link
                href={e.source === 'ai'
                  ? aiSearchHref(e.q)
                  : searchHref({ q: e.q, modality: e.modality })}
                className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-ink-50"
              >
                <span className="min-w-0 flex-1 truncate text-ink-800">{e.q}</span>
                {typeof e.count === 'number' && <span className="shrink-0 text-sm text-ink-400">{e.count}</span>}
                <SearchModalityIcon
                  modality={e.source === 'ai' ? 'ai' : e.modality}
                  className="ml-auto"
                />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>

    {/* AI conversations — full threads (title + roundtrip count), distinct from the
        query-recents "Your account" tier above. Backed by /api/ai/threads (Redis +
        paid S3). Clicking deep-links into /search?modality=ai&thread=<id> so the
        panel opens directly to that conversation. */}
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-900">AI conversations</h2>
        {aiThreads.length > 0 && (
          <button onClick={clearAiThreads} className="text-sm text-ink-400 hover:text-red-600">Clear</button>
        )}
      </div>
      <p className="mt-0.5 text-sm text-ink-400">{TIER_LABEL[aiTier] || TIER_LABEL.browser}</p>
      <ul className="mt-3 space-y-1">
        {aiLoading && <li className="py-6 text-center text-sm text-ink-400">Loading…</li>}
        {!aiLoading && aiThreads.length === 0 && (
          <li className="py-6 text-center text-sm text-ink-400">
            {aiTier === 'browser' ? 'Sign in to sync AI chats across devices.' : 'No AI conversations yet.'}
          </li>
        )}
        {aiThreads.slice(0, 20).map((t) => (
          <li key={t.threadId}>
            <Link
              href={`${aiSearchHref()}&thread=${encodeURIComponent(t.threadId)}`}
              className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-ink-50"
            >
              <span className="min-w-0 flex-1 truncate text-ink-800">{t.title || 'Untitled chat'}</span>
              <span className="shrink-0 text-sm text-ink-400">{t.messageCount} msg</span>
              <SearchModalityIcon modality="ai" className="ml-auto" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
    </div>
  );
}
