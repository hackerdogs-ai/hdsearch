// First-run gate. Until infrastructure setup is marked complete, every page request is
// redirected to the /setup wizard (the "OS install" flow). The check is a cheap same-origin
// call to the BFF status route (which injects the internal secret server-side) — it reads
// the saved config flag only and does NOT probe services, so it stays fast on every nav.
//
// Runs on page routes only (see matcher); /api, /setup, static assets, and Next internals
// are excluded so the wizard, its proxy routes, and asset loads are never intercepted.
import { NextRequest, NextResponse } from 'next/server';

export async function middleware(req: NextRequest) {
  try {
    const res = await fetch(`${req.nextUrl.origin}/api/setup/status`, {
      headers: { 'x-forwarded-host': req.headers.get('host') || '' },
      cache: 'no-store',
    });
    // API unreachable (502) or setup not complete → send to the wizard so the operator
    // can point HD-Search at its datastores. A reachable-but-incomplete config also lands here.
    if (!res.ok) return NextResponse.redirect(new URL('/setup', req.url));
    const data = await res.json().catch(() => ({}));
    if (!data.setupComplete) return NextResponse.redirect(new URL('/setup', req.url));
  } catch {
    return NextResponse.redirect(new URL('/setup', req.url));
  }
  return withPathname(req);
}

/**
 * Server components cannot read the current pathname, so expose it as a header.
 * The disclaimer gate needs it to send the user back where they were headed
 * instead of dumping them on the search page.
 */
function withPathname(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set('x-pathname', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Exclude api routes, the setup wizard itself, Next internals, and common static files.
  matcher: ['/((?!api|setup|_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:png|jpg|jpeg|svg|ico|webp|css|js|map)$).*)'],
};
