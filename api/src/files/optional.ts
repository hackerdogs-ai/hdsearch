// Typecheck-safe optional dependency loader. Heavy parser libs (pdfjs-dist,
// officeparser, xlsx, ag-psd, tesseract.js) are OPTIONAL: the zero-dep core
// processors (text/json/xml/generic) always work, and a format lights up only
// when its dep is installed. Passing the module name through a *variable* (not a
// string literal) makes TypeScript treat this as `import(any)` and skip module
// resolution, so `npm run typecheck` stays green whether or not the dep is present.
// A missing dep resolves to null → the caller degrades to the generic processor
// instead of crashing (docs/file-upload-rag.md §C.2).
import { log } from '../logger.js';

const cache = new Map<string, unknown | null>();

export async function optionalImport<T = any>(name: string): Promise<T | null> {
  if (cache.has(name)) return cache.get(name) as T | null;
  let mod: T | null = null;
  try {
    const spec: string = name; // force non-literal specifier
    mod = (await import(spec)) as T;
  } catch (e) {
    log.debug('optional dependency not available', { module: name, error: (e as Error).message });
    mod = null;
  }
  cache.set(name, mod);
  return mod;
}

/** Run `fn` under a wall-clock timeout; resolve to `fallback` if it overruns. Never rejects. */
export async function withTimeout<T>(fn: () => Promise<T>, ms: number, fallback: T, label = 'op'): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      log.warn('file processing step timed out', { label, ms });
      resolve(fallback);
    }, ms);
  });
  try {
    return await Promise.race([fn().catch((e) => {
      log.debug('file processing step failed', { label, error: (e as Error).message });
      return fallback;
    }), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
