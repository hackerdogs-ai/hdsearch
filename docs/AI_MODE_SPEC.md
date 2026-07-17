# HD-Search — AI Mode (Google-style AI Mode) — Detailed Specification

**Status:** **M1–M5 frontend complete** for AI Search: assistant-ui runtime (`Tools` Toolkit + `useAui`), tool-ui-pattern cards (`tool-cards.tsx` / `tool-card-view.tsx`), localStorage thread persistence, sidebar thread list, auto titles, effort control, stop/cancel, error banner. Backend: multi-provider SSE agent, MCP registry, credits. **Remaining (ops scale):** Redis semantic MCP tool selection (`mcp/vector.ts`), Postgres server-side thread sync, full npm tool-ui gallery vendoring (demo has extended widgets under `docs/demos/assistant-ui-hd-demo/src/components/tool-ui/`).
**Companion docs:** [PRD](PRD.md) · [Technical Design](TECHNICAL_DESIGN.md) · [Config & Deploy](CONFIGURATION_DEPLOYMENT.md)

---

## 1. Summary

**AI Mode** is a conversational, agentic answer surface for HD-Search — the same idea as Google's "AI Mode": the user types a natural-language query and gets a synthesized, cited, tool-augmented answer instead of a list of links. It is exposed as a **modality tab next to `✨ Semantic`** in the existing search bar.

It reuses HD-Search's existing **pluggable-provider** philosophy (search/crawl providers, priority CSV, per-user keys, Redis cache) and adds **two new provider families**:

1. **LLM providers & models** — Anthropic (default), plus OpenAI, Google, self-hosted (Ollama/vLLM), etc. Ranked by the user, or **auto-selected by an OR optimizer** that balances **cost, latency, and failure rate**.
2. **MCP servers** — Model Context Protocol tool servers. Ranked/selected by the user, and **semantically narrowed per query** using a Redis-vector index of all available MCP tools.

The LLM runs the query with the selected tools (in the user-configured order), streams back **text + Tool-UI output**, and HD-Search **meters the run in credits** (with margin) using a **self-contained copy** of the hackerdogs-core credit model (no dependency on hackerdogs-core).

The frontend is built on **assistant-ui** (chat runtime, streaming, threads) + **tool-ui** (rich tool-call rendering), themed to **HD-Search branding** — a Claude-like control with hdsearch's look.

> Default model: **`claude-opus-4-8`** (Anthropic Opus 4.8) with **adaptive thinking** and **streaming**, per the project's AI-application defaults. See §6.

---

## 2. Goals / non-goals

**Goals**
- One more modality tab (`AI`) that takes a free-text query and returns a grounded, tool-augmented, streamed answer.
- LLM providers/models and MCP servers are **first-class, rankable, overridable** provider lists — mirroring search/crawl.
- **Auto-select** an LLM (provider+model) via an optimization that trades off cost ↔ latency ↔ reliability; **manual ranking** as the alternative; **per-query dropdown override** (Claude-style model picker).
- **Semantic MCP-tool selection**: query → vector search over tool descriptions → only the relevant tools are exposed to the LLM (not the whole catalog).
- **Credits with margin**, computed self-contained inside hd-search.
- Response = **text + tool UI**, streamed, with citations and per-run cost/credit accounting.

**Non-goals (v1)**
- Training/fine-tuning models. We orchestrate hosted/inference endpoints only.
- Long-lived autonomous agents / background jobs (AI Mode is interactive, request-scoped; multi-turn within a thread is in scope, cron-style autonomy is not).
- Replacing the existing search/crawl/maps modalities — AI Mode complements them (and can call them as tools).

---

## 3. Where it lives in the UI

- New modality tab **`AI`** rendered immediately **after `✨ Semantic`** in both `search-controls.tsx` (results page) and `search-box.tsx` / `page.tsx` (home chips). Styled with the brand accent, like Semantic.
- Selecting `AI` (or `/search?q=…&modality=ai`) renders the **AI Mode panel** instead of the result list: a Claude-like conversation surface (assistant-ui thread) with:
  - the streamed assistant answer (markdown + inline citations),
  - **Tool-UI cards** for each tool/MCP call (collapsible, copy-paste-able),
  - a **model picker** dropdown (auto-select chip + manual override),
  - an **MCP/tools** affordance (which tools were considered/used),
  - a per-run **credits used** chip.
