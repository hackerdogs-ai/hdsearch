// The end-to-end processing of ONE file: fetch raw bytes from S3 → sniff →
// extract (total/never-throws) → chunk → embed + index into the RAG vector store →
// mark ready. Every failure mode is handled so the worker can always reach a
// terminal state (docs/file-upload-rag.md §C.3/§C.10). Idempotent: re-running
// overwrites vector docs by deterministic id and re-updates the row.
import { env } from '../env.js';
import { log, errFields } from '../logger.js';
import { getFileBuffer } from '../storage.js';
import { indexDocuments, type VecDoc } from '../vector.js';
import { embeddingsEnabled } from '../embeddings.js';
import { getFile, setReady, type FileRecord } from './db.js';
import { runExtraction } from './processors/index.js';
import type { ProcessorInput } from './processors/types.js';
import { chunkBlocks } from './chunk.js';
import type { JobPayload } from './queue.js';
import { scanFile } from './av.js';

/** Returns 'ready' | 'failed'. Never throws — the worker relies on that. */
export async function processFile(job: JobPayload): Promise<'ready' | 'failed'> {
  const rec = await getFile(job.fileId);
  if (!rec) {
    // Row vanished (deleted mid-flight) — nothing to do; treat as done.
    log.info('file row missing at process time (deleted?)', { fileId: job.fileId });
    return 'ready';
  }

  const buffer = await getFileBuffer(rec.s3Key);
  if (!buffer) {
    // Transient S3 issue → signal failure so the queue retries (bounded).
    throw new Error('raw object unreadable from storage');
  }

  // Optional antivirus gate before we index anything.
  if (env.file.avUrl) {
    const verdict = await scanFile(buffer, rec.name);
    if (verdict === 'infected') {
      await setReadyQuarantine(rec);
      log.warn('file quarantined by AV scan', { fileId: rec.id });
      return 'failed';
    }
  }

  const input: ProcessorInput = {
    buffer,
    name: rec.name,
    ext: (rec.ext || extOf(rec.name)).toLowerCase(),
    mime: rec.mime || 'application/octet-stream',
    magic: buffer.subarray(0, 64),
    caps: {
      ocr: env.file.ocr,
      vision: env.file.vision,
      maxPages: env.file.maxPages,
      maxChars: env.file.maxChars,
    },
  };

  const { result, processorId } = await runExtraction(input, env.file.processTimeoutMs);
  const chunks = chunkBlocks(result.blocks);

  let chunksIndexed = 0;
  if (chunks.length && embeddingsEnabled()) {
    const docs: VecDoc[] = chunks.map((c) => ({
      id: `${rec.id}:${c.index}`, // deterministic → idempotent re-index
      text: c.text,
      title: rec.name,
      url: rec.id,
      metadata: {
        fileId: rec.id,
        threadId: rec.threadId,
        userId: rec.userId,
        chunk: c.index,
        mime: rec.mime,
        ...(c.loc || {}),
      },
    }));
    try {
      const ids = await indexDocuments(docs, rec.namespace, env.file.vectorTtlSec);
      chunksIndexed = ids.length;
    } catch (e) {
      // Embedder/vector outage — still mark ready (degraded); RAG just returns no hits.
      log.warn('file indexing failed (marking ready-degraded)', { fileId: rec.id, ...errFields(e) });
    }
  }

  await setReady(rec.id, {
    processor: processorId,
    degraded: !!result.degraded || (chunks.length > 0 && chunksIndexed === 0),
    pages: result.pages ?? null,
    chunksTotal: chunks.length,
    chunksIndexed,
    preview: (result.preview || '').slice(0, 500) || null,
  });

  log.info('file processed', {
    fileId: rec.id,
    processor: processorId,
    chunks: chunks.length,
    indexed: chunksIndexed,
    degraded: !!result.degraded,
  });
  return 'ready';
}

async function setReadyQuarantine(rec: FileRecord): Promise<void> {
  const { setFailed } = await import('./db.js');
  await setFailed(rec.id, 'quarantined: failed antivirus scan');
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1) : '';
}
