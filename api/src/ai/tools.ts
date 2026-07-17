// Built-in tools the AI Mode agent can call — they drive the rest of HD-Search
// (search, crawl). Each tool = an Anthropic tool definition + an executor returning
// compact content + citations for the UI. MCP tools slot in later with the same shape.
// See docs/AI_MODE_SPEC.md §5, §8.
import { runSearch } from '../engine.js';
import { fetchCapture } from '../archive.js';
import { MODALITIES } from '../types.js';
import type { CrawlRequest } from '../types.js';
import { runCrawl } from '../engine.js';

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}
export interface ToolResult {
  content: string; // text fed back to the model
  citations?: { title: string; url: string }[]; // surfaced in the UI
  ui?: { kind: string; data: unknown }; // tool-ui payload
}

/** How much source text hd_search injects into tool content (RAG depth). */
export type SourceDetailsLevel = 'low' | 'medium' | 'high';

export interface ToolRunContext {
  userId?: string;
  sourceDetails?: SourceDetailsLevel;
}

export interface BuiltinTool {
  def: ToolDef;
  run(input: any, ctx?: ToolRunContext): Promise<ToolResult>;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\s*\.\.\.\s*$/, '');
}

const PAGE_CHARS = 6000;

function formatResultLines(results: any[], maxSnippet = 280): string {
  return results
    .map(
      (r, i) =>
        `[${i + 1}] ${decodeEntities(r.title || r.url || 'result')}\n${r.url}\n${decodeEntities((r.snippet || '').slice(0, maxSnippet))}`,
    )
    .join('\n\n');
}

