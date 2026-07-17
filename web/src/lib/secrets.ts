// Reads the SAME shared secrets file the API auto-generates (see api/src/secrets.ts),
// so the web BFF's internal secret matches the API's automatically when both are run
// locally without the start scripts. Env vars always win. The web also reads/creates
// its own session secret here so sessions survive restarts.
import 'server-only';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

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

// same default path as the API: <service-root>/.hdsearch-secrets.json
const SECRETS_FILE =
  process.env.HDSEARCH_SECRETS_FILE || resolve(pkgRoot(), '..', '.hdsearch-secrets.json');

type Store = Record<string, string>;
let cache: Store | null = null;

function load(): Store {
  if (cache) return cache;
  try {
    cache = existsSync(SECRETS_FILE) ? (JSON.parse(readFileSync(SECRETS_FILE, 'utf8')) as Store) : {};
  } catch {
    cache = {};
  }
  return cache;
}
function persist(store: Store): void {
  try {
    mkdirSync(dirname(SECRETS_FILE), { recursive: true });
    writeFileSync(SECRETS_FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
  } catch {
    /* ignore */
  }
}

/** Read a shared secret by key (no generation) — used for `internalSecret`, which
 *  the API owns/creates. Returns '' if not present yet. */
export function readSharedSecret(key: string): string {
  return load()[key] || '';
}

/** Read-or-create (for the web-only session secret). */
export function getOrCreateSecret(key: string): string {
  const store = load();
  if (store[key]) return store[key]!;
  const v = randomBytes(32).toString('hex');
  store[key] = v;
  persist(store);
  return v;
}
