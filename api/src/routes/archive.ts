// Archive endpoint — render or extract a Common Crawl capture (the archived page,
// not the live site). `format=html` streams the archived HTML for viewing;
// otherwise returns JSON { markdown, text, title, capturedAt } for the open-search
// "Extract" action on archive results.
import { Hono } from 'hono';
import { requireAuth, requireScope } from '../auth.js';
import { fetchCapture, fetchWayback, withBase } from '../archive.js';
import { log, errFields } from '../logger.js';

export const archiveRoutes = new Hono();

archiveRoutes.use('*', requireAuth());

archiveRoutes.get('/', requireScope('search:read'), async (c) => {
  const url = c.req.query('url');
  if (!url) return c.json({ error: 'bad_request', message: 'url is required' }, 400);
  const format = c.req.query('format') || 'json';
  const provider = c.req.query('provider') === 'wayback' ? 'wayback' : 'commoncrawl';
  const ts = c.req.query('ts') || undefined;
  try {
    const cap =
      provider === 'wayback'
        ? await fetchWayback(url, ts)
        : await fetchCapture({
            url,
            timestamp: ts,
            filename: c.req.query('filename') || undefined,
            offset: c.req.query('offset') ? Number(c.req.query('offset')) : undefined,
            length: c.req.query('length') ? Number(c.req.query('length')) : undefined,
          });
    if (format === 'html') {
      c.header('content-type', 'text/html; charset=utf-8');
      c.header('x-archive-source', provider);
      return c.body(withBase(cap.html, cap.url));
    }
    return c.json({
      url: cap.url,
      timestamp: cap.timestamp,
      capturedAt: cap.capturedAt,
      status: cap.status,
      title: cap.title,
      markdown: cap.markdown,
      text: cap.text,
      source: provider,
    });
  } catch (e) {
    log.warn('archive fetch failed', errFields(e));
    return c.json({ error: 'archive_failed', message: (e as Error).message }, 502);
  }
});
