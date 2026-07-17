// Central credit deduction for signed-in hd-search users. Skips anonymous/demo
// identities only; all other users are charged via hackerdogs-core when a JWT is present.
import type { Principal } from './auth.js';

export interface ChargeOpts {
  sessionId: string;
  taskId?: string;
  credits: number;
  costUsd?: number;
  /** Floor for billable units (AI Mode uses 1 so self-hosted/Ollama runs still meter). */
  minimum?: number;
}

/**
 * Best-effort debit against the user's core credit balance. Never throws.
 *
 * Self-hosted / open-source mode: credit metering is disabled — this is a no-op.
 * Kept as a single call site (invoked from search/crawl/ai routes) so a local
 * usage meter could be reintroduced later without touching every caller.
 */
export function chargeUserCredits(principal: Principal, opts: ChargeOpts): void {
  void principal;
  void opts;
  return;
}