- AI Mode is **request-scoped but thread-aware**: follow-up questions continue the same thread (stateless API — full history re-sent each turn, like the rest of HD-Search).

---

## 4. Architecture

```
        Browser (assistant-ui + tool-ui, hdsearch theme)
                       │  POST /v1/ai/chat  (SSE stream)
                       ▼
        ┌──────────────────────────────────────────────┐
        │  hd-search API  (Hono, TS)                     │
        │                                                │
        │  routes/ai.ts ──▶ ai/orchestrator.ts           │
        │     │                                          │
        │     ├─ model-selector.ts  (OR optimizer / rank)│  ◀─ telemetry (cost/latency/fail)
        │     ├─ mcp/registry.ts + mcp/vector.ts         │  ◀─ Redis vectors (tool embeddings)
        │     ├─ providers/llm/* (anthropic, openai, …)  │  ◀─ per-user encrypted keys
        │     ├─ tools/* (hd_search, hd_crawl, mcp tools) │
        │     ├─ credits.ts  (self-contained margin calc) │
        │     └─ ai/stream.ts (SSE: text + tool_ui)       │
        └──────────────────────────────────────────────┘
              │            │              │            │
        hdsearch-redis   Postgres      LLM provider   MCP servers
        (vec + cache)    (usage/credits) endpoints     (tools)
```

New code (all under `api/src/`):
- `routes/ai.ts` — `/v1/ai/*` endpoints (auth + quota + credit gate).
- `ai/orchestrator.ts` — the agent loop (model call → tool calls → loop → final).
- `ai/model-selector.ts` — auto-select optimizer + explicit ranking.
- `providers/llm/{anthropic,openai,google,ollama,...}.ts` — LLM provider plugins.
- `mcp/{registry,client,vector}.ts` — MCP server registry, client, semantic tool index.
- `credits.ts` — self-contained credit/margin meter (duplicated from hackerdogs-core concept).
- `ai/stream.ts` — SSE event protocol (assistant-ui/tool-ui compatible).

---

## 5. Request flow (end-to-end)

