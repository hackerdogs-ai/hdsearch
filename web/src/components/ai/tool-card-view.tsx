'use client';

import { MapCard } from '../map-card';
import { CARD_REGISTRY } from '../tool-cards';
import { hostOf, faviconFor } from '../markdown';
import type { HdsToolResult } from './types';

export interface ToolCardProps {
  id?: string;
  name: string;
  input?: Record<string, unknown>;
  ui?: { kind: string; data: unknown };
  citations?: { title: string; url: string }[];
  error?: string;
  done?: boolean;
}

/** Rich tool-UI card (tool-ui pattern) — used by assistant-ui tool-call renderers. */
export function ToolCardView({ tool }: { tool: ToolCardProps }) {
  const kind = tool.ui?.kind || tool.name;
  const meta = toolMeta(tool);

  return (
    <div className="mb-2 overflow-hidden rounded-xl border border-ink-200 bg-gradient-to-b from-ink-50 to-white">
      <div className="flex items-center gap-2 border-b border-ink-100 px-3 py-2 text-sm">
        <span className="text-ink-600">{meta.icon}</span>
        <span className="font-medium text-ink-700">{meta.title}</span>
        {meta.badge && <span className="chip bg-white py-0.5 text-sm text-ink-500">{meta.badge}</span>}
        {!tool.done ? (
          <span className="ml-auto flex items-center gap-1.5 text-ink-400">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-ink-300 border-t-brand-500" />
            running
          </span>
        ) : tool.error ? (
          <span className="ml-auto text-amber-600">error</span>
        ) : (
          <span className="ml-auto text-emerald-600">✓ done</span>
        )}
      </div>

      {tool.done && !tool.error && (
        <div className="p-3">
          {kind === 'map' ? (
            <MapCard data={tool.ui?.data as Parameters<typeof MapCard>[0]['data']} />
          ) : kind === 'hd_search' || kind === 'search' ? (
            <SearchCard data={tool.ui?.data} />
          ) : kind === 'hd_crawl' || kind === 'crawl' ? (
            <CrawlCard data={tool.ui?.data} input={tool.input} />
          ) : kind === 'hd_archive' || kind === 'archive' ? (
            <ArchiveCard data={tool.ui?.data} input={tool.input} />
          ) : CARD_REGISTRY[kind] ? (
            (() => {
              const Card = CARD_REGISTRY[kind]!;
              return <Card data={tool.ui?.data} input={tool.input} />;
            })()
          ) : (
            <McpCard tool={tool} />
          )}
        </div>
      )}
      {tool.error && <div className="px-3 py-2 text-sm text-amber-700">{tool.error}</div>}
    </div>
  );
}

