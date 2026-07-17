// Common Crawl capture fetcher. A CDX search row only locates a capture
// (filename + byte offset/length into a WARC on data.commoncrawl.org); this module
// fetches that exact WARC record, de-frames it (gzip member → WARC headers → HTTP
// headers → body) and returns the *archived* HTML so we can render or extract the
// page as it was captured — never the live site.
import zlib from 'node:zlib';
import { httpFetch, httpText } from './http.js';
import { htmlToMarkdown, htmlToText, titleOf } from './providers/util.js';
import { computed } from './cache.js';

const CC_INDEX = process.env.HDSEARCH_CC_INDEX || 'CC-MAIN-2025-08';
const DATA_BASE = process.env.HDSEARCH_CC_DATA_BASE || 'https://data.commoncrawl.org';

export interface CaptureLocator {
  url: string;
  timestamp?: string;
  filename?: string;
  offset?: number;
  length?: number;
}

export interface Capture {
  url: string;
  timestamp?: string;
  capturedAt?: string;
  status: number;
  title?: string;
  html: string;
  markdown: string;
  text: string;
  source: 'commoncrawl' | 'wayback';
}

/** Resolve filename/offset/length from the CDX index when the caller didn't carry them. */
async function locate(loc: CaptureLocator): Promise<CaptureLocator> {
  if (loc.filename && loc.offset != null && loc.length != null) return loc;
  const u = new URL(`https://index.commoncrawl.org/${CC_INDEX}-index`);
  u.searchParams.set('url', loc.url);
  u.searchParams.set('output', 'json');
  u.searchParams.set('limit', '50');
  const body = await httpText(u.toString(), { provider: 'commoncrawl' });
  const rows = body
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as Record<string, string>;
      } catch {
        return null;
      }
    })
    .filter((r): r is Record<string, string> => !!r && !!r.filename);
  if (!rows.length) throw new Error('no Common Crawl capture found for this URL');
  // pick the exact timestamp if given, else the most recent.
  const row =
    (loc.timestamp && rows.find((r) => r.timestamp === loc.timestamp)) ||
    rows.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))[0];
  if (!row) throw new Error('no Common Crawl capture found for this URL');
  return {
    url: row.url || loc.url,
    timestamp: row.timestamp,
    filename: row.filename,
    offset: Number(row.offset),
    length: Number(row.length),
  };
}

export async function fetchCapture(input: CaptureLocator): Promise<Capture> {
  const loc = await locate(input);
  const key = JSON.stringify(['archive', loc.filename, loc.offset, loc.length]);
  const { value } = await computed('archive', key, 86400, () => fetchAndParse(loc));
  return value;
}