function isCrawlablePageUrl(url: string): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  if (/\.(jpe?g|png|gif|webp|svg|bmp|avif|mp4|webm|mp3|pdf)(\?|$)/i.test(url)) return false;
  return true;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (!items.length) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      const item = items[i];
      if (item === undefined) continue;
      results[i] = await fn(item, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/** Self-hosted crawlers only — never fall through to jina/basic for AI RAG. */
const AI_RAG_CRAWL_ENGINES = ['crawl4ai', 'browserless'] as const;

async function fetchPageMarkdown(url: string, userId?: string): Promise<{ title: string; markdown: string } | null> {
  for (const engine of AI_RAG_CRAWL_ENGINES) {
    const req: CrawlRequest = {
      url,
      formats: ['markdown', 'text'],
      render: engine === 'browserless',
      store: false,
      noCache: false,
      quiet: true,
      engine,
    };
    const resp = await runCrawl(req, userId);
    const markdown = (resp.result?.markdown || resp.result?.text || '').slice(0, PAGE_CHARS);
    if (markdown) return { title: resp.result?.title || url, markdown };
  }
  return null;
}

/** Append full page text for top N crawlable result URLs (Medium=3, High=10). */
async function enrichWithSourcePages(
  baseContent: string,
  results: any[],
  level: SourceDetailsLevel,
  userId?: string,
): Promise<string> {
  if (level === 'low' || !results.length) return baseContent;
  const limit = level === 'medium' ? 3 : 10;
  const urls = [...new Set(results.map((r) => String(r.url || '')).filter(isCrawlablePageUrl))].slice(0, limit);
  if (!urls.length) return baseContent;

  const pages = await mapPool(urls, 3, async (url, i) => {
    try {
      const page = await fetchPageMarkdown(url, userId);
      return { index: i + 1, url, page };
    } catch {
      return { index: i + 1, url, page: null as { title: string; markdown: string } | null };
    }
  });

  const sections = [baseContent, '', '--- Full source text ---'];
  for (const { index, url, page } of pages) {
    if (page) {
      sections.push(`\n[Source ${index}] ${page.title}\n${url}\n\n${page.markdown}`);
    } else {
      sections.push(`\n[Source ${index}] ${url}\n(Could not read this page.)`);
    }
  }
  return sections.join('\n');
}

async function buildSearchContent(intro: string, results: any[], ctx?: ToolRunContext, maxSnippet = 280): Promise<string> {
  if (!results.length) return intro.includes('No ') ? intro : 'No results.';
  const base = `${intro}\n\n${formatResultLines(results, maxSnippet)}`;
  return enrichWithSourcePages(base, results, ctx?.sourceDetails ?? 'low', ctx?.userId);
}

const hdSearch: BuiltinTool = {
  def: {
    name: 'hd_search',
    description:
      'Search the web and many other sources via HD-Search. Use for current facts, news, links, images, videos, scholarly, code, places/maps, or darkweb. Returns ranked, deduplicated results with titles, URLs and snippets to ground your answer. Always cite the URLs you use.',
    input_schema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'The search query' },
        modality: { type: 'string', enum: [...MODALITIES], description: 'Content type (default web)' },
        limit: { type: 'integer', description: 'Max results (default 8)', minimum: 1, maximum: 20 },
      },
      required: ['q'],
    },
  },
  async run(input, ctx) {
    const userId = ctx?.userId;
    let modality: string = input.modality || 'web';
    if (modality === 'web') {
      const q = String(input.q).toLowerCase();
      if (/\b(image|photo|picture|pic|wallpaper|illustration|diagram)\b/.test(q)) modality = 'images';
      else if (/\b(video|watch|clip|footage|trailer)\b/.test(q)) modality = 'videos';
      else if (/\b(news|latest|headline|breaking|recent developments)\b/.test(q)) modality = 'news';
      else if (/\b(paper|research|scholar|academic|journal|study|pubmed)\b/.test(q)) modality = 'scholar';
    }
    const resp = await runSearch(
      { q: String(input.q), modality, mode: 'fallback', limit: Math.min(input.limit || 8, 20), page: 1, safe: true, facets: false, noCache: false } as any,
      userId,
    );
    const top = (resp.results || []).slice(0, Math.min(input.limit || 8, 20));
    // place/maps searches render as an interactive map instead of a link grid
    if (modality === 'maps') {
      const ui = placesUi(String(input.q), top);
      if (ui) {
        const placeLines = ui.data.places.map((p, i) => `[${i + 1}] ${p.title}${p.address ? ` — ${p.address}` : ''}${p.url ? `\n${p.url}` : ''}`);
        const base = `Found ${ui.data.places.length} places for "${input.q}" (shown on a map to the user):\n${placeLines.join('\n')}`;
        const content = await enrichWithSourcePages(base, top, ctx?.sourceDetails ?? 'low', ctx?.userId);
        return {
          content,
          citations: ui.data.places.filter((p) => p.url).map((p) => ({ title: p.title, url: p.url })),
          ui,
        };
      }
    }
    // Image searches → image gallery card
    if (modality === 'images') {
      const images = top
        .map((r) => {
          const imgUrl = (r as any).thumbnail || (r as any).image || (r.extra as any)?.thumbnail || (r.extra as any)?.image || '';
          if (!imgUrl || !/\.(jpe?g|png|gif|webp|svg|bmp|avif)/i.test(imgUrl)) return null;
          return { url: imgUrl, alt: decodeEntities(r.title), caption: decodeEntities((r.snippet || '').slice(0, 100)) };
        })
        .filter(Boolean) as { url: string; alt: string; caption: string }[];
      if (images.length) {
        return {
          content: await buildSearchContent(`Found ${images.length} images for "${input.q}"`, top, ctx),
          citations: top.map((r) => ({ title: r.title, url: r.url })),
          ui: { kind: 'image_gallery', data: { images } },
        };
      }
    }
    // Video searches → video card
    if (modality === 'videos') {
      const videos = top.map((r) => ({
        url: r.url,
        title: decodeEntities(r.title),
        thumbnail: (r as any).thumbnail || (r.extra as any)?.thumbnail || '',
        duration: (r.extra as any)?.duration || '',
      }));
      if (videos.length) {
        return {
          content: await buildSearchContent(`Found ${videos.length} videos for "${input.q}"`, top, ctx),
          citations: top.map((r) => ({ title: r.title, url: r.url })),
          ui: { kind: 'video', data: videos.length === 1 ? videos[0] : { videos } },
        };
      }
    }
    // News searches → link preview cards
    if (modality === 'news') {
      const previews = top.map((r) => ({
        url: r.url,
        title: decodeEntities(r.title),
        description: decodeEntities((r.snippet || '').slice(0, 200)),
        image: (r as any).thumbnail || (r.extra as any)?.thumbnail || '',
        favicon: (r.extra as any)?.favicon || '',
      }));
      if (previews.length) {
        return {
          content: await buildSearchContent(`Found ${previews.length} news articles for "${input.q}"`, top, ctx),
          citations: top.map((r) => ({ title: r.title, url: r.url })),
          ui: { kind: 'link_preview', data: { items: previews } },
        };
      }
    }
    // Scholar searches → citation card
    if (modality === 'scholar') {
      const sources = top.map((r) => ({
        title: decodeEntities(r.title),
        url: r.url,
        snippet: decodeEntities((r.snippet || '').slice(0, 300)),
        date: (r.extra as any)?.date || (r.extra as any)?.year || '',
      }));
      if (sources.length) {
        const scholarLines = top.map((r, i) => {
          const date = (r.extra as any)?.date || (r.extra as any)?.year || '';
          return `[${i + 1}] ${decodeEntities(r.title)}\n${r.url}${date ? `\n${date}` : ''}\n${decodeEntities((r.snippet || '').slice(0, 300))}`;
        });
        const base = `Found ${sources.length} scholarly results for "${input.q}":\n\n${scholarLines.join('\n\n')}`;
        return {
          content: await enrichWithSourcePages(base, top, ctx?.sourceDetails ?? 'low', ctx?.userId),
          citations: top.map((r) => ({ title: r.title, url: r.url })),
          ui: { kind: 'citation', data: { sources } },
        };
      }
    }
    // Default: web search card
    return {
      content: await buildSearchContent(
        top.length ? `Found ${top.length} results for "${input.q}"` : `No results for "${input.q}"`,
        top,
        ctx,
      ),
      citations: top.map((r) => ({ title: r.title, url: r.url })),
      ui: { kind: 'search', data: { query: input.q, engines: resp.enginesUsed?.filter((e) => e.ok).map((e) => e.engine), results: top.map((r) => ({ title: decodeEntities(r.title), url: r.url, snippet: decodeEntities(r.snippet || ''), source: r.source })) } },
    };
  },
};

