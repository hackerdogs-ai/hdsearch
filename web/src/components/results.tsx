'use client';

import { useState } from 'react';
import { ResultActions } from './result-actions';

// Extract a YouTube video id from any common URL shape (watch?v=, youtu.be/, embed/, shorts/).
function youtubeId(url?: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (/(^|\.)youtube\.com$/.test(u.hostname)) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(embed|shorts|v)\/([\w-]{6,})/);
      if (m) return m[2];
    }
    if (u.hostname === 'youtu.be') return u.pathname.slice(1) || null;
  } catch {
    /* not a url */
  }
  return null;
}

// Presentational result renderers — modality-aware (web list, image grid, video
// cards). Client-safe so both the server page and the InfiniteResults client
// component can render them.

export interface Result {
  id: string;
  title: string;
  url: string;
  snippet?: string;
  modality: string;
  source: string;
  rank?: number;
  publishedAt?: string;
  thumbnail?: string;
  imageUrl?: string;
  videoUrl?: string;
  author?: string;
  score?: number;
  mergedFrom?: string[];
  extra?: Record<string, any>;
}

export interface ArchiveLoc {
  provider?: 'commoncrawl' | 'wayback';
  url: string;
  timestamp?: string;
  filename?: string;
  offset?: string | number;
  length?: string | number;
  snapshotUrl?: string;
}

// Build the link to an archived capture.
//  • view=true  → what the result title opens. Wayback links straight to the
//    rendered web.archive.org snapshot; Common Crawl streams via our BFF.
//  • view=false → the JSON markdown endpoint used by Extract (both providers).
export function archiveHref(a: ArchiveLoc | undefined, view: boolean): string | null {
  if (!a?.url) return null;
  if (a.provider === 'wayback' && view) return a.snapshotUrl || null;
  const qs = new URLSearchParams({ url: a.url });
  if (a.provider) qs.set('provider', a.provider);
  if (a.timestamp) qs.set('ts', String(a.timestamp));
  if (a.filename) qs.set('filename', String(a.filename));
  if (a.offset != null) qs.set('offset', String(a.offset));
  if (a.length != null) qs.set('length', String(a.length));
  if (view) qs.set('view', 'html');
  return `/api/archive?${qs.toString()}`;
}

function fmtDate(raw: string): string {
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return raw;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// Route third-party result images through our proxy so upstream CDNs (e.g.
// imgs.search.brave.com) don't 429 / block hotlinking → no broken images.
function img(url?: string): string {
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('/')) return url;
  return `/api/img?url=${encodeURIComponent(url)}`;
}

