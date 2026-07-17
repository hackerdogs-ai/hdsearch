// Processor registry + the total-pipeline entrypoint. pickProcessor() scores every
// registered processor against (mime, ext, magic) and returns the best; the generic
// fallback always matches (0.01) so a processor is ALWAYS found. runExtraction()
// wraps extract() in try/catch + a hard timeout as defense-in-depth, then clamps to
// the char budget — the single choke point that makes the pipeline crash-proof.
import type { FileProcessor, ProcessorInput, ExtractResult } from './types.js';
import { metadataBlock, clampChars } from './types.js';
import { withTimeout } from '../optional.js';
import { log, errFields } from '../../logger.js';
import { textProcessor } from './text.js';
import { jsonProcessor } from './json.js';
import { xmlProcessor } from './xml.js';
import { pdfProcessor } from './pdf.js';
import { officeProcessor } from './office.js';
import { imageProcessor } from './image.js';
import { psdProcessor } from './psd.js';
import { dxfProcessor } from './dxf.js';
import { avProcessor } from './av.js';
import { genericProcessor } from './generic.js';

// Order is irrelevant to correctness (highest score wins) but kept meaningful.
export const PROCESSORS: FileProcessor[] = [
  textProcessor,
  jsonProcessor,
  xmlProcessor,
  pdfProcessor,
  officeProcessor,
  imageProcessor,
  psdProcessor,
  dxfProcessor,
  avProcessor,
  genericProcessor,
];

export function pickProcessor(input: { mime: string; ext: string; magic: Buffer }): FileProcessor {
  let best = genericProcessor;
  let bestScore = 0;
  for (const p of PROCESSORS) {
    let score = 0;
    try {
      score = p.match(input);
    } catch {
      score = 0;
    }
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Run extraction with full crash-proofing: timeout, catch-all, and a guaranteed
 * non-empty result (at minimum the metadata block). Returns the processor id used.
 */
export async function runExtraction(
  input: ProcessorInput,
  timeoutMs: number,
): Promise<{ result: ExtractResult; processorId: string }> {
  const proc = pickProcessor({ mime: input.mime, ext: input.ext, magic: input.magic });
  const safeFallback: ExtractResult = { blocks: [metadataBlock(input)], meta: { fallback: true }, degraded: true };

  let result: ExtractResult;
  try {
    result = await withTimeout(() => proc.extract(input), timeoutMs, safeFallback, `extract:${proc.id}`);
  } catch (e) {
    // Contractually processors don't throw, but never trust that at the choke point.
    log.warn('processor threw (using fallback)', { processor: proc.id, name: redact(input.name), ...errFields(e) });
    result = safeFallback;
  }

  if (!result || !Array.isArray(result.blocks) || result.blocks.length === 0) {
    result = safeFallback;
  }
  result.blocks = clampChars(result.blocks, input.caps.maxChars);
  return { result, processorId: proc.id };
}

function redact(name: string): string {
  // file names are user data — keep only the extension for INFO/WARN logs
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `*${name.slice(dot)}` : '*';
}