// Build a map-ready UI payload from geo-located (maps modality) results.
function placesUi(query: string, results: any[]) {
  const places = results
    .map((r) => {
      const g = (r.extra as any)?.geo;
      if (!g || typeof g.lat !== 'number' || typeof g.lon !== 'number') return null;
      return { title: r.title, lat: g.lat, lon: g.lon, address: r.snippet || '', kind: g.kind || '', url: r.url };
    })
    .filter(Boolean) as { title: string; lat: number; lon: number; address: string; kind: string; url: string }[];
  if (!places.length) return null;
  const center = { lat: places[0]!.lat, lon: places[0]!.lon };
  return { kind: 'map', data: { query, center, places } };
}

const hdMaps: BuiltinTool = {
  def: {
    name: 'hd_maps',
    description:
      'Find places, businesses, or points of interest for a location query (e.g. "coffee shops in San Ramon, CA", "pharmacies near Dublin, CA", "the Eiffel Tower") and return them as map pins with names, addresses and coordinates. Use this for ANY "<thing> in/near <place>" or "where is <place>" question — the answer is rendered as an interactive map for the user, so prefer it over a plain web search for place lookups.',
    input_schema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Place query, e.g. "coffee shops in San Ramon, CA"' },
        limit: { type: 'integer', description: 'Max places (default 12)', minimum: 1, maximum: 30 },
      },
      required: ['q'],
    },
  },
  async run(input, ctx) {
    const userId = ctx?.userId;
    const resp = await runSearch(
      { q: String(input.q), modality: 'maps', mode: 'fallback', limit: Math.min(input.limit || 12, 30), page: 1, safe: true, facets: false, noCache: false } as any,
      userId,
    );
    const results = resp.results || [];
    const ui = placesUi(String(input.q), results);
    if (!ui) {
      return { content: `No mappable places found for "${input.q}". It may not be a recognizable location.` };
    }
    const lines = ui.data.places.map((p, i) => `[${i + 1}] ${p.title}${p.address ? ` — ${p.address}` : ''}`);
    return {
      content: `Found ${ui.data.places.length} places for "${input.q}" (shown on a map to the user):\n${lines.join('\n')}`,
      citations: ui.data.places.filter((p) => p.url).map((p) => ({ title: p.title, url: p.url })),
      ui,
    };
  },
};