export function ResultList({ results, modality }: { results: Result[]; modality: string }) {
  if (results.length === 0) {
    return <p className="py-16 text-center text-ink-500">No results. Try a different query or engine.</p>;
  }
  if (modality === 'images') return <ImageGrid results={results} />;
  if (modality === 'videos') return <VideoGrid results={results} />;
  return (
    <ul className="space-y-5">
      {results.map((r) => {
        const isArchive = r.modality === 'archive';
        const archive = isArchive ? (r.extra?.archive as ArchiveLoc | undefined) : undefined;
        // archive results link to the captured snapshot, never the live page.
        const href = (isArchive && archiveHref(archive, true)) || r.url;
        return (
          <li key={r.id} className="group">
            <div className="flex items-center gap-2 text-sm text-ink-500">
              {r.thumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={img(r.thumbnail)} alt="" className="h-4 w-4 rounded" referrerPolicy="no-referrer" loading="lazy" />
              )}
              <span className="truncate">{hostOf(r.url)}</span>
              <span className="chip bg-ink-100 py-0.5">{r.source}</span>
              {isArchive && (
                <span className="chip bg-amber-50 py-0.5 text-amber-700">
                  {archive?.provider === 'wayback' || r.source === 'wayback' ? 'Wayback snapshot' : 'Common Crawl snapshot'}
                </span>
              )}
              {r.mergedFrom && r.mergedFrom.length > 1 && (
                <span className="chip bg-brand-50 py-0.5 text-brand-700">×{r.mergedFrom.length} engines</span>
              )}
              {typeof r.score === 'number' && <span className="chip py-0.5">score {r.score.toFixed(2)}</span>}
            </div>
            <a href={href} target="_blank" rel="noreferrer" className="mt-0.5 block text-lg font-medium text-brand-700 group-hover:underline">
              {r.title}
            </a>
            {r.snippet && <p className="mt-1 line-clamp-3 text-base text-ink-600">{r.snippet}</p>}
            <div className="mt-1 flex gap-3 text-sm text-ink-400">
              {r.publishedAt && <span>{fmtDate(r.publishedAt)}</span>}
              {r.author && <span>{r.author}</span>}
              {isArchive && (
                <a href={r.url} target="_blank" rel="noreferrer" className="hover:text-brand-700">live page ↗</a>
              )}
            </div>
            {/^https?:\/\//.test(r.url) && r.modality !== 'darkweb' && (
              <ResultActions url={r.url} modality={r.modality} archive={archive} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ImageGrid({ results }: { results: Result[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {results.map((r) => (
        <a key={r.id} href={r.url} target="_blank" rel="noreferrer" className="card overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={img(r.imageUrl || r.thumbnail)}
            alt={r.title}
            className="aspect-square w-full bg-ink-100 object-cover"
            referrerPolicy="no-referrer"
            loading="lazy"
          />
          <div className="truncate px-2 py-1.5 text-base text-ink-600">{r.title}</div>
        </a>
      ))}
    </div>
  );
}

function VideoGrid({ results }: { results: Result[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {results.map((r) => (
        <VideoCard key={r.id} r={r} />
      ))}
    </div>
  );
}

interface VideoInfo {
  kind: 'youtube' | 'file' | 'dailymotion' | 'vimeo' | 'tiktok' | 'other';
  embedSrc?: string; // iframe player
  fileSrc?: string; // native <video> source
  thumb?: string; // derived thumbnail (un-proxied)
  playable: boolean;
}

// Classify a video result so we can play it inline (YouTube/Vimeo/Dailymotion/TikTok
// embeds, or a native <video> for direct files incl. Wikimedia .webm) and derive a
// real thumbnail per platform. Anything else opens in a new tab with a placeholder.
function classifyVideo(r: Result): VideoInfo {
  const url = r.videoUrl || r.url || '';
  let u: URL | null = null;
  try {
    u = new URL(url);
  } catch {
    /* not a url */
  }
  const host = u?.hostname.replace(/^www\./, '') || '';
  const path = u?.pathname || '';
  let m: RegExpMatchArray | null;

  const yt = youtubeId(url);
  if (yt) return { kind: 'youtube', embedSrc: `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0`, thumb: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`, playable: true };

  // Wikimedia Commons "File:Foo.webm" *page* → resolve to the actual media file via
  // Special:FilePath (must come before the generic file check: the page URL also ends
  // in .webm but is HTML, not the video).
  if (/wikimedia\.org$/.test(host) && /\/wiki\/File:.+\.(webm|ogv|ogg|mp4)/i.test(path)) {
    const fn = path.split('/wiki/File:')[1] || '';
    return { kind: 'file', fileSrc: `https://commons.wikimedia.org/wiki/Special:FilePath/${fn}`, thumb: r.thumbnail, playable: true };
  }
  // direct media file → native player
  if (/\.(webm|mp4|ogv|ogg|mov|m4v)(\?|#|$)/i.test(url)) return { kind: 'file', fileSrc: url, thumb: r.thumbnail, playable: true };
  if ((host === 'dailymotion.com' || host === 'dai.ly') && (m = url.match(/(?:video\/|dai\.ly\/)([a-z0-9]+)/i))) {
    return { kind: 'dailymotion', embedSrc: `https://geo.dailymotion.com/player.html?video=${m[1]}&autoplay=1`, thumb: `https://www.dailymotion.com/thumbnail/video/${m[1]}`, playable: true };
  }
  if (host.endsWith('vimeo.com') && (m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i))) {
    return { kind: 'vimeo', embedSrc: `https://player.vimeo.com/video/${m[1]}?autoplay=1`, thumb: `https://vumbnail.com/${m[1]}.jpg`, playable: true };
  }
  if (host === 'tiktok.com' && (m = path.match(/\/video\/(\d+)/))) {
    return { kind: 'tiktok', embedSrc: `https://www.tiktok.com/embed/v2/${m[1]}`, thumb: r.thumbnail, playable: true };
  }
  return { kind: 'other', thumb: r.thumbnail, playable: false };
}

// A video result. Plays inline when we can (embed or native <video>); always shows a
// clean thumbnail — derived per platform, with a placeholder tile if it's missing or
// fails to load, so a result is never a broken image.
function VideoCard({ r }: { r: Result }) {
  const [playing, setPlaying] = useState(false);
  const [thumbBroken, setThumbBroken] = useState(false);
  const info = classifyVideo(r);
  const meta = (
    <div className="px-3 py-2">
      <div className="line-clamp-2 text-base font-medium text-ink-900">{r.title}</div>
      <div className="mt-1 text-sm text-ink-500">{hostOf(r.url)} · {r.source}{info.playable ? ' · click to play' : ' ↗'}</div>
    </div>
  );

  if (playing && info.playable) {
    return (
      <div className="card overflow-hidden">
        <div className="aspect-video w-full bg-black">
          {info.kind === 'file' ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video src={info.fileSrc} className="h-full w-full" controls autoPlay playsInline />
          ) : (
            <iframe
              src={info.embedSrc}
              title={r.title}
              className="h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          )}
        </div>
        {meta}
      </div>
    );
  }

  const showThumb = info.thumb && !thumbBroken;
  const tile = (
    <>
      <div className="relative aspect-video w-full bg-gradient-to-br from-ink-200 to-ink-300">
        {showThumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img(info.thumb)}
            alt={r.title}
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
            loading="lazy"
            onError={() => setThumbBroken(true)}
          />
        ) : (
          // placeholder when there's no usable thumbnail — never a broken image
          <span className="absolute inset-0 grid place-items-center text-ink-400">
            <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="4" width="20" height="16" rx="2" /><path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" />
            </svg>
          </span>
        )}
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-black/55 text-white transition group-hover:bg-brand-600">
            <svg viewBox="0 0 24 24" className="h-6 w-6 translate-x-0.5" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          </span>
        </span>
      </div>
      {meta}
    </>
  );

  return info.playable ? (
    <button type="button" onClick={() => setPlaying(true)} className="card group overflow-hidden text-left">
      {tile}
    </button>
  ) : (
    <a href={r.videoUrl || r.url} target="_blank" rel="noreferrer" className="card group overflow-hidden">
      {tile}
    </a>
  );
}
