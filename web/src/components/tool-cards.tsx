'use client';

import { useState } from 'react';
import { hostOf, faviconFor, proxiedImg } from './markdown';

/* ─────────────────────────────────────────────
   DISPLAY CARDS
   ───────────────────────────────────────────── */

/** 1. CitationCard — vertical list of cited sources with favicons */
export function CitationCard({ data }: { data: any }) {
  const sources: any[] = data?.sources || [];
  if (!sources.length) return <p className="text-sm text-ink-400">No sources.</p>;
  return (
    <ol className="space-y-1.5">
      {sources.map((s, i) => {
        const fav = faviconFor(s.url);
        return (
          <li key={i} className="rounded-lg border border-ink-100 bg-white p-2.5 text-sm">
            <a href={s.url} target="_blank" rel="noreferrer" className="group flex items-start gap-2">
              <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white">{i + 1}</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {fav && <img src={fav} alt="" className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded" referrerPolicy="no-referrer" loading="lazy" />}
              <span className="min-w-0">
                <span className="line-clamp-1 font-medium text-brand-700 group-hover:underline">{s.title}</span>
                {s.snippet && <span className="mt-0.5 block line-clamp-2 text-sm leading-snug text-ink-500">{s.snippet}</span>}
                <span className="mt-0.5 block text-sm text-ink-400">{hostOf(s.url)}{s.date ? ` · ${s.date}` : ''}</span>
              </span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}

/** 2. ItemCarouselCard — horizontal scrollable row of item cards */
export function ItemCarouselCard({ data }: { data: any }) {
  const items: any[] = data?.items || [];
  if (!items.length) return <p className="text-sm text-ink-400">No items.</p>;
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {items.map((it, i) => {
        const inner = (
          <div className="w-44 shrink-0 rounded-lg border border-ink-100 bg-white p-2.5 text-sm hover:border-brand-300 hover:shadow-sm transition">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {it.image && <img src={proxiedImg(it.image)} alt={it.title || ''} className="mb-1.5 h-24 w-full rounded object-cover" referrerPolicy="no-referrer" loading="lazy" />}
            <div className="line-clamp-1 font-medium text-ink-900">{it.title}</div>
            {it.description && <div className="mt-0.5 line-clamp-2 text-sm text-ink-500">{it.description}</div>}
          </div>
        );
        return it.url ? (
          <a key={i} href={it.url} target="_blank" rel="noreferrer">{inner}</a>
        ) : (
          <div key={i}>{inner}</div>
        );
      })}
    </div>
  );
}

/** 3. LinkPreviewCard — rich OG-style link preview (single or list) */
export function LinkPreviewCard({ data }: { data: any }) {
  const items: any[] = Array.isArray(data?.items) && data.items.length ? data.items : data?.url ? [data] : [];
  if (!items.length) return null;
  if (items.length === 1) return <SingleLinkPreview data={items[0]} />;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {items.map((item, i) => (
        <SingleLinkPreview key={i} data={item} />
      ))}
    </div>
  );
}

function SingleLinkPreview({ data }: { data: any }) {
  if (!data?.url) return null;
  const fav = data.favicon || faviconFor(data.url);
  return (
    <a href={data.url} target="_blank" rel="noreferrer" className="group flex gap-3 rounded-lg border border-ink-100 bg-white p-2.5 hover:border-brand-300 hover:shadow-sm transition">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {data.image && <img src={proxiedImg(data.image)} alt="" className="h-20 w-28 shrink-0 rounded object-cover" referrerPolicy="no-referrer" loading="lazy" />}
      <div className="min-w-0 text-sm">
        <div className="flex items-center gap-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {fav && <img src={fav} alt="" className="h-3.5 w-3.5 rounded" referrerPolicy="no-referrer" loading="lazy" />}
          <span className="truncate text-sm text-ink-400">{hostOf(data.url)}</span>
        </div>
        <div className="mt-1 line-clamp-1 font-medium text-brand-700 group-hover:underline">{data.title || data.url}</div>
        {data.description && <div className="mt-0.5 line-clamp-2 text-sm leading-snug text-ink-500">{data.description}</div>}
      </div>
    </a>
  );
}

/** 4. StatsCard — grid of metric cards */
export function StatsCard({ data }: { data: any }) {
  const stats: any[] = data?.stats || [];
  if (!stats.length) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {stats.map((s, i) => (
        <div key={i} className="rounded-lg border border-ink-100 bg-white p-2.5 text-sm">
          <div className="text-sm text-ink-400">{s.label}</div>
          <div className="mt-0.5 text-lg font-semibold text-ink-900">
            {s.value}{s.unit ? <span className="ml-0.5 text-sm font-normal text-ink-500">{s.unit}</span> : null}
          </div>
          {s.change != null && (
            <div className={`mt-0.5 text-sm font-medium ${Number(s.change) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {Number(s.change) >= 0 ? '+' : ''}{s.change}%
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** 5. TerminalCard — dark terminal-style output */
export function TerminalCard({ data }: { data: any }) {
  return (
    <div className="rounded-lg border border-ink-200 bg-ink-900 p-3 text-sm">
      {data?.command && (
        <div className="mb-1 font-mono text-sm text-ink-400">
          <span className="text-emerald-400">$</span> {data.command}
        </div>
      )}
      <pre className="max-h-60 overflow-auto whitespace-pre-wrap font-mono text-sm leading-relaxed text-ink-50">
        {data?.output ?? ''}
      </pre>
      {data?.exitCode != null && (
        <div className={`mt-1.5 text-sm ${data.exitCode === 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          exit {data.exitCode}
        </div>
      )}
    </div>
  );
}

/** 6. WeatherCard — current weather + optional forecast */
export function WeatherCard({ data }: { data: any }) {
  if (!data?.location) return null;
  const unit = data.unit || 'F';
  const forecast: any[] = data.forecast || [];
  return (
    <div className="rounded-lg border border-ink-100 bg-white p-3 text-sm">
      <div className="flex items-center gap-3">
        <div>
          <div className="text-2xl font-semibold text-ink-900">{data.temp}&deg;{unit}</div>
          <div className="text-sm text-ink-500">{data.condition}</div>
        </div>
        <div className="ml-auto text-right text-sm text-ink-400">
          <div className="font-medium text-ink-700">{data.location}</div>
          {data.humidity != null && <div>Humidity {data.humidity}%</div>}
          {data.wind && <div>Wind {data.wind}</div>}
        </div>
      </div>
      {forecast.length > 0 && (
        <div className="mt-2 flex gap-2 overflow-x-auto border-t border-ink-100 pt-2">
          {forecast.map((f: any, i: number) => (
            <div key={i} className="shrink-0 text-center text-sm">
              <div className="font-medium text-ink-700">{f.day}</div>
              <div className="text-ink-500">{f.condition}</div>
              <div className="text-ink-400">{f.high}&deg; / {f.low}&deg;</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   ARTIFACT CARDS
   ───────────────────────────────────────────── */

/** 7. ChartCard — pure SVG chart (bar / line / pie / area) */
export function ChartCard({ data }: { data: any }) {
  const { chartType = 'bar', title, labels = [], datasets = [] } = data || {};
  const COLORS = ['#0d9488', '#6366f1', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  if (chartType === 'pie') {
    const vals: number[] = datasets[0]?.data || [];
    const total = vals.reduce((a: number, b: number) => a + b, 0) || 1;
    let cum = 0;
    const slices = vals.map((v: number, i: number) => {
      const start = cum / total;
      cum += v;
      const end = cum / total;
      const x1 = Math.cos(2 * Math.PI * start - Math.PI / 2);
      const y1 = Math.sin(2 * Math.PI * start - Math.PI / 2);
      const x2 = Math.cos(2 * Math.PI * end - Math.PI / 2);
      const y2 = Math.sin(2 * Math.PI * end - Math.PI / 2);
      const large = end - start > 0.5 ? 1 : 0;
      return { d: `M0,0 L${x1},${y1} A1,1 0 ${large},1 ${x2},${y2} Z`, color: datasets[0]?.color || COLORS[i % COLORS.length], label: labels[i] };
    });
    return (
      <div className="rounded-lg border border-ink-100 bg-white p-3 text-sm">
        {title && <div className="mb-2 font-medium text-ink-700">{title}</div>}
        <div className="flex items-center gap-4">
          <svg viewBox="-1.1 -1.1 2.2 2.2" className="h-32 w-32">
            {slices.map((s, i) => <path key={i} d={s.d} fill={s.color} stroke="white" strokeWidth="0.03" />)}
          </svg>
          <div className="space-y-1">
            {slices.map((s, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
                <span className="text-sm text-ink-600">{s.label ?? `Item ${i + 1}`}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // bar / line / area
  const allVals = datasets.flatMap((ds: any) => ds.data || []);
  const maxVal = Math.max(...allVals, 1);
  const W = 300, H = 160, PAD = 30, RIGHT = 10, TOP = 10;
  const plotW = W - PAD - RIGHT;
  const plotH = H - 20 - TOP;
  const n = labels.length || 1;

  return (
    <div className="rounded-lg border border-ink-100 bg-white p-3 text-sm">
      {title && <div className="mb-2 font-medium text-ink-700">{title}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 220 }}>
        {/* y-axis ticks */}
        {[0, 0.5, 1].map((f) => {
          const y = TOP + plotH - f * plotH;
          return (
            <g key={f}>
              <line x1={PAD} y1={y} x2={W - RIGHT} y2={y} stroke="#e5e7eb" strokeWidth="0.5" />
              <text x={PAD - 3} y={y + 3} textAnchor="end" className="fill-ink-400" fontSize="7">{Math.round(maxVal * f)}</text>
            </g>
          );
        })}
        {/* x-axis labels */}
        {labels.map((l: string, i: number) => {
          const x = PAD + (i + 0.5) * (plotW / n);
          return <text key={i} x={x} y={H - 3} textAnchor="middle" className="fill-ink-400" fontSize="7">{l.length > 8 ? l.slice(0, 7) + '…' : l}</text>;
        })}
        {/* datasets */}
        {datasets.map((ds: any, di: number) => {
          const color = ds.color || COLORS[di % COLORS.length];
          const vals: number[] = ds.data || [];
          if (chartType === 'bar') {
            const barW = plotW / n / (datasets.length + 1);
            return vals.map((v: number, i: number) => {
              const bh = (v / maxVal) * plotH;
              const x = PAD + i * (plotW / n) + (di + 0.5) * barW;
              return <rect key={`${di}-${i}`} x={x} y={TOP + plotH - bh} width={barW * 0.8} height={bh} fill={color} rx="1" />;
            });
          }
          const pts = vals.map((v: number, i: number) => {
            const x = PAD + (i + 0.5) * (plotW / n);
            const y = TOP + plotH - (v / maxVal) * plotH;
            return `${x},${y}`;
          });
          if (chartType === 'area') {
            const first = PAD + 0.5 * (plotW / n);
            const last = PAD + (vals.length - 0.5) * (plotW / n);
            return (
              <g key={di}>
                <polygon points={`${first},${TOP + plotH} ${pts.join(' ')} ${last},${TOP + plotH}`} fill={color} opacity="0.15" />
                <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" />
              </g>
            );
          }
          // line
          return <polyline key={di} points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" />;
        })}
      </svg>
      {datasets.length > 1 && (
        <div className="mt-1.5 flex flex-wrap gap-3">
          {datasets.map((ds: any, di: number) => (
            <div key={di} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ds.color || COLORS[di % COLORS.length] }} />
              <span className="text-sm text-ink-500">{ds.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 8. CodeBlockCard — syntax-highlighted code with regex tokens */
export function CodeBlockCard({ data }: { data: any }) {
  const code = data?.code ?? '';
  const lang = data?.language ?? '';
  const filename = data?.filename;

  function highlight(src: string): string {
    return src
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/(\/\/.*|#.*)/gm, '<span class="text-ink-400">$1</span>')
      .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="text-ink-400">$1</span>')
      .replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g, '<span class="text-emerald-600">$1</span>')
      .replace(/\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|try|catch|throw|new|this|def|self|int|str|bool|true|false|null|None|True|False|undefined)\b/g, '<span class="text-brand-600 font-medium">$1</span>')
      .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="text-amber-600">$1</span>');
  }

  return (
    <div className="overflow-hidden rounded-lg border border-ink-200 bg-ink-50 text-sm">
      {(filename || lang) && (
        <div className="border-b border-ink-100 px-3 py-1.5 text-sm text-ink-500">
          {filename || lang}
        </div>
      )}
      <pre className="max-h-72 overflow-auto p-3 font-mono text-sm leading-relaxed text-ink-700" dangerouslySetInnerHTML={{ __html: highlight(code) }} />
    </div>
  );
}

/** 9. CodeDiffCard — unified diff view */
export function CodeDiffCard({ data }: { data: any }) {
  const hunks: any[] = data?.hunks || [];
  return (
    <div className="overflow-hidden rounded-lg border border-ink-200 bg-white text-sm">
      {data?.filename && <div className="border-b border-ink-100 px-3 py-1.5 font-mono text-sm text-ink-500">{data.filename}</div>}
      <div className="max-h-72 overflow-auto">
        {hunks.map((h: any, hi: number) => (
          <div key={hi}>
            <div className="bg-ink-50 px-3 py-0.5 font-mono text-sm text-ink-400">@@ -{h.oldStart} +{h.newStart} @@</div>
            {(h.lines || []).map((l: any, li: number) => {
              const bg = l.type === 'add' ? 'bg-emerald-50' : l.type === 'remove' ? 'bg-red-50' : '';
              const color = l.type === 'add' ? 'text-emerald-700' : l.type === 'remove' ? 'text-red-700' : 'text-ink-600';
              const prefix = l.type === 'add' ? '+' : l.type === 'remove' ? '-' : ' ';
              return (
                <div key={li} className={`px-3 font-mono text-sm leading-5 ${bg} ${color}`}>
                  <span className="mr-2 inline-block w-3 text-right text-ink-300">{prefix}</span>{l.content}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Normalize hd_render data_table payloads — models often send rows as objects, not cell arrays. */
function normalizeTableData(data: any): { columns: string[]; rows: unknown[][]; caption?: string } {
  const caption = data?.caption || data?.title;
  let columns = Array.isArray(data?.columns) ? data.columns.map(String) : [];
  let rawRows = data?.rows;

  if (!Array.isArray(rawRows)) {
    if (rawRows && typeof rawRows === 'object') rawRows = Object.values(rawRows);
    else rawRows = [];
  }

  const rows: unknown[][] = [];
  for (const row of rawRows) {
    if (Array.isArray(row)) {
      rows.push(row);
    } else if (row && typeof row === 'object') {
      const rec = row as Record<string, unknown>;
      if (columns.length === 0) columns = Object.keys(rec);
      rows.push(columns.map((col: string) => rec[col]));
    } else if (row != null) {
      rows.push([row]);
    }
  }

  if (columns.length === 0 && rows.length > 0) {
    const width = Math.max(...rows.map((r) => r.length), 1);
    columns = Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  }

  return { columns, rows, caption };
}

/** 10. DataTableCard — sortable table with zebra striping */
export function DataTableCard({ data }: { data: any }) {
  const { columns, rows: sourceRows, caption } = normalizeTableData(data);
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  const rows = [...sourceRows];
  if (sortCol != null) {
    rows.sort((a, b) => {
      const av = a[sortCol], bv = b[sortCol];
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''));
      return sortAsc ? cmp : -cmp;
    });
  }

  function toggleSort(ci: number) {
    if (sortCol === ci) setSortAsc(!sortAsc);
    else { setSortCol(ci); setSortAsc(true); }
  }

  if (!columns.length && !rows.length) {
    return <p className="text-sm text-ink-400">No table data.</p>;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-ink-200 bg-white text-sm">
      {caption && <div className="border-b border-ink-100 px-3 py-1.5 font-medium text-ink-700">{caption}</div>}
      <div className="max-h-72 overflow-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink-100 bg-ink-50">
              {columns.map((c, ci) => (
                <th key={ci} className="cursor-pointer px-3 py-1.5 font-medium text-ink-600 hover:text-ink-900 select-none" onClick={() => toggleSort(ci)}>
                  {c}{sortCol === ci ? (sortAsc ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className={ri % 2 ? 'bg-ink-50/50' : ''}>
                {columns.map((_, ci) => (
                  <td key={ci} className="px-3 py-1 text-ink-700">
                    {row[ci] != null ? String(row[ci]) : ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 11. SocialPostCard — social media post preview (X, LinkedIn, Instagram) */
export function SocialPostCard({ data }: { data: any }) {
  const platformColors: Record<string, string> = { x: 'bg-black', linkedin: 'bg-[#0A66C2]', instagram: 'bg-gradient-to-br from-[#833AB4] via-[#FD1D1D] to-[#F77737]' };
  const platformLabels: Record<string, string> = { x: 'X', linkedin: 'LinkedIn', instagram: 'Instagram' };
  const platform = data?.platform || 'x';

  return (
    <div className="rounded-lg border border-ink-100 bg-white p-3 text-sm">
      <div className="flex items-center gap-2">
        {data?.avatar ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={proxiedImg(data.avatar)} alt="" className="h-8 w-8 rounded-full" referrerPolicy="no-referrer" loading="lazy" />
        ) : (
          <div className={`h-8 w-8 rounded-full ${platformColors[platform] || 'bg-ink-200'}`} />
        )}
        <div className="min-w-0">
          <div className="truncate font-medium text-ink-900">{data?.author || 'Unknown'}</div>
          <div className="truncate text-sm text-ink-400">{data?.handle ? `@${data.handle}` : ''}{data?.timestamp ? ` · ${data.timestamp}` : ''}</div>
        </div>
        <span className={`chip ml-auto py-0 text-sm text-white ${platformColors[platform] || 'bg-ink-400'}`}>{platformLabels[platform] || platform}</span>
      </div>
      <div className="mt-2 whitespace-pre-wrap text-ink-800">{data?.content}</div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {data?.image && <img src={proxiedImg(data.image)} alt="" className="mt-2 rounded-lg w-full max-h-48 object-cover" referrerPolicy="no-referrer" loading="lazy" />}
      <div className="mt-2 flex gap-4 text-sm text-ink-400">
        {data?.likes != null && <span>{data.likes} likes</span>}
        {data?.comments != null && <span>{data.comments} comments</span>}
        {data?.shares != null && <span>{data.shares} shares</span>}
      </div>
    </div>
  );
}

/** 12. MessageDraftCard — email/message draft preview */
export function MessageDraftCard({ data }: { data: any }) {
  const isEmail = (data?.type || 'email') === 'email';
  return (
    <div className="rounded-lg border border-ink-100 bg-white p-3 text-sm">
      <div className="flex items-center gap-2 text-sm text-ink-400">
        <span>{isEmail ? 'Draft email' : 'Draft message'}</span>
      </div>
      {data?.to && <div className="mt-1 text-sm text-ink-500"><span className="text-ink-400">To:</span> {data.to}</div>}
      {data?.subject && <div className="mt-0.5 font-medium text-ink-900">{data.subject}</div>}
      <div className="mt-2 whitespace-pre-wrap text-ink-700 leading-relaxed">{data?.body}</div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   CONFIRMATION CARDS
   ───────────────────────────────────────────── */

/** 13. ApprovalCard — action approval with status badge */
export function ApprovalCard({ data }: { data: any }) {
  const statusStyle: Record<string, string> = {
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    rejected: 'bg-red-50 text-red-700 border-red-200',
  };
  const status = data?.status || 'pending';
  return (
    <div className="rounded-lg border border-ink-100 bg-white p-3 text-sm">
      <div className="flex items-center gap-2">
        <div className="font-medium text-ink-900">{data?.title || 'Approval Required'}</div>
        <span className={`chip ml-auto border py-0 text-sm ${statusStyle[status] || statusStyle.pending}`}>{status}</span>
      </div>
      {data?.description && <div className="mt-1 text-sm text-ink-500">{data.description}</div>}
      {data?.items?.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-ink-100 pt-2">
          {data.items.map((it: any, i: number) => (
            <div key={i} className="flex justify-between text-sm">
              <span className="text-ink-500">{it.label}</span>
              <span className="font-medium text-ink-700">{it.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 14. OrderSummaryCard — order/purchase summary */
export function OrderSummaryCard({ data }: { data: any }) {
  const items: any[] = data?.items || [];
  const currency = data?.currency || '$';
  return (
    <div className="rounded-lg border border-ink-100 bg-white p-3 text-sm">
      <div className="space-y-1">
        {items.map((it: any, i: number) => (
          <div key={i} className="flex justify-between text-sm">
            <span className="text-ink-700">{it.name}{it.qty ? ` x${it.qty}` : ''}</span>
            <span className="font-medium text-ink-900">{currency}{it.price}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between border-t border-ink-100 pt-2 font-medium text-ink-900">
        <span>Total</span>
        <span>{currency}{data?.total}</span>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   MEDIA CARDS
   ───────────────────────────────────────────── */

/** 15. AudioCard — HTML5 audio player */
export function AudioCard({ data }: { data: any }) {
  return (
    <div className="rounded-lg border border-ink-100 bg-white p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-base">&#9835;</span>
        <div className="min-w-0">
          {data?.title && <div className="truncate font-medium text-ink-900">{data.title}</div>}
          <div className="text-sm text-ink-400">
            {data?.artist || ''}{data?.duration ? ` · ${data.duration}` : ''}
          </div>
        </div>
      </div>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      {data?.url && <audio src={data.url} controls className="mt-2 w-full h-8" />}
    </div>
  );
}

/** 16. ImageCard — single image with optional caption */
export function ImageCard({ data }: { data: any }) {
  if (!data?.url) return null;
  return (
    <div className="rounded-lg border border-ink-100 bg-white overflow-hidden text-sm">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={proxiedImg(data.url)} alt={data.alt || ''} className="w-full max-h-80 object-contain bg-ink-50" referrerPolicy="no-referrer" loading="lazy" />
      {data.caption && <div className="px-3 py-1.5 text-sm text-ink-500">{data.caption}</div>}
    </div>
  );
}

/** 17. ImageGalleryCard — responsive image grid */
export function ImageGalleryCard({ data }: { data: any }) {
  const images: any[] = data?.images || [];
  if (!images.length) return null;
  const cols = images.length === 1 ? 'grid-cols-1' : images.length === 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3';
  return (
    <div className={`grid gap-2 ${cols}`}>
      {images.map((img: any, i: number) => (
        <div key={i} className="overflow-hidden rounded-lg border border-ink-100 bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={proxiedImg(img.url)} alt={img.alt || ''} className="w-full h-36 object-cover bg-ink-50" referrerPolicy="no-referrer" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          {img.caption && <div className="px-2 py-1 text-sm text-ink-500">{img.caption}</div>}
        </div>
      ))}
    </div>
  );
}

/** 18. VideoCard — video embed or HTML5 video player */
export function VideoCard({ data }: { data: any }) {
  if (!data?.url) return null;
  const ytMatch = data.url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  return (
    <div className="overflow-hidden rounded-lg border border-ink-100 bg-white text-sm">
      {data?.title && <div className="px-3 py-1.5 font-medium text-ink-700 border-b border-ink-100">{data.title}</div>}
      {ytMatch ? (
        <iframe
          src={`https://www.youtube.com/embed/${ytMatch[1]}`}
          title={data.title || 'Video'}
          className="aspect-video w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      ) : (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video src={data.url} controls poster={proxiedImg(data.thumbnail) || undefined} className="aspect-video w-full bg-black" />
      )}
      {data?.duration && <div className="px-3 py-1 text-sm text-ink-400">{data.duration}</div>}
    </div>
  );
}

/* ─────────────────────────────────────────────
   PROGRESS CARDS
   ───────────────────────────────────────────── */

/** 19. PlanCard — step-by-step plan with status indicators */
export function PlanCard({ data }: { data: any }) {
  const steps: any[] = data?.steps || [];
  return (
    <div className="rounded-lg border border-ink-100 bg-white p-3 text-sm">
      {data?.title && <div className="mb-2 font-medium text-ink-900">{data.title}</div>}
      <div className="space-y-0">
        {steps.map((s: any, i: number) => {
          const dot = s.status === 'done' ? 'bg-emerald-500' : s.status === 'active' ? 'bg-brand-500 animate-pulse' : 'bg-ink-200';
          const textColor = s.status === 'done' ? 'text-ink-500 line-through' : s.status === 'active' ? 'text-ink-900 font-medium' : 'text-ink-500';
          return (
            <div key={i} className="flex items-start gap-2 py-1">
              <div className="flex flex-col items-center">
                <span className={`mt-0.5 h-2.5 w-2.5 rounded-full ${dot}`} />
                {i < steps.length - 1 && <span className="w-px flex-1 bg-ink-100 min-h-[12px]" />}
              </div>
              <div className="min-w-0">
                <span className={`text-sm ${textColor}`}>{s.label}</span>
                {s.detail && <div className="text-sm text-ink-400">{s.detail}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 20. ProgressCard — progress tracker with bar */
export function ProgressCard({ data }: { data: any }) {
  const steps: any[] = data?.steps || [];
  const done = steps.filter((s: any) => s.status === 'done').length;
  const pct = data?.percent != null ? data.percent : (steps.length ? Math.round((done / steps.length) * 100) : 0);

  return (
    <div className="rounded-lg border border-ink-100 bg-white p-3 text-sm">
      {data?.title && <div className="mb-1 font-medium text-ink-900">{data.title}</div>}
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 rounded-full bg-ink-100">
          <div className="h-1.5 rounded-full bg-brand-500 transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <span className="text-sm font-medium text-ink-600">{pct}%</span>
      </div>
      {steps.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {steps.map((s: any, i: number) => (
            <div key={i} className="flex items-center gap-1.5 text-sm">
              <span className={s.status === 'done' ? 'text-emerald-500' : s.status === 'active' ? 'text-brand-500' : 'text-ink-300'}>
                {s.status === 'done' ? '✓' : s.status === 'active' ? '●' : '○'}
              </span>
              <span className={s.status === 'done' ? 'text-ink-400 line-through' : s.status === 'active' ? 'text-ink-800 font-medium' : 'text-ink-500'}>
                {s.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   INPUT (READ-ONLY DISPLAY) CARDS
   ───────────────────────────────────────────── */

/** 21. OptionListCard — list of options with radio indicators */
export function OptionListCard({ data }: { data: any }) {
  const options: any[] = data?.options || [];
  return (
    <div className="rounded-lg border border-ink-100 bg-white p-3 text-sm">
      {data?.question && <div className="mb-2 font-medium text-ink-900">{data.question}</div>}
      <div className="space-y-1.5">
        {options.map((o: any, i: number) => {
          const selected = data?.selected != null && (data.selected === i || data.selected === o.label);
          return (
            <div key={i} className={`flex items-start gap-2 rounded-lg border p-2 ${selected ? 'border-brand-300 bg-brand-50' : 'border-ink-100'}`}>
              <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 ${selected ? 'border-brand-500' : 'border-ink-300'}`}>
                {selected && <span className="h-2 w-2 rounded-full bg-brand-500" />}
              </span>
              <div className="min-w-0">
                <div className="font-medium text-ink-800">{o.label}</div>
                {o.description && <div className="mt-0.5 text-sm text-ink-500">{o.description}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 22. QuestionFlowCard — Q&A flow display */
export function QuestionFlowCard({ data }: { data: any }) {
  const questions: any[] = data?.questions || [];
  return (
    <div className="rounded-lg border border-ink-100 bg-white p-3 text-sm space-y-2">
      {questions.map((qa: any, i: number) => (
        <div key={i}>
          <div className="font-medium text-ink-800">{qa.q}</div>
          {qa.a != null && <div className="mt-0.5 rounded bg-brand-50 px-2 py-1 text-sm text-ink-700">{qa.a}</div>}
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────
   CARD REGISTRY
   ───────────────────────────────────────────── */

export const CARD_REGISTRY: Record<string, React.FC<{ data: any; input?: any }>> = {
  citation: CitationCard,
  item_carousel: ItemCarouselCard,
  link_preview: LinkPreviewCard,
  stats: StatsCard,
  terminal: TerminalCard,
  weather: WeatherCard,
  chart: ChartCard,
  code_block: CodeBlockCard,
  code_diff: CodeDiffCard,
  data_table: DataTableCard,
  social_post: SocialPostCard,
  message_draft: MessageDraftCard,
  approval: ApprovalCard,
  order_summary: OrderSummaryCard,
  audio: AudioCard,
  image: ImageCard,
  image_gallery: ImageGalleryCard,
  video: VideoCard,
  plan: PlanCard,
  progress: ProgressCard,
  option_list: OptionListCard,
  question_flow: QuestionFlowCard,
};