1. **User enters a query** in AI Mode (optionally with thread history).
2. **Model selection** (`model-selector.ts`):
   - If the user set **auto-select** → run the **OR optimizer** (§7) over the eligible LLM models (those the user has keys/credits for, that meet the query's requirements) to pick `(provider, model)`.
   - Else → use the **user-ranked** order (first eligible wins, with fallback down the list on failure).
   - A **per-query dropdown override** (Claude-style) pins a specific model for this turn.
3. **MCP tool selection** (`mcp/vector.ts`):
   - Embed the query (MiniLM, the existing embedder) and **KNN over the Redis vector index of all MCP tools** (§8) → the top-K most relevant tools.
   - Union with any **always-on** tools the user pinned, and the built-in HD-Search tools (`hd_search`, `hd_crawl`, `hd_vector_search`, `hd_archive`, `hd_maps`).
   - Respect the user's **MCP server ordering** (default or overridden) for tie-breaks and for the order tools are offered to the model.
4. **Agent loop** (`ai/orchestrator.ts`): call the chosen LLM with the system prompt + history + tool set; on `tool_use`, execute the tool (built-in or via MCP client), append results, loop until the model returns a final answer (`end_turn`) or hits a step/credit ceiling.
5. **Stream** text + tool-UI blocks to the browser as they arrive (SSE).
6. **Meter** the run: sum input/output tokens (and any sub-tool model costs) → provider USD cost → **apply margin → credits** (§9). Debit the user's credit balance; record usage row.
7. **Return** final message with citations, the models/tools used, and credits charged.

---

## 6. LLM provider & model registry

LLM providers are plugins implementing a small interface (mirrors `SearchProvider`/`CrawlProvider`):

```ts
interface LlmModel {
  id: string;                 // "claude-opus-4-8"
  provider: string;           // "anthropic"
  label: string;              // "Claude Opus 4.8"
  contextTokens: number;      // 1_000_000
  maxOutputTokens: number;    // 128_000
  // pricing in USD per 1M tokens — drives cost in the optimizer + credits
  inputPer1M: number;         // 5.00
  outputPer1M: number;        // 25.00
  cachedInputPer1M?: number;  // ~0.1x input for cache reads
  capabilities: { tools: boolean; vision: boolean; thinking: boolean; streaming: boolean };
  accessType: 'commercial' | 'self-hosted' | 'freemium';
  requiresKeys: string[];     // ["anthropic"] — per-user encrypted key
}

interface LlmProvider {
  id: string;                 // "anthropic"
  models: LlmModel[];
  // streamed chat with tool use; returns token usage for metering
  chat(req: LlmChatRequest, ctx): AsyncIterable<LlmStreamEvent>;
}
```

### Anthropic (default, flagship) — authoritative model table

| Model | id | Context | Max out | Input $/1M | Output $/1M |
|---|---|---|---|---|---|
| Claude Fable 5 | `claude-fable-5` | 1M | 128K | 10.00 | 50.00 |
| **Claude Opus 4.8 (default)** | `claude-opus-4-8` | 1M | 128K | 5.00 | 25.00 |
| Claude Opus 4.7 | `claude-opus-4-7` | 1M | 128K | 5.00 | 25.00 |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | 1M | 64K | 3.00 | 15.00 |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 200K | 64K | 1.00 | 5.00 |

Implementation notes (from the project's Claude-API guidance):
- Use the official **`@anthropic-ai/sdk`** (TypeScript) — never raw fetch for Anthropic.
- Default request: `model: "claude-opus-4-8"`, `thinking: {type: "adaptive"}`, **streaming** via `messages.stream()` (high `max_tokens` requires streaming), tool use for tool calls.
- The 4.x family: **no `budget_tokens`, no `temperature`/`top_p`/`top_k`** (they 400) — control depth with `output_config: {effort: "low|medium|high|xhigh|max"}`.
- MCP: the Messages API can connect to remote MCP servers directly (`mcp_servers` param), or we drive local/remote MCP via our own client (§8) and pass converted tools. v1 uses **our own MCP client** so tool selection, vault-less per-user creds, and credit metering stay in our control.
- Token usage for metering comes from `usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`).

### Other providers (pluggable, post-v1 or behind keys)
- **OpenAI** (`gpt-*`), **Google** (`gemini-*`) — each with its own SDK and pricing rows; same `LlmModel` shape.
- **Self-hosted** (`ollama`, `vllm`, `lm-studio`) — `accessType: 'self-hosted'`, `inputPer1M/outputPer1M = 0` (only infra cost), so the optimizer can prefer them when "minimize cost" dominates. These echo the openserp/crawl4ai self-hosted-first philosophy.

Pricing lives in a **hot-reloadable table** (like `priorities.csv`) so ops can adjust without redeploy: `ai-models.csv` → `provider,model,input_per_1m,output_per_1m,enabled,default_rank`.

---

## 7. Model auto-selection — the OR optimizer

When the user picks **Auto-select**, `model-selector.ts` chooses `(provider, model)` by solving a small **multi-objective optimization** that balances **cost, response time, and failure rate**. When the user picks **Manual**, they provide an explicit ranked list and we use first-eligible with fallback.

### 7.1 Inputs (per candidate model)
- **Estimated cost** `c` (USD): `est_input_tokens·inputPer1M/1e6 + est_output_tokens·outputPer1M/1e6`. `est_input_tokens` from `count_tokens` (or a fast estimate) on the prompt+history+tool schemas; `est_output_tokens` from a per-modality prior.
- **Latency** `t` (s): EWMA of recent **time-to-first-token + tokens/sec × est_output** for that model, from telemetry (§14). Cold start → table default.
- **Failure rate** `f` (0–1): EWMA of recent error/timeout/refusal rate for that model.
- **Capability gate**: model must support what the query needs (tools, vision, context length ≥ prompt size). Models failing the gate are removed before scoring.

### 7.2 Normalization + scoring (default: weighted-sum scalarization)
Min-max normalize each metric across the eligible set to `[0,1]` (so units don't dominate), then minimize:

```
score(m) = w_cost · ĉ(m) + w_latency · t̂(m) + w_fail · f̂(m)
pick = argmin_m score(m)      subject to capability + budget constraints
```

- Default weights `{cost: 0.4, latency: 0.3, fail: 0.3}`, **user-tunable** via a 3-slider "balance" control (Cheaper ↔ Faster ↔ More reliable) that re-normalizes to sum 1.
- **Hard constraints** (filtered, not scored): `c ≤ remaining_credit_budget_usd`, `contextTokens ≥ prompt_tokens`, required capabilities present, model `enabled`, user has a key (or it's self-hosted).
- **Tie-break / exploration**: ε-greedy (e.g. 5%) picks a non-top candidate occasionally so the EWMAs for latency/failure stay fresh (avoids starving never-tried models). Logged as "exploration".
- **Fallback chain**: the optimizer returns a *ranked* list, not just a winner; on a hard failure mid-run we advance to the next-best (cache-safe: a model switch starts a fresh request, no prompt-cache reuse).

> This is intentionally a lightweight OR formulation (constrained weighted-sum scalarization of a 3-objective problem). It is explainable ("picked Sonnet 4.6: 38% cheaper, within 0.2s of Opus, 0% recent failures") and cheap to evaluate per request. A Pareto-front / lexicographic variant is a post-v1 option if weighted-sum proves too blunt.

### 7.3 Manual ranking
User drags providers+models into an ordered list (like the priority CSV). `model-selector` returns that order, first-eligible wins, with the same capability/budget filtering and fallback-on-failure. Per-query dropdown override pins one model for the current turn only.

---

## 8. MCP servers — registry + semantic tool selection (Redis vectors)

### 8.1 Registry
MCP servers are a rankable provider list (default or user-overridden), each: `{ id, label, transport: 'http'|'sse'|'stdio', url, requiresKeys[], enabled, rank }`. Per-user credentials are stored with the existing **encrypted keystore** (AES-256-GCM), never in the agent context.

`mcp/client.ts` speaks MCP (initialize → `list_tools` → `call_tool`), normalizing tool schemas to the LLM tool-definition shape.

### 8.2 Vectorized tool index (the key idea)
Instead of dumping every MCP tool into the model's context (token-expensive, dilutes tool choice), we **index every tool's description as a vector in Redis** and select per query by meaning:

- **Index build** (on registry change / periodic): for each `(server, tool)`, embed `"<tool.name>: <tool.description> [args: …]"` with the existing **MiniLM** embedder; store in **RediSearch HNSW** under namespace `ai-tools` with payload `{server, tool, schema, server_rank}`. Key: `hds:vec:doc:ai-tools:<sha>`.
- **Per-query selection**: embed the query → **KNN (k≈12, cosine)** over `ai-tools` → candidate tools. Re-rank by `α·similarity + β·server_rank_boost`. Keep top-N (default 8) under a token budget; always include pinned/always-on tools + built-in HD-Search tools.
- The selected tool set is what we pass to the LLM for this turn. This makes tool availability **a semantic function of the query**, not a static dump — and keeps prompt size + tool-choice quality high.
- Reuses the project's RediSearch infrastructure (`hdsearch-redis`, brute-force cosine fallback when RediSearch is absent), so no new dependency.

Built-in tools (always candidates): `hd_search`, `hd_crawl`, `hd_vector_search`, `hd_archive`, `hd_maps`, `hd_list_engines` — i.e. AI Mode can drive the rest of HD-Search.

---

## 9. Credits & margin (self-contained — duplicated from hackerdogs-core concept)

> **Requirement:** hd-search must NOT depend on hackerdogs-core. We **re-implement** the credit math in `api/src/credits.ts`. The model below mirrors hackerdogs-core's `cost_analysis.py` (`USD_TO_CREDIT_RATE = 100`, `DEFAULT_MARGIN = 0.80`, `price = cost/(1−margin)`, `credits = ceil(price × USD_TO_CREDIT_RATE)`).

### 9.1 Constants (config-overridable)
- `USD_TO_CREDIT_RATE = 100` → **1 credit = $0.01** (100 credits = $1.00).
- `DEFAULT_MARGIN = 0.80` → **80% margin** (price = 5× provider cost). Per-plan / per-provider overrides allowed.

### 9.2 Formula
```ts
// provider cost (USD) for one run = sum over every model call in the run:
//   inputTokens  * inputPer1M  / 1e6
// + outputTokens * outputPer1M / 1e6
// + cacheReadTokens * cachedInputPer1M / 1e6   (if any)
// (+ any nested sub-model/tool costs)
function creditsFor(providerCostUsd: number, margin = 0.80, rate = 100): number {
  const priceUsd = providerCostUsd / (1 - margin); // gross up for margin
  return Math.ceil(priceUsd * rate);               // → whole credits, rounded up
}
// user is charged: credits / rate  USD  (e.g. 170 credits → $1.70)
```

**Worked example** (matches the hackerdogs reference txn): provider cost `$0.33` → price `0.33/(1−0.80)=$1.65` → `ceil(1.65×100)=165 credits` → user charged `$1.65`. Margin = price − cost = `$1.32` (80%).

### 9.3 Plans & balances
- Plans grant a monthly credit allotment (e.g. **Enterprise $299.99/mo → 10,000 credits**) or credits are sold in **packages** (e.g. **$10,000 package**), mirroring the hackerdogs tiers. (Exact plan→credit mapping is set in `plans.ts`.)
- Before a run, **estimate** worst-case credits (from the optimizer's chosen model + est tokens + step ceiling) and **gate**: insufficient balance → `402 insufficient_credits` with the estimate. After the run, debit **actual** credits and record a usage row (`ai_runs`).
- A hard **credit ceiling per run** (config, e.g. 5,000 credits) stops runaway agent loops; the orchestrator aborts and returns partial output + the reason.

### 9.4 Storage
- `ai_runs` (Timescale hypertable): `ts, user_id, thread_id, model, providers_used[], tools_used[], input_tokens, output_tokens, provider_cost_usd, margin, credits, status, took_ms`.
- Live balance counter in Redis (`hds:credits:<user>`) with periodic reconcile to Postgres (source of truth), same pattern as rate-limit buckets.

---

## 10. Frontend — assistant-ui + tool-ui (evaluation + plan)

### 10.1 assistant-ui — verdict: **adopt** for the chat surface
- React component library purpose-built for AI chat: **streaming**, **threads/history**, message editing/regeneration, attachments, **tool UIs**, generative UI. Unstyled, **Radix-style accessible primitives** → fully themeable to HD-Search branding (our Tailwind `brand`/`ink` tokens). Open-source (MIT).
- **Runtime fit:** it supports **arbitrary backends** via custom runtimes (`ExternalStoreRuntime` / `LocalRuntime` / a custom `AssistantRuntime`). We wire our **SSE `/v1/ai/chat`** stream into a custom runtime adapter — no Vercel-AI-SDK or LangGraph dependency required. Tool calls render through assistant-ui's **tool-UI registry** (`makeAssistantToolUI` keyed by tool name).
- We keep our BFF pattern: the browser talks to the Next.js BFF (`/api/ai`), which proxies to `/v1/ai/chat` with the internal secret + `X-HD-User`; the browser never holds an API key.

### 10.2 tool-ui — verdict: **adopt** for rich tool/MCP rendering
- Companion to assistant-ui (same ecosystem): a gallery of **JSON-native, typed, accessible, copy-paste** components (Tailwind + Radix + shadcn) for rendering tool calls/structured results as polished cards (tickets, plans, metrics, command runs, etc.) rather than raw JSON.
- Plan: map each built-in tool and common MCP tool output to a tool-ui component; unknown tools fall back to a generic JSON/table card. Because it's copy-paste (shadcn-style), we vendor the components we use into `web/src/components/ai/tools/` and theme them — no runtime lock-in.

### 10.3 Controls (Claude-like, hdsearch-branded)
Expose the controls frontier chat UIs + assistant-ui provide, branded as HD-Search:
- **Model picker** dropdown: `Auto-select` (default, shows the chosen model + why) or a specific model (Opus 4.8 / Sonnet 4.6 / Haiku 4.5 / …).
- **Balance sliders**: Cheaper ↔ Faster ↔ More reliable (feeds optimizer weights §7).
- **Tools/MCP**: which servers are enabled, pin "always-on" tools, and a per-message "tools used" disclosure.
- **Effort** (Anthropic): low/medium/high/xhigh/max.
- **Thread** controls: new chat, edit & regenerate, stop/interrupt, copy, retry-with-different-model.
- **Citations**: inline source chips linking to the underlying search/crawl results.
- **Credits**: per-run credits-used chip + running thread total.
- Attachments (images/files) where the chosen model supports vision.

---

## 11. API surface

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/ai/chat` | **SSE stream.** Body: `{messages[], modelOverride?, autoSelect?, weights?, mcp?, effort?, threadId?}`. Streams text + tool-ui events; ends with usage+credits. |
| GET | `/v1/ai/models` | List LLM models (availability per user keys, pricing, capabilities, default rank). |
| GET/PUT | `/v1/ai/config` | User AI prefs: auto-select on/off, model ranking, weights, MCP ranking, pinned tools. |
| GET | `/v1/ai/mcp` | List MCP servers + (optionally) their tools; availability per user creds. |
| POST | `/v1/ai/mcp/reindex` | Rebuild the Redis tool-vector index (admin / on registry change). |
| GET | `/v1/ai/runs` | Usage/credit history for AI Mode (Timescale). |

Auth: same `requireAuth` + scopes as the rest of the API. AI Mode requires plan entitlement (e.g. DevTest+); credits gate each run.

### 11.1 SSE event protocol (assistant-ui/tool-ui friendly)
```
event: meta         data: {model, providersConsidered, toolsSelected, reason}
event: text         data: {delta}                       // streamed answer tokens
event: tool_call    data: {id, name, server, input}     // a tool/MCP call started
event: tool_result  data: {id, ui, content, citations}  // tool-ui block + raw
event: thinking     data: {delta}                       // optional, if effort surfaced
event: usage        data: {inputTokens, outputTokens, providerCostUsd, credits}
event: done         data: {threadId, stopReason}
event: error        data: {message, retriable}
```

---

## 12. Data model

- **Postgres** (`hd_search` schema): `ai_threads(id, user_id, title, created_at)`, `ai_messages(thread_id, role, content, tool_calls, created_at)`, `ai_runs` (§9.4), `ai_prefs(user_id, auto_select, weights, model_rank[], mcp_rank[], pinned_tools[])`, `ai_mcp_servers(id, label, transport, url, requires_keys[], enabled, rank)`.
- **Redis** (`hdsearch-redis`): tool-vector index `ai-tools` (RediSearch HNSW); per-user credit counter `hds:credits:<user>`; response cache for identical `(model, prompt, tools)` (short TTL, opt-out); rate-limit buckets.
- **Encrypted keystore**: per-user LLM provider keys + MCP credentials (existing AES-256-GCM store).

---

## 13. Security, limits, safety
- Browser never holds LLM keys — BFF + internal secret, exactly like search/crawl.
- MCP credentials live in the encrypted keystore and are injected server-side; the model context never sees raw secrets (prompt-injection-safe).
- Per-run **step ceiling** + **credit ceiling** stop runaway loops; per-user rate limits (reuse the limiter); demo/anon users get a small free allowance or are blocked from AI Mode.
- Tool calls with side effects (any future write-capable MCP tool) are gated behind explicit user confirmation in the UI (assistant-ui tool-confirmation pattern).
- Refusals/safety stops surface cleanly to the UI; no auto-retry of refused prompts.

---

## 14. Telemetry (feeds the optimizer)
Every model call records `{model, ttft_ms, tokens_per_s, input_tokens, output_tokens, ok, error_type}`. EWMA aggregates per model (Redis) drive the optimizer's **latency** and **failure-rate** inputs; the pricing table drives **cost**. A nightly job persists aggregates to Postgres for dashboards. This closes the loop: auto-select gets better as real usage accrues.

---

## 15. Phased delivery

1. **M1 — Skeleton:** `AI` tab; `/v1/ai/chat` SSE with **Anthropic Opus 4.8 only**, streaming, built-in `hd_search`/`hd_crawl` tools; assistant-ui surface (no MCP yet); credits metered. Manual model dropdown.
2. **M2 — Credits & plans:** self-contained `credits.ts`, balance gate, `ai_runs`, dashboard usage; per-run/credit ceilings.
3. **M3 — Multi-provider + optimizer:** OpenAI/Google/self-hosted plugins; `model-selector.ts` auto-select (weighted-sum OR) + balance sliders; manual ranking; fallback chains; telemetry EWMAs.
4. **M4 — MCP + semantic tools:** MCP registry/client; Redis tool-vector index; per-query KNN tool selection; tool-ui rich rendering for built-ins + common MCP tools.
5. **M5 — Polish:** threads/history, edit-&-regenerate, attachments/vision, citations, effort control, exploration/ε-greedy, docs + API-reference + SDK snippets.

---

## 16. Open decisions
- **Direct Anthropic `mcp_servers`** vs **our own MCP client** for tool execution — v1 uses our client (control over selection + credits); revisit if direct connector is materially simpler for read-only servers.
- **Optimizer**: weighted-sum (v1) vs Pareto/lexicographic — start simple, measure.
- **Credit estimate accuracy**: how aggressively to pre-gate vs. settle-on-actual; expose the estimate in the UI before the user spends.
- **Plan entitlements**: which plans get AI Mode and at what credit allotment (align with hackerdogs tiers).

---

## Appendix A — credits.ts (reference implementation sketch)

```ts
// Self-contained credit meter for HD-Search AI Mode. No dependency on hackerdogs-core.
// Mirrors hackerdogs cost_analysis.py: 1 USD = 100 credits, 80% default margin.
export const USD_TO_CREDIT_RATE = Number(process.env.HDSEARCH_USD_TO_CREDIT_RATE) || 100;
export const DEFAULT_MARGIN = Number(process.env.HDSEARCH_AI_MARGIN) || 0.80;

export interface ModelPrice { inputPer1M: number; outputPer1M: number; cachedInputPer1M?: number; }
export interface TokenUsage { inputTokens: number; outputTokens: number; cacheReadTokens?: number; }

export function providerCostUsd(u: TokenUsage, p: ModelPrice): number {
  return (
    (u.inputTokens * p.inputPer1M) / 1e6 +
    (u.outputTokens * p.outputPer1M) / 1e6 +
    ((u.cacheReadTokens || 0) * (p.cachedInputPer1M ?? p.inputPer1M)) / 1e6
  );
}

export function creditsFor(costUsd: number, margin = DEFAULT_MARGIN, rate = USD_TO_CREDIT_RATE): number {
  const priceUsd = costUsd / (1 - margin);     // gross up for margin
  return Math.max(1, Math.ceil(priceUsd * rate));
}

export const usdCharged = (credits: number, rate = USD_TO_CREDIT_RATE) => credits / rate;
```

## Appendix B — model-selector.ts (auto-select sketch)

```ts
// Weighted-sum OR scalarization over {cost, latency, failure}, with hard constraints.
interface Candidate { model: LlmModel; cost: number; latency: number; fail: number; eligible: boolean; }

function autoSelect(cands: Candidate[], w = { cost: 0.4, latency: 0.3, fail: 0.3 }): LlmModel[] {
  const ok = cands.filter(c => c.eligible);                 // capability + budget + key gates
  const norm = (xs: number[]) => {                          // min-max → [0,1]
    const lo = Math.min(...xs), hi = Math.max(...xs), d = hi - lo || 1;
    return (x: number) => (x - lo) / d;
  };
  const nc = norm(ok.map(c => c.cost)), nt = norm(ok.map(c => c.latency)), nf = norm(ok.map(c => c.fail));
  return ok
    .map(c => ({ c, s: w.cost * nc(c.cost) + w.latency * nt(c.latency) + w.fail * nf(c.fail) }))
    .sort((a, b) => a.s - b.s)                                // lower score = better
    .map(x => x.c.model);                                    // ranked; [0] is the pick, rest = fallback chain
}
```

## Appendix C — sources
- Claude model IDs, pricing, and defaults: HD-Search Claude-API reference (Opus 4.8 default, adaptive thinking, streaming, MCP, `@anthropic-ai/sdk`).
- Credit/margin model: hackerdogs-core `cost_analysis.py` (`USD_TO_CREDIT_RATE=100`, `DEFAULT_MARGIN=0.80`, `price=cost/(1−margin)`, `credits=ceil(price×100)`) — re-implemented self-contained.
- Frontend: [assistant-ui](https://www.assistant-ui.com/) (chat runtime, streaming, tool UIs, custom backends, MIT) + [tool-ui](https://www.tool-ui.com/) (JSON-native tool-call components on Tailwind/Radix/shadcn).