const TOOL_ICON_PATHS: Record<string, string> = {
  search:
    'M11 11l4 4M7 13a6 6 0 1 1 0-12 6 6 0 0 1 0 12Z',
  location_on: 'M12 21s6-5.33 6-10a6 6 0 1 0-12 0c0 4.67 6 10 6 10Zm0-8a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z',
  article: 'M6 4h8l4 4v12H6V4Zm8 0v4h4M8 11h8M8 15h8',
  inventory_2: 'M4 7h16v12H4V7Zm0-3h16v2H4V4Zm4 10h8',
  bar_chart: 'M5 19V9M10 19V5M15 19v-6M20 19V3',
  partly_cloudy_day: 'M8 14a4 4 0 0 1 7.5-1.5M6 18h10a4 4 0 0 0 0-8 4 4 0 0 0-.75.07',
  code: 'M9 8 5 12l4 4M15 8l4 4-4 4',
  difference: 'M8 6h8v12H8V6Zm2 2v2h4V8h-4Zm0 4v2h4v-2h-4Z',
  table_chart: 'M4 6h16v12H4V6Zm0 3h16M8 6v12M12 6v12M16 6v12',
  monitoring: 'M4 19V5M4 19h16M8 17V9M12 17V7M16 17v-4',
  terminal: 'M6 8l3 3-3 3M10 14h4M5 5h14v14H5V5Z',
  menu_book: 'M6 5h9a3 3 0 0 1 3 3v11H9a3 3 0 0 0-3 3V5Zm0 0h9v11',
  link: 'M10 14a4 4 0 0 1 0-5.66l1.41-1.41a4 4 0 0 1 5.66 5.66l-1.41 1.41M14 10a4 4 0 0 1 0 5.66l-1.41 1.41a4 4 0 0 1-5.66-5.66l1.41-1.41',
  view_carousel: 'M7 7h10v10H7V7Zm-3 0h1v10H4V7Zm15 0h1v10h-1V7Z',
  image: 'M5 5h14v14H5V5Zm2 2v8l3-3 2 2 3-4 2 3V7H7Z',
  photo_library: 'M4 6h16v12H4V6Zm2 2v8l3-3 2 2 3-4 2 3V8H6Z',
  play_circle: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Zm-1-13v6l5-3-5-3Z',
  headphones: 'M4 14a2 2 0 0 0 2 2h1v-5H6a2 2 0 0 0-2 2v1Zm14-3h-1v5h1a2 2 0 0 0 2-2v-1a2 2 0 0 0-2-2Z',
  checklist: 'M9 6h10M9 12h10M9 18h10M5 6l1 1 2-2M5 12l1 1 2-2M5 18l1 1 2-2',
  hourglass_top: 'M8 4h8l-2 4v4l2 4H8l2-4V8L8 4Z',
  forum: 'M6 18v-4H4V6h16v8h-6l-4 4Z',
  drafts: 'M6 4h10l4 4v12H6V4Zm10 0v4h4M8 12h8M8 16h6',
  task_alt: 'M9 11l2 2 4-4M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z',
  receipt_long: 'M6 4h12v16l-2-1-2 1-2-1-2 1-2-1-2 1V4Zm2 4h8M8 12h8M8 16h5',
  radio_button_checked: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Zm0-5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  quiz: 'M6 6h12v12H6V6Zm3 3h6M9 12h6M9 15h4',
  extension: 'M12 2l2 2h3v3l2 2-2 2v3h-3l-2 2-2-2H7v-3L5 12l2-2V7h3l2-2Z',
};

function ToolIcon({ name }: { name: string }) {
  const path = TOOL_ICON_PATHS[name] ?? TOOL_ICON_PATHS.extension;
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="block shrink-0"
    >
      <path d={path} />
    </svg>
  );
}

