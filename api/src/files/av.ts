// Optional antivirus scan hook. When HDSEARCH_FILE_AV_URL is set, the worker posts
// the raw bytes for scanning before indexing. The endpoint contract: respond 200
// with JSON { infected: boolean } (or HTTP 4xx to signal infected). Fail-open on a
// scanner outage by default (return 'unknown') so a dead scanner doesn't wedge the
// pipeline — set HDSEARCH_FILE_AV_FAIL_CLOSED=1 to quarantine on scanner failure.
import { env } from '../env.js';
import { log, errFields } from '../logger.js';

const FAIL_CLOSED = /^(1|true|yes|on)$/i.test(process.env.HDSEARCH_FILE_AV_FAIL_CLOSED || '');

export type AvVerdict = 'clean' | 'infected' | 'unknown';

export async function scanFile(buffer: Buffer, name: string): Promise<AvVerdict> {
  if (!env.file.avUrl) return 'unknown';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 60000);
    const res = await fetch(env.file.avUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name) },
      body: buffer as any,
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
    if (res.status >= 400) return 'infected';
    const data = (await res.json().catch(() => ({}))) as { infected?: boolean };
    return data.infected ? 'infected' : 'clean';
  } catch (e) {
    log.warn('AV scan failed', { failClosed: FAIL_CLOSED, ...errFields(e) });
    return FAIL_CLOSED ? 'infected' : 'unknown';
  }
}