// Wayback Machine: fetch the *raw* archived page (the `id_` suffix strips the
// Internet Archive toolbar/rewriting) and convert it to markdown/text. Far more
// reliable than Common Crawl's WARC fetch.
export async function fetchWayback(url: string, timestamp?: string): Promise<Capture> {
  const ts = timestamp || '2';
  const key = JSON.stringify(['wayback', ts, url]);
  const { value } = await computed('archive', key, 86400, async () => {
    const snap = `https://web.archive.org/web/${ts}id_/${url}`;
    const res = await httpFetch(snap, {
      provider: 'wayback',
      timeoutMs: 30000,
      redirect: 'follow',
      // IA blocks UA-less requests; present a browser UA.
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) throw new Error(`Wayback fetch failed (HTTP ${res.status})`);
    const html = await res.text();
    return {
      url,
      timestamp,
      capturedAt: cdxDate(timestamp),
      status: res.status,
      title: titleOf(html),
      html,
      markdown: htmlToMarkdown(html),
      text: htmlToText(html),
      source: 'commoncrawl' as const, // Capture.source type; label corrected by the route
    };
  });
  return value;
}

async function fetchAndParse(loc: CaptureLocator): Promise<Capture> {
  const off = Number(loc.offset);
  const len = Number(loc.length);
  const res = await httpFetch(`${DATA_BASE}/${loc.filename}`, {
    provider: 'commoncrawl',
    headers: { Range: `bytes=${off}-${off + len - 1}`, 'user-agent': 'hdsearch/1.0' },
    timeoutMs: 30000,
  });
  if (!res.ok && res.status !== 206) throw new Error(`Common Crawl data fetch failed (HTTP ${res.status})`);
  const gz = Buffer.from(await res.arrayBuffer());
  const rec = gunzipSafe(gz); // one WARC record (independent gzip member)

  // WARC headers \r\n\r\n  HTTP headers \r\n\r\n  body
  const warcEnd = rec.indexOf('\r\n\r\n');
  const httpStart = warcEnd + 4;
  const httpEnd = rec.indexOf('\r\n\r\n', httpStart);
  const httpHeaders = rec.slice(httpStart, httpEnd === -1 ? httpStart : httpEnd).toString('latin1');
  let body: Buffer<ArrayBufferLike> = rec.slice(httpEnd === -1 ? httpStart : httpEnd + 4);

  const statusLine = httpHeaders.split('\r\n')[0] || '';
  const status = Number(statusLine.split(' ')[1]) || 200;
  const headerLc = httpHeaders.toLowerCase();

  if (/transfer-encoding:\s*chunked/.test(headerLc)) body = dechunk(body);
  const enc = (headerLc.match(/content-encoding:\s*([^\r\n]+)/)?.[1] || '').trim();
  if (enc.includes('br')) body = safe(() => zlib.brotliDecompressSync(body), body);
  else if (enc.includes('gzip')) body = safe(() => zlib.gunzipSync(body), body);
  else if (enc.includes('deflate')) body = safe(() => zlib.inflateSync(body), () => zlib.inflateRawSync(body), body);

  const charset = (headerLc.match(/charset=["']?([\w-]+)/)?.[1] || 'utf-8').replace('utf8', 'utf-8');
  const html = body.toString(decodeCharset(charset));

  return {
    url: loc.url,
    timestamp: loc.timestamp,
    capturedAt: cdxDate(loc.timestamp),
    status,
    title: titleOf(html),
    html,
    markdown: htmlToMarkdown(html),
    text: htmlToText(html),
    source: 'commoncrawl',
  };
}

// --- helpers -----------------------------------------------------------------

function gunzipSafe(buf: Buffer): Buffer<ArrayBufferLike> {
  try {
    return zlib.gunzipSync(buf);
  } catch {
    // some records concatenate members; gunzip stops at first — accept partial.
    return zlib.gunzipSync(buf, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
  }
}

// HTTP/1.1 chunked transfer decoding over a Buffer.
function dechunk(buf: Buffer<ArrayBufferLike>): Buffer<ArrayBufferLike> {
  const out: Buffer[] = [];
  let i = 0;
  while (i < buf.length) {
    const nl = buf.indexOf('\r\n', i);
    if (nl === -1) break;
    const size = parseInt(buf.slice(i, nl).toString('latin1').trim(), 16);
    if (!Number.isFinite(size) || size <= 0) break;
    const start = nl + 2;
    out.push(buf.slice(start, start + size));
    i = start + size + 2; // skip chunk + trailing CRLF
  }
  return out.length ? Buffer.concat(out) : buf;
}

type Buf = Buffer<ArrayBufferLike>;
function safe(...fns: Array<(() => Buf) | Buf>): Buf {
  for (const f of fns) {
    if (typeof f !== 'function') return f;
    try {
      return f();
    } catch {
      /* try next */
    }
  }
  return Buffer.alloc(0);
}

function decodeCharset(cs: string): BufferEncoding {
  const c = cs.toLowerCase();
  if (c === 'utf-8' || c === 'utf8') return 'utf-8';
  if (c === 'iso-8859-1' || c === 'latin1' || c === 'windows-1252') return 'latin1';
  if (c === 'ascii' || c === 'us-ascii') return 'ascii';
  return 'utf-8';
}

function cdxDate(ts?: string): string | undefined {
  if (!ts || ts.length < 14) return undefined;
  const [y, mo, d, h, mi, s] = [ts.slice(0, 4), ts.slice(4, 6), ts.slice(6, 8), ts.slice(8, 10), ts.slice(10, 12), ts.slice(12, 14)];
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
}

// Inject a <base> so the archived HTML's relative assets resolve against the
// captured origin (best-effort rendering of an old snapshot).
export function withBase(html: string, originUrl: string): string {
  try {
    const origin = new URL(originUrl).origin + '/';
    if (/<base\s/i.test(html)) return html;
    return html.replace(/<head([^>]*)>/i, `<head$1><base href="${origin}">`);
  } catch {
    return html;
  }
}