function toolMeta(tool: ToolCardProps): { icon: React.ReactNode; title: string; badge?: string } {
  const kind = tool.ui?.kind || tool.name;
  const data = tool.ui?.data as Record<string, unknown> | undefined;
  if (kind === 'map' || tool.name === 'hd_maps') {
    const n = (data?.places as unknown[])?.length;
    return {
      icon: <ToolIcon name="location_on" />,
      title: `Mapped "${String(tool.input?.q ?? data?.query ?? '')}"`,
      badge: n != null ? `${n} places` : 'mapping',
    };
  }
  if (kind === 'hd_search' || kind === 'search') {
    const n = (data?.results as unknown[])?.length;
    const engines = (data?.engines as unknown[])?.length;
    return {
      icon: <ToolIcon name="search" />,
      title: `Searched "${String(tool.input?.q ?? data?.query ?? '')}"`,
      badge: n != null ? `${n} results${engines ? ` · ${engines} engines` : ''}` : 'searching',
    };
  }
  if (kind === 'hd_crawl' || kind === 'crawl') {
    return {
      icon: <ToolIcon name="article" />,
      title: `Read ${hostOf(String(tool.input?.url ?? data?.url ?? ''))}`,
      badge: data?.chars ? `${((data.chars as number) / 1000).toFixed(1)}k chars` : undefined,
    };
  }
  if (kind === 'hd_archive' || kind === 'archive') {
    return {
      icon: <ToolIcon name="inventory_2" />,
      title: `Archived ${hostOf(String(tool.input?.url ?? ''))}`,
      badge: (data?.source as string) || (data?.capturedAt ? new Date(String(data.capturedAt)).getFullYear().toString() : undefined),
    };
  }
  const META: Record<string, { icon: React.ReactNode; title: string }> = {
    chart: { icon: <ToolIcon name="bar_chart" />, title: String(data?.title || 'Chart') },
    weather: { icon: <ToolIcon name="partly_cloudy_day" />, title: `Weather — ${String(data?.location || tool.input?.location || '')}` },
    code_block: { icon: <ToolIcon name="code" />, title: String(data?.filename || data?.language || 'Code') },
    code_diff: { icon: <ToolIcon name="difference" />, title: `Diff${data?.filename ? ` — ${data.filename}` : ''}` },
    data_table: { icon: <ToolIcon name="table_chart" />, title: String(data?.caption || 'Data Table') },
    stats: { icon: <ToolIcon name="monitoring" />, title: 'Stats' },
    terminal: { icon: <ToolIcon name="terminal" />, title: 'Terminal' },
    citation: { icon: <ToolIcon name="menu_book" />, title: 'Citations' },
    link_preview: { icon: <ToolIcon name="link" />, title: 'Link Preview' },
    item_carousel: { icon: <ToolIcon name="view_carousel" />, title: 'Results' },
    image: { icon: <ToolIcon name="image" />, title: String(data?.caption || 'Image') },
    image_gallery: { icon: <ToolIcon name="photo_library" />, title: `${(data?.images as unknown[])?.length || ''} Images` },
    video: { icon: <ToolIcon name="play_circle" />, title: String(data?.title || 'Video') },
    audio: { icon: <ToolIcon name="headphones" />, title: String(data?.title || 'Audio') },
    plan: { icon: <ToolIcon name="checklist" />, title: String(data?.title || 'Plan') },
    progress: { icon: <ToolIcon name="hourglass_top" />, title: String(data?.title || 'Progress') },
    social_post: { icon: <ToolIcon name="forum" />, title: `${String(data?.platform || 'social').charAt(0).toUpperCase()}${String(data?.platform || '').slice(1)} Post` },
    message_draft: { icon: <ToolIcon name="drafts" />, title: String(data?.subject || 'Draft') },
    approval: { icon: <ToolIcon name="task_alt" />, title: String(data?.title || 'Approval') },
    order_summary: { icon: <ToolIcon name="receipt_long" />, title: 'Order Summary' },
    option_list: { icon: <ToolIcon name="radio_button_checked" />, title: String(data?.question || 'Options') },
    question_flow: { icon: <ToolIcon name="quiz" />, title: 'Q&A' },
  };
  if (META[kind]) return META[kind]!;
  return {
    icon: <ToolIcon name="extension" />,
    title: tool.name,
    badge: data?.server ? `MCP · ${data.server}` : 'tool',
  };
}

function SearchCard({ data }: { data: unknown }) {
  const d = data as { results?: { url: string; title?: string; snippet?: string; source?: string }[] };
  const results = d?.results || [];
  if (!results.length) return <p className="text-sm text-ink-400">No results.</p>;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {results.slice(0, 6).map((r, i) => {
        const fav = faviconFor(r.url);
        return (
          <a
            key={i}
            href={r.url}
            target="_blank"
            rel="noreferrer"
            className="group rounded-lg border border-ink-100 bg-white p-2.5 transition hover:border-brand-300 hover:shadow-sm"
          >
            <div className="flex items-center gap-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {fav && <img src={fav} alt="" className="h-3.5 w-3.5 rounded" />}
              <span className="truncate text-sm text-ink-400">{hostOf(r.url)}</span>
              {r.source && <span className="chip ml-auto bg-ink-50 py-0 text-sm text-ink-400">{r.source}</span>}
            </div>
            <div className="mt-1 line-clamp-1 text-sm font-medium text-brand-700 group-hover:underline">{r.title}</div>
            {r.snippet && !r.title?.startsWith(r.snippet.slice(0, 40)) && !r.snippet.startsWith(r.title?.slice(0, 40) || '') && (
              <div className="mt-0.5 line-clamp-2 text-sm leading-snug text-ink-500">{r.snippet}</div>
            )}
          </a>
        );
      })}
    </div>
  );
}