// Plot a model-supplied list of place/region NAMES on a map. Unlike hd_maps (which
// geocodes one place query + finds POIs), this lets the agent visualize a *concept* —
// a species' range, countries in a treaty, cities on a tour — by naming the locations it
// already knows (from its own knowledge or search results) and letting us geocode them.
const hdPlotMap: BuiltinTool = {
  def: {
    name: 'hd_plot_map',
    description:
      "Plot a set of named places or regions on an interactive map for the user. Use this whenever the user asks to \"show on a map\" something that ISN'T a single local search — e.g. a species' habitat range, the countries a river runs through, cities on an itinerary, or any list of locations you can name. " +
      "IMPORTANT: give each place an UNAMBIGUOUS, fully-qualified name so it geocodes to the right spot — always append the country or territory (and state/region if helpful). E.g. use \"New Caledonia, France\" not \"New Caledonia\" (which also matches a town in Arkansas, USA); \"Cape York Peninsula, Queensland, Australia\" not \"Cape York\". They will be geocoded and pinned. Prefer this over saying you cannot display a map.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'A short title for the map, e.g. "Eclectus parrot range"' },
        places: {
          type: 'array',
          description: 'The places/regions to plot. 1–40 items.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Place/region name to geocode, e.g. "Solomon Islands"' },
              note: { type: 'string', description: 'Optional short note shown with the pin' },
            },
            required: ['name'],
          },
        },
      },
      required: ['places'],
    },
  },
  async run(input, _ctx) {
    const items: { name: string; note?: string }[] = Array.isArray(input.places) ? input.places : [];
    const names = items.map((p) => String(p?.name || '')).filter(Boolean);
    if (!names.length) return { content: 'No place names provided to plot.' };
    const { geocodeMany } = await import('./geocode.js');
    const pts = await geocodeMany(names);
    if (!pts.length) {
      return { content: `Could not geocode any of: ${names.join(', ')}. Try more specific names (add the country).` };
    }
    const noteFor = new Map(items.map((p) => [String(p.name), p.note]));
    const places = pts.map((p) => ({
      title: p.name,
      lat: p.lat,
      lon: p.lon,
      address: noteFor.get(p.name) || p.address || '',
      kind: '',
      url: `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=6/${p.lat}/${p.lon}`,
    }));
    const missing = names.filter((n) => !pts.some((p) => p.name === n));
    const lines = places.map((p, i) => `[${i + 1}] ${p.title}${p.address ? ` — ${p.address}` : ''}`);
    return {
      content:
        `Plotted ${places.length} location(s) on a map for the user:\n${lines.join('\n')}` +
        (missing.length ? `\n(could not locate: ${missing.join(', ')})` : ''),
      ui: { kind: 'map', data: { query: input.title || 'Map', center: { lat: places[0]!.lat, lon: places[0]!.lon }, places } },
    };
  },
};

