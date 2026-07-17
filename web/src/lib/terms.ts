import 'server-only';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function pkgRoot(): string {
  let dir = HERE;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(HERE, '..');
}

let cached: string | null = null;

/** Canonical Terms of Service — source of truth: web/content/hdsearch-tos.md */
export function getTermsMarkdown(): string {
  if (cached) return cached;
  const path = join(pkgRoot(), 'content', 'hdsearch-tos.md');
  if (!existsSync(path)) {
    throw new Error('HDSearch Terms of Service not found at content/hdsearch-tos.md');
  }
  cached = readFileSync(path, 'utf8');
  return cached;
}
