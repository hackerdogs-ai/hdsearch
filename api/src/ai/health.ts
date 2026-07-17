// Lightweight in-process model health signal for AI Search. Records the success/failure
// (and latency) of recent model calls as an EWMA, so the auto-select optimizer can route
// around models that are erroring right now — e.g. an Ollama Cloud model returning 401, or
// a provider having a bad moment. This is the minimal version of the telemetry loop the
// spec calls for (§7, §15); a durable store can replace this map later. Process-local.
export interface ModelHealth {
  failRate: number; // 0..1 EWMA of recent failures
  latencyMs?: number; // EWMA of recent successful end-to-end latency
  samples: number;
  lastFailAt?: number; // epoch ms of the most recent failure
}

const H = new Map<string, ModelHealth>();
const ALPHA = 0.4; // weight on the newest observation
const FRESH_FAIL_MS = 10 * 60 * 1000; // a failure decays out of "recent" after 10 min

/** Record the outcome of a model call. ok=false bumps the failure rate. */
export function recordResult(modelId: string, ok: boolean, latencyMs?: number): void {
  const h = H.get(modelId) || { failRate: 0, samples: 0 };
  const obs = ok ? 0 : 1;
  h.failRate = h.samples === 0 ? obs : ALPHA * obs + (1 - ALPHA) * h.failRate;
  if (ok && latencyMs != null && Number.isFinite(latencyMs)) {
    h.latencyMs = h.latencyMs == null ? latencyMs : ALPHA * latencyMs + (1 - ALPHA) * h.latencyMs;
  }
  if (!ok) h.lastFailAt = Date.now();
  h.samples += 1;
  H.set(modelId, h);
}

/** Stats for the optimizer. failRate decays to ~0 once failures are no longer recent. */
export function statsFor(modelId: string): { failRate?: number; latencyMs?: number } {
  const h = H.get(modelId);
  if (!h) return {};
  // if the last failure is stale, don't keep penalizing the model forever
  const failRate = h.lastFailAt && Date.now() - h.lastFailAt > FRESH_FAIL_MS ? 0 : h.failRate;
  return { failRate, latencyMs: h.latencyMs };
}
