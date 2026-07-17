import 'server-only';
import type { NextRequest } from 'next/server';

// The browser-facing origin of THIS request. Honors a reverse proxy / tunnel via
// X-Forwarded-Host / X-Forwarded-Proto (and falls back to Host, then req.url), so
// auth redirects and the session cookie always land on the origin the user actually
// used — localhost, 127.0.0.1, a custom port, a proxy, or a deployed domain — rather
// than a hardcoded base URL or the server's internal bind address.
export function requestOrigin(req: NextRequest): string {
  const h = req.headers;
  const host = h.get('x-forwarded-host') || h.get('host');
  if (!host) return new URL(req.url).origin;
  const proto = h.get('x-forwarded-proto')?.split(',')[0]?.trim() || new URL(req.url).protocol.replace(':', '');
  return `${proto}://${host}`;
}

/** Absolute URL for `path` on the request's browser-facing origin. */
export function appPath(req: NextRequest, path: string): URL {
  return new URL(path, requestOrigin(req));
}