const hdCrawl: BuiltinTool = {
  def: {
    name: 'hd_crawl',
    description:
      'Fetch a specific URL and return its clean, readable content as markdown. Use when you have a URL (e.g. from hd_search) and need the full page text to answer accurately.',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The URL to fetch' } },
      required: ['url'],
    },
  },
  async run(input, ctx) {
    const userId = ctx?.userId;
    const req: CrawlRequest = { url: String(input.url), formats: ['markdown'], render: false, store: false, noCache: false } as any;
    const resp = await runCrawl(req, userId);
    const md = (resp.result?.markdown || '').slice(0, 6000);
    return {
      content: md || `Could not extract content from ${input.url}`,
      citations: resp.result ? [{ title: resp.result.title || input.url, url: input.url }] : [],
      ui: { kind: 'crawl', data: { url: input.url, title: resp.result?.title, source: resp.result?.source, chars: md.length } },
    };
  },
};

const hdArchive: BuiltinTool = {
  def: {
    name: 'hd_archive',
    description:
      'Fetch an archived (historical) capture of a URL from Common Crawl. Use to see how a page looked in the past or when the live page is unavailable.',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The original URL' } },
      required: ['url'],
    },
  },
  async run(input, _ctx) {
    try {
      const cap = await fetchCapture({ url: String(input.url) });
      return {
        content: (cap.markdown || '').slice(0, 6000) || 'No archived content found.',
        citations: [{ title: cap.title || input.url, url: input.url }],
        ui: { kind: 'archive', data: { url: input.url, title: cap.title, capturedAt: cap.capturedAt, source: cap.source === 'wayback' ? 'Wayback Machine' : 'Common Crawl' } },
      };
    } catch (e) {
      return { content: `No archived capture available for ${input.url}.` };
    }
  },
};

const hdChart: BuiltinTool = {
  def: {
    name: 'hd_chart',
    description:
      'Render a chart (bar, line, pie, or area) to visualize data for the user. Use when the user asks to compare numbers, show trends, or visualize data. You supply the labels and datasets.',
    input_schema: {
      type: 'object',
      properties: {
        chartType: { type: 'string', enum: ['bar', 'line', 'pie', 'area'], description: 'Chart type' },
        title: { type: 'string', description: 'Chart title' },
        labels: { type: 'array', items: { type: 'string' }, description: 'X-axis labels or pie segment labels' },
        datasets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              data: { type: 'array', items: { type: 'number' } },
              color: { type: 'string' },
            },
            required: ['label', 'data'],
          },
        },
      },
      required: ['chartType', 'labels', 'datasets'],
    },
  },
  async run(input, _ctx) {
    return {
      content: `Chart rendered: ${input.title || input.chartType} with ${input.labels?.length || 0} data points.`,
      ui: {
        kind: 'chart',
        data: { chartType: input.chartType, title: input.title, labels: input.labels, datasets: input.datasets },
      },
    };
  },
};

