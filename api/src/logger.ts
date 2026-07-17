// Minimal structured JSON logger. One line per event, machine-parseable, with a
// request-id correlator. No deps. Levels gated by HDSEARCH_LOG_LEVEL.
//
// All output goes to stdout. Optional rotating file output via:
//   HDSEARCH_LOG_FILE=/var/log/hd-search.log   (empty = no file)
//   HDSEARCH_LOG_MAX_SIZE_MB=50                 (rotate at this size, default 50)
//   HDSEARCH_LOG_MAX_FILES=5                    (keep N rotated files, default 5)
import { appendFileSync, renameSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { env } from './env.js';

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = ORDER[(env.logLevel as Level)] ?? ORDER.info;

// ── rotating file config ────────────────────────────────────────────────────
const LOG_FILE = process.env.HDSEARCH_LOG_FILE || '';
const LOG_MAX_BYTES = (Number(process.env.HDSEARCH_LOG_MAX_SIZE_MB) || 50) * 1024 * 1024;
const LOG_MAX_FILES = Number(process.env.HDSEARCH_LOG_MAX_FILES) || 5;
let writesSinceCheck = 0;
const CHECK_INTERVAL = 64;

function rotateIfNeeded() {
  if (!LOG_FILE) return;
  try {
    const size = statSync(LOG_FILE).size;
    if (size < LOG_MAX_BYTES) return;
    for (let i = LOG_MAX_FILES; i >= 1; i--) {
      const from = i === 1 ? LOG_FILE : `${LOG_FILE}.${i - 1}`;
      const to = `${LOG_FILE}.${i}`;
      if (!existsSync(from)) continue;
      if (i === LOG_MAX_FILES && existsSync(to)) unlinkSync(to);
      renameSync(from, to);
    }
  } catch {
    // rotation failure must never break logging
  }
}

function writeToFile(line: string) {
  if (!LOG_FILE) return;
  try {
    appendFileSync(LOG_FILE, line + '\n');
    if (++writesSinceCheck >= CHECK_INTERVAL) {
      writesSinceCheck = 0;
      rotateIfNeeded();
    }
  } catch {
    // file write failure must never break logging
  }
}

// ── emit ────────────────────────────────────────────────────────────────────
function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (ORDER[level] < threshold) return;
  const rec: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    svc: 'hd-search',
    msg,
    ...fields,
  };
  let line: string;
  try {
    line = JSON.stringify(rec);
  } catch {
    line = JSON.stringify({ ts: rec.ts, level, svc: 'hd-search', msg, err: 'unserializable-fields' });
  }
  process.stdout.write(line + '\n');
  writeToFile(line);
}

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => emit('debug', msg, f),
  info: (msg: string, f?: Record<string, unknown>) => emit('info', msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => emit('warn', msg, f),
  error: (msg: string, f?: Record<string, unknown>) => emit('error', msg, f),
};

/** Normalize any thrown value into a loggable shape. */
export function errFields(e: unknown): Record<string, unknown> {
  if (e instanceof Error) return { error: e.message, stack: e.stack };
  return { error: String(e) };
}