function CrawlCard({ data, input }: { data: unknown; input?: Record<string, unknown> }) {
  const d = data as { url?: string; title?: string; source?: string; chars?: number };
  const url = d?.url || String(input?.url || '');
  return (
    <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-lg border border-ink-100 bg-white p-2.5 hover:border-brand-300">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {faviconFor(url) && <img src={faviconFor(url)!} alt="" className="h-6 w-6 rounded" />}
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-brand-700">{d?.title || url}</div>
        <div className="truncate text-sm text-ink-400">
          {hostOf(url)}
          {d?.source ? ` · via ${d.source}` : ''}
          {d?.chars ? ` · ${(d.chars / 1000).toFixed(1)}k chars extracted` : ''}
        </div>
      </div>
    </a>
  );
}

function ArchiveCard({ data, input }: { data: unknown; input?: Record<string, unknown> }) {
  const d = data as { url?: string; title?: string; source?: string; capturedAt?: string };
  const url = d?.url || String(input?.url || '');
  return (
    <div className="rounded-lg border border-ink-100 bg-white p-2.5 text-sm">
      <div className="font-medium text-ink-700">{d?.title || url}</div>
      <div className="mt-0.5 text-sm text-ink-400">
        {hostOf(url)}
        {d?.source ? ` · via ${d.source}` : ''}
        {d?.capturedAt ? ` · captured ${new Date(d.capturedAt).toLocaleDateString()}` : ''}
      </div>
    </div>
  );
}

function McpCard({ tool }: { tool: ToolCardProps }) {
  const data = (tool.ui?.data || {}) as Record<string, unknown>;
  const output = data.output ?? data.result ?? data.text ?? data.content;
  return (
    <div className="space-y-2 text-sm">
      {tool.input && Object.keys(tool.input).length > 0 && (
        <div className="rounded-lg bg-ink-50 p-2 font-mono text-sm text-ink-600">
          {Object.entries(tool.input).map(([k, v]) => (
            <div key={k} className="truncate">
              <span className="text-ink-400">{k}:</span> {typeof v === 'string' ? v : JSON.stringify(v)}
            </div>
          ))}
        </div>
      )}
      {output != null && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-ink-100 bg-white p-2 text-sm text-ink-700">
          {typeof output === 'string' ? output.slice(0, 1200) : JSON.stringify(output, null, 2).slice(0, 1200)}
        </pre>
      )}
      {tool.citations && tool.citations.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tool.citations.slice(0, 6).map((c, i) => (
            <a key={i} href={c.url} target="_blank" rel="noreferrer" className="chip bg-white py-0 text-sm text-brand-700 hover:underline">
              {hostOf(c.url)}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/** assistant-ui ToolCallMessagePart renderer — maps to ToolCardView. */
export function HdToolCallRenderer({
  toolName,
  args,
  result,
  status,
  isError,
}: {
  toolName: string;
  args: Record<string, unknown>;
  result?: HdsToolResult;
  status?: { type: string };
  isError?: boolean;
}) {
  const done = result !== undefined || status?.type === 'complete' || status?.type === 'incomplete';
  return (
    <ToolCardView
      tool={{
        name: toolName,
        input: args,
        ui: result?.ui,
        citations: result?.citations,
        error: isError ? result?.error || 'Tool failed' : result?.error,
        done,
      }}
    />
  );
}