const hdWeather: BuiltinTool = {
  def: {
    name: 'hd_weather',
    description:
      'Get current weather and forecast for a location. Returns temperature, conditions, humidity, wind, and a multi-day forecast.',
    input_schema: {
      type: 'object',
      properties: { location: { type: 'string', description: 'City or place name' } },
      required: ['location'],
    },
  },
  async run(input, _ctx) {
    try {
      const res = await fetch(`https://wttr.in/${encodeURIComponent(input.location)}?format=j1`, {
        signal: AbortSignal.timeout(5000),
        headers: { 'user-agent': 'hd-search/1.0' },
      });
      if (!res.ok) return { content: `Could not fetch weather for "${input.location}".` };
      const w = (await res.json()) as any;
      const cur = w.current_condition?.[0];
      const forecast = (w.weather || []).slice(0, 5).map((d: any) => ({
        day: d.date,
        high: Number(d.maxtempC),
        low: Number(d.mintempC),
        condition: d.hourly?.[4]?.weatherDesc?.[0]?.value || '',
      }));
      const data = {
        location: w.nearest_area?.[0]?.areaName?.[0]?.value || input.location,
        temp: Number(cur?.temp_C || 0),
        unit: 'C',
        condition: cur?.weatherDesc?.[0]?.value || '',
        humidity: Number(cur?.humidity || 0),
        wind: `${cur?.windspeedKmph || 0} km/h ${cur?.winddir16Point || ''}`,
        forecast,
      };
      return {
        content: `Weather in ${data.location}: ${data.temp}°C, ${data.condition}. Humidity ${data.humidity}%. Wind ${data.wind}.`,
        ui: { kind: 'weather', data },
      };
    } catch {
      return { content: `Could not fetch weather for "${input.location}".` };
    }
  },
};

const hdRender: BuiltinTool = {
  def: {
    name: 'hd_render',
    description:
      'Render a rich UI component for the user. Use to display code blocks, data tables, stats dashboards, plans, progress trackers, social post previews, message drafts, terminal output, diffs, or approval cards. The `kind` field selects the component; `payload` is the component data.',
    input_schema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: [
            'code_block',
            'code_diff',
            'data_table',
            'stats',
            'plan',
            'progress',
            'social_post',
            'message_draft',
            'terminal',
            'option_list',
            'approval',
            'order_summary',
            'link_preview',
            'citation',
            'item_carousel',
            'question_flow',
          ],
          description: 'UI component type',
        },
        title: { type: 'string', description: 'Optional title' },
        payload: { type: 'object', description: 'Component-specific data (see tool docs)' },
      },
      required: ['kind', 'payload'],
    },
  },
  async run(input, _ctx) {
    const kind = String(input.kind || 'terminal');
    const payload = input.payload || {};
    return {
      content: `Rendered ${kind} component${input.title ? `: ${input.title}` : ''}.`,
      ui: { kind, data: { ...payload, title: input.title } },
    };
  },
};

const BUILTINS: BuiltinTool[] = [hdSearch, hdMaps, hdPlotMap, hdCrawl, hdArchive, hdChart, hdWeather, hdRender];
const BY_NAME = new Map(BUILTINS.map((t) => [t.def.name, t]));

export function builtinToolDefs(): ToolDef[] {
  return BUILTINS.map((t) => t.def);
}
export function getTool(name: string): BuiltinTool | undefined {
  return BY_NAME.get(name);
}

/** A tool the agent can call, normalized across built-ins and MCP servers. */
export interface AgentTool {
  def: ToolDef;
  source: 'builtin' | 'mcp';
  server?: string; // MCP server id, when source==='mcp'
  run(input: any, ctx?: ToolRunContext): Promise<ToolResult>;
}

/**
 * Assemble the full tool set available to the agent for this user: built-ins plus any
 * tools exposed by connected MCP servers. Returns the specs (for the LLM) and a runner
 * keyed by tool name. MCP failures degrade gracefully to built-ins only.
 */
export async function collectTools(userId?: string): Promise<{
  specs: ToolDef[];
  byName: Map<string, AgentTool>;
}> {
  const byName = new Map<string, AgentTool>();
  for (const t of BUILTINS) byName.set(t.def.name, { def: t.def, source: 'builtin', run: t.run });

  // MCP tools (config-driven). Loaded lazily so the engine has no hard dependency.
  try {
    const { mcpTools } = await import('./mcp/registry.js');
    for (const t of await mcpTools(userId)) {
      // built-ins win on a name clash (MCP tools are namespaced, so this is rare)
      if (!byName.has(t.def.name)) byName.set(t.def.name, t);
    }
  } catch {
    /* MCP unavailable → built-ins only */
  }

  return { specs: [...byName.values()].map((t) => t.def), byName };
}
