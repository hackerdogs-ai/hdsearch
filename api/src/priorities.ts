// Priority list loader. The order in which providers are tried is data-driven:
// a CSV whose FIRST column is the priority number (spec §7). Lower number = tried
// first. Free / self-hosted providers ship with higher priority than commercial.
// The CSV is hot-reloaded so ops can re-rank providers without a redeploy.
//
// CSV columns: priority,provider_id,enabled
//   10,openserp,true
//   20,searxng,true
//   900,serpapi,true
import { readFileSync, existsSync, statSync } from 'node:fs';
import { env } from './env.js';
import { log } from './logger.js';

interface PriorityRow {
  priority: number;
  enabled: boolean;
}

let table: Map<string, PriorityRow> = new Map();
let loadedMtime = 0;
let lastCheck = 0;

function parseCsv(text: string): Map<string, PriorityRow> {
  const out = new Map<string, PriorityRow>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cols = line.split(',').map((s) => s.trim());
    // tolerate a header row
    if (!/^\d+$/.test(cols[0] ?? '')) continue;
    const priority = parseInt(cols[0]!, 10);
    const id = (cols[1] || '').toLowerCase();
    if (!id) continue;
    const enabled = cols[2] === undefined ? true : /^(1|true|yes|on)$/i.test(cols[2]);
    out.set(id, { priority, enabled });
  }
  return out;
}

function reloadIfNeeded(): void {
  const now = Date.now();
  if (now - lastCheck < env.priorityReloadSec * 1000 && table.size) return;
  lastCheck = now;
  try {
    if (!existsSync(env.priorityCsvPath)) return;
    const mtime = statSync(env.priorityCsvPath).mtimeMs;
    if (mtime === loadedMtime && table.size) return;
    table = parseCsv(readFileSync(env.priorityCsvPath, 'utf8'));
    loadedMtime = mtime;
    log.info('priority list loaded', { path: env.priorityCsvPath, count: table.size });
  } catch (e) {
    log.warn('priority list load failed; using defaults', { path: env.priorityCsvPath });
  }
}

/** Effective priority for a provider: CSV override or its hardcoded default. */
export function priorityOf(providerId: string, defaultPriority: number): number {
  reloadIfNeeded();
  return table.get(providerId.toLowerCase())?.priority ?? defaultPriority;
}

/** Is the provider enabled? Defaults to true when absent from the CSV. */
export function isEnabled(providerId: string): boolean {
  reloadIfNeeded();
  const row = table.get(providerId.toLowerCase());
  return row ? row.enabled : true;
}
