// Helpers shared by provider implementations: build normalized results and do
// lightweight HTML→text extraction without pulling a full parser dependency.
import { dedupId } from '../normalize.js';
import type { Modality, NormalizedResult } from '../types.js';

export function mkResult(
  source: string,
  modality: Modality,
  fields: Partial<NormalizedResult> & { title: string; url: string },
): NormalizedResult {
  return {
    id: dedupId(fields.url, fields.title),
    source,
    modality,
    ...fields,
  };
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#x2F;/g, '/');
}

/** Naive but robust readability: collect text from <p>, <h1-3>, <li>. */
export function htmlToText(html: string): string {
  const blocks: string[] = [];
  const re = /<(p|h1|h2|h3|li)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const t = stripHtml(m[2] || '');
    if (t.length > 1) blocks.push(t);
  }
  const text = blocks.join('\n\n');
  return text || stripHtml(html);
}

export function htmlToMarkdown(html: string): string {
  // minimal: headings + paragraphs + links. Good enough for LLM grounding when a
  // dedicated crawler (crawl4ai/firecrawl) isn't available.
  let out = html;
  out = out.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_x, t) => `\n# ${stripHtml(t)}\n`);
  out = out.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_x, t) => `\n## ${stripHtml(t)}\n`);
  out = out.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_x, t) => `\n### ${stripHtml(t)}\n`);
  out = out.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_x, href, t) => `[${stripHtml(t)}](${href})`);
  out = out.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_x, t) => `\n- ${stripHtml(t)}`);
  out = out.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_x, t) => `\n${stripHtml(t)}\n`);
  return stripHtml(out.replace(/<[^>]+>/g, ' ')).length > 0
    ? out
        .replace(/<[^>]+>/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    : '';
}

export function extractLinks(html: string, base?: string): string[] {
  const links = new Set<string>();
  const re = /<a[^>]*href="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let href = m[1]!;
    try {
      href = base ? new URL(href, base).toString() : href;
      if (/^https?:/i.test(href)) links.add(href);
    } catch {
      /* skip */
    }
  }
  return [...links];
}

export function extractImages(html: string, base?: string): string[] {
  const imgs = new Set<string>();
  const re = /<img[^>]*src="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let src = m[1]!;
    try {
      src = base ? new URL(src, base).toString() : src;
      if (/^https?:/i.test(src)) imgs.add(src);
    } catch {
      /* skip */
    }
  }
  return [...imgs];
}

export function titleOf(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(stripHtml(m[1] || '')) : undefined;
}
