// AI Mode agent loop — provider-agnostic. Picks an LlmProvider for the chosen model
// (Anthropic, Ollama, …), streams the answer, runs tool calls (built-in HD-Search tools
// + MCP tools), loops until the model is done, and meters the run in credits. Emits a
// normalized event stream consumed by the SSE route + web UI. If the chosen model can't
// start (no key / endpoint down), it falls back down the provided chain before failing.
// See docs/AI_MODE_SPEC.md §5, §11.1.
import { isDev } from '../env.js';
import { collectTools } from './tools.js';
import { meter, type TokenUsage } from '../credits.js';
import type { LlmModel } from './models.js';
import { getProvider } from './providers/index.js';
import { recordResult } from './health.js';
import type { NeutralMsg, ToolSpec, MsgImage } from './providers/types.js';
import { log, errFields } from '../logger.js';
import { buildTimeContextBlock, type ClientTimeContext } from './client-time.js';

export type AiEvent =
  | { type: 'meta'; model: string; provider: string; reason?: string; toolsAvailable: string[] }
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; ui?: unknown; citations?: { title: string; url: string }[]; error?: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number; providerCostUsd: number; credits: number }
  | { type: 'done'; stopReason: string; credits: number }
  | { type: 'error'; message: string; retriable: boolean };

export interface AiChatOpts {
  model: LlmModel;
  fallbacks?: LlmModel[];
  /** When true, run only opts.model — never substitute another model. */
  strictModel?: boolean;
  messages: { role: 'user' | 'assistant'; content: string; images?: MsgImage[] }[];
  userId?: string;
  planId?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** RAG depth for hd_search — snippet-only vs full page reads. Default low. */
  sourceDetails?: 'low' | 'medium' | 'high';
  maxSteps?: number;
  creditCeiling?: number;
  reason?: string;
  /** Browser-reported UTC + local clock; injected into the system prompt each turn. */
  clientTime?: ClientTimeContext;
}

const SYSTEM = `You are HD-Search AI Mode, a helpful research assistant with rich UI tools. Answer the user's question directly, accurately, and thoroughly.

Use tools to gather live facts (search, crawl, maps, etc.). Tool cards show raw results in the UI — your final written answer must still synthesize everything into a clear, comprehensive response for the user.

## TOOLS

hd_search — Search web/news/images/videos/scholar/code/social/maps/darkweb. Use for current facts.
hd_crawl — Fetch and read a specific URL in full (markdown).
hd_maps — Find local places/businesses ("coffee shops near X"). Renders an interactive map.
hd_plot_map — Plot named places on a map (ranges, country lists, itineraries). NEVER say you "cannot display a map."
hd_archive — Fetch an archived snapshot of a URL from Common Crawl / Wayback Machine.
hd_chart — MUST use for ANY data visualization. Supports bar, line, pie, area. Supply chartType, labels, and datasets.
hd_weather — MUST use for ANY weather question. Returns live data + 5-day forecast.
hd_render — MUST use to render rich UI. Set kind + payload:
  code_block: {code, language, filename} — for ANY code snippet
  code_diff: {filename, hunks: [{oldStart, newStart, lines: [{type, content}]}]} — for ANY diff
  data_table: {columns, rows, caption} — for ANY tabular data
  stats: {stats: [{label, value, change, unit}]} — for ANY metrics/stats
  plan: {title, steps: [{label, status, detail}]} — for ANY step-by-step plan
  progress: {title, steps: [{label, status}], percent} — for ANY progress/tracker
  terminal: {command, output, exitCode} — for ANY terminal/CLI output
  social_post: {platform, author, handle, content, likes, shares, comments} — for ANY social post draft
  message_draft: {to, subject, body, type} — for ANY email/message draft
  approval: {title, description, items: [{label, value}], status} — for ANY approval/review card
  order_summary: {items: [{name, qty, price}], total, currency} — for ANY order/price summary
  option_list: {question, options: [{label, description}], selected} — for ANY option/choice list
  citation: {sources: [{title, url, snippet, date}]} — for cited source lists
  link_preview: {url, title, description, image} — for rich link previews
  item_carousel: {items: [{title, description, image, url}]} — for item grids/carousels
  question_flow: {questions: [{q, a}]} — for Q&A flows

## MANDATORY TOOL USAGE — you MUST follow these rules:

1. "chart" / "graph" / "compare" / "visualize" / "plot data" → ALWAYS call hd_chart. NEVER write numbers in a markdown table instead.
2. "weather" / "temperature" / "forecast" → ALWAYS call hd_weather. NEVER guess the weather from training data.
3. Code snippet requests → ALWAYS call hd_render kind=code_block. NEVER write a markdown code block instead.
4. "diff" / "before and after" code → ALWAYS call hd_render kind=code_diff.
5. "table" / "compare in a table" → ALWAYS call hd_render kind=data_table.
6. "stats" / "metrics" / "key numbers" → ALWAYS call hd_render kind=stats.
7. "plan" / "steps" / "roadmap" → ALWAYS call hd_render kind=plan.
8. "progress" / "tracker" / "% done" → ALWAYS call hd_render kind=progress.
9. "draft a tweet" / "post" / "social media" → ALWAYS call hd_render kind=social_post.
10. "draft an email" / "write a message" → ALWAYS call hd_render kind=message_draft.
11. "terminal" / "command output" / "CLI" → ALWAYS call hd_render kind=terminal.
12. "approval" / "budget request" → ALWAYS call hd_render kind=approval.
13. "order" / "summary" / "receipt" → ALWAYS call hd_render kind=order_summary.
14. "options" / "choose" / "which one" → ALWAYS call hd_render kind=option_list.
15. "carousel" / "top attractions" / "list of items" → ALWAYS call hd_render kind=item_carousel.
16. "image" / "photo" / "picture" / "show me an image" → ALWAYS use hd_search with modality=images. This renders an image gallery card. NEVER use the default web modality for image requests.
17. "video" / "watch" / "find videos" → ALWAYS use hd_search with modality=videos. Renders a video player.
18. "news" / "latest" / "recent developments" → ALWAYS use hd_search with modality=news. Renders link preview cards.
19. "scholarly" / "papers" / "research" / "academic" → ALWAYS use hd_search with modality=scholar. Renders citation cards.
20. Maps: for "<thing> in/near <place>" use hd_maps. For conceptual locations use hd_plot_map.

## RULES
- NEVER repeat a search with a rephrased query. One search per topic — if the first search returns results, use them. Do NOT try variations.
- For map place names, use REAL, geocodable names with country — "Queensland, Australia" not "Northeastern Australia".
- Call each tool at most ONCE per topic unless new information is genuinely needed.
- Cite URLs inline as [n]. Never fabricate facts or links.
- Do NOT narrate your process in the answer (no "I'll search…", "Based on my results…", "Let me compile…"). The UI shows tool activity. Call tools without preamble; after gathering enough evidence, STOP calling tools and write only the final substantive answer.
- For research questions (companies, people, funding, comparisons): the final answer MUST be substantive — multiple paragraphs with sections (overview, funding/investors, team, product, sources). Do not stop at one sentence.`;

function systemPrompt(clientTime?: ClientTimeContext): string {
  return SYSTEM + buildTimeContextBlock(clientTime);
}

function synthesisSystemPrompt(clientTime?: ClientTimeContext): string {
  return `${systemPrompt(clientTime)}

## FINAL ANSWER (mandatory)
You have finished gathering research. Do NOT call any tools.
Write a comprehensive, well-structured final answer using everything in the conversation above (including tool results).
Use markdown headings for sections when helpful. Include specific names, amounts, dates, and investors where known.
Cite sources inline as [n]. If data conflicts across sources, note the discrepancy.`;
}

async function modelReady(model: LlmModel, userId?: string, planId?: string): Promise<boolean> {
  const provider = getProvider(model.provider);
  if (!provider) return false;
  try {
    return await provider.available(model, userId, planId);
  } catch {
    return false;
  }
}

export async function* runAiChat(opts: AiChatOpts): AsyncGenerator<AiEvent> {
  const { specs, byName } = await collectTools(opts.userId);
  const toolSpecs: ToolSpec[] = specs.map((d) => ({ name: d.name, description: d.description, input_schema: d.input_schema }));

  // Build the attempt list. strictModel = user pinned a model in the UI — never substitute.
  const seen = new Set<string>();
  const chain = opts.strictModel ? [opts.model] : [opts.model, ...(opts.fallbacks || [])];
  const candidates = chain.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
  const ready: LlmModel[] = [];
  for (const m of candidates) {
    if (!opts.strictModel && ready.length >= 3) break;
    if (await modelReady(m, opts.userId, opts.planId)) ready.push(m);
  }

  if (!ready.length) {
    yield { type: 'meta', model: opts.model.id, provider: opts.model.provider, reason: opts.reason, toolsAvailable: toolSpecs.map((t) => t.name) };
    yield { type: 'error', retriable: false, message: noProviderMessage(opts.model) };
    return;
  }

  let used = ready[0]!;
  let total: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  let stopReason = 'end_turn';
  let errored = false;

  for (let i = 0; i < ready.length; i++) {
    const model = ready[i]!;
    const provider = getProvider(model.provider)!;
    const reason = i === 0 ? opts.reason : `auto-recovered: ${ready[i - 1]!.label} failed, retrying on ${model.label}`;
    yield { type: 'meta', model: model.id, provider: model.provider, reason, toolsAvailable: toolSpecs.map((t) => t.name) };

    // each attempt gets a fresh transcript (a failed attempt must not leak half-state)
    const messages: NeutralMsg[] = opts.messages.map((m) =>
      m.role === 'user'
        ? { role: 'user', content: m.content, ...(m.images?.length ? { images: m.images } : {}) }
        : { role: 'assistant', content: m.content },
    );
    const t0 = Date.now();
    const attempt = runOnce(model, provider, messages, toolSpecs, byName, opts);
    let r = await attempt.next();
    while (!r.done) {
      yield r.value;
      r = await attempt.next();
    }
    const out = r.value;
    total = out.total;
    stopReason = out.stopReason;
    used = model;

    if (out.ok) {
      recordResult(model.id, true, Date.now() - t0);
      break;
    }
    // failed: penalize this model so auto-select routes around it next time
    recordResult(model.id, false);
    if (opts.strictModel) {
      errored = true;
      yield { type: 'error', message: out.errorMsg || 'model call failed', retriable: true };
      break;
    }
    // if it failed before emitting anything AND we have another option, fall back silently
    if (!out.producedOutput && i < ready.length - 1) continue;
    // otherwise surface the error (can't cleanly switch mid-answer, or out of options)
    errored = true;
    yield { type: 'error', message: out.errorMsg || 'model call failed', retriable: true };
    break;
  }

  const m = meter(total, used);
  yield { type: 'usage', inputTokens: total.inputTokens, outputTokens: total.outputTokens, providerCostUsd: m.providerCostUsd, credits: m.credits };
  yield { type: 'done', stopReason: errored ? 'error' : stopReason, credits: m.credits };
}

interface AttemptResult {
  ok: boolean;
  producedOutput: boolean;
  total: TokenUsage;
  stopReason: string;
  errorMsg?: string;
}

/** Run the agent loop for ONE model. Yields events; returns the attempt outcome. */
async function* runOnce(
  model: LlmModel,
  provider: ReturnType<typeof getProvider> & {},
  messages: NeutralMsg[],
  toolSpecs: ToolSpec[],
  byName: Awaited<ReturnType<typeof collectTools>>['byName'],
  opts: AiChatOpts,
): AsyncGenerator<AiEvent, AttemptResult> {
  const total: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  let stopReason = 'end_turn';
  let producedOutput = false;
  const maxSteps = opts.maxSteps ?? 10;
  const executed = new Map<string, string>(); // tool-call signature → result content (dedupe loops)
  let endedWithFinalText = false;

  try {
    for (let step = 0; step < maxSteps; step++) {
      const turn = provider!.streamTurn({
        model,
        system: systemPrompt(opts.clientTime),
        messages,
        tools: toolSpecs,
        userId: opts.userId,
        planId: opts.planId,
        effort: opts.effort,
        maxOutputTokens: 8000,
      });

      let res = await turn.next();
      while (!res.done) {
        const d = res.value;
        producedOutput = true;
        if (d.type === 'text') yield { type: 'text', delta: d.delta };
        else yield { type: 'thinking', delta: d.delta };
        res = await turn.next();
      }
      const result = res.value;

      total.inputTokens += result.usage.inputTokens;
      total.outputTokens += result.usage.outputTokens;
      total.cacheReadTokens! += result.usage.cacheReadTokens || 0;
      stopReason = result.stopReason;

      if (!result.toolCalls.length) {
        endedWithFinalText = true;
        break;
      }

      producedOutput = true;
      messages.push({ role: 'assistant', content: result.text, toolCalls: result.toolCalls, raw: result.raw });

      // Some models (esp. local ones) loop — re-emitting the same answer and re-calling the
      // same tool every step. Dedupe identical calls (return the cached result, no new card)
      // and stop once a turn adds nothing new, so we don't render N identical cards/answers.
      let freshCalls = 0;
      for (const tc of result.toolCalls) {
        const sig = `${tc.name}|${JSON.stringify(tc.input ?? {})}`;
        const cached = executed.get(sig);
        if (cached !== undefined) {
          // already ran this exact call → feed back the prior result, don't re-render
          messages.push({ role: 'tool', toolCallId: tc.id, name: tc.name, content: cached });
          continue;
        }
        freshCalls++;
        yield { type: 'tool_call', id: tc.id, name: tc.name, input: tc.input };
        const tool = byName.get(tc.name);
        if (!tool) {
          executed.set(sig, `Unknown tool: ${tc.name}`);
          messages.push({ role: 'tool', toolCallId: tc.id, name: tc.name, content: `Unknown tool: ${tc.name}`, isError: true });
          yield { type: 'tool_result', id: tc.id, name: tc.name, error: 'unknown tool' };
          continue;
        }
        try {
          const tr = await tool.run(tc.input, { userId: opts.userId, sourceDetails: opts.sourceDetails ?? 'low' });
          executed.set(sig, tr.content);
          messages.push({ role: 'tool', toolCallId: tc.id, name: tc.name, content: tr.content });
          yield { type: 'tool_result', id: tc.id, name: tc.name, ui: tr.ui, citations: tr.citations };
        } catch (e) {
          executed.set(sig, `Tool error: ${(e as Error).message}`);
          messages.push({ role: 'tool', toolCallId: tc.id, name: tc.name, content: `Tool error: ${(e as Error).message}`, isError: true });
          yield { type: 'tool_result', id: tc.id, name: tc.name, error: (e as Error).message };
        }
      }

      // Stop spinning when every call this turn was a duplicate (same tool+input already ran).
      if (freshCalls === 0) break;

      const so = meter(total, model);
      if (opts.creditCeiling && so.credits >= opts.creditCeiling) {
        stopReason = 'credit_ceiling';
        break;
      }
    }

    // If the loop ended mid-research (tools ran but no final text-only turn), force synthesis.
    const ranTools = executed.size > 0;
    const lastText = [...messages].reverse().find((m) => m.role === 'assistant' && m.content)?.content || '';
    const needsSynthesis = ranTools && (!endedWithFinalText || lastText.trim().length < 400);
    if (needsSynthesis) {
      const syn = provider!.streamTurn({
        model,
        system: synthesisSystemPrompt(opts.clientTime),
        messages,
        tools: [],
        userId: opts.userId,
        planId: opts.planId,
        effort: opts.effort,
        maxOutputTokens: 8000,
      });
      let sr = await syn.next();
      while (!sr.done) {
        producedOutput = true;
        if (sr.value.type === 'text') yield { type: 'text', delta: sr.value.delta };
        else yield { type: 'thinking', delta: sr.value.delta };
        sr = await syn.next();
      }
      const synResult = sr.value;
      total.inputTokens += synResult.usage.inputTokens;
      total.outputTokens += synResult.usage.outputTokens;
      total.cacheReadTokens! += synResult.usage.cacheReadTokens || 0;
      stopReason = synResult.stopReason;
      endedWithFinalText = true;
    }

    return { ok: true, producedOutput, total, stopReason };
  } catch (e) {
    log.warn('ai chat attempt failed', { model: model.id, ...errFields(e) });
    return { ok: false, producedOutput, total, stopReason, errorMsg: (e as Error).message };
  }
}

const PROVIDER_HINTS: Record<string, string> = {
  anthropic: 'Set HDSEARCH_ANTHROPIC_KEY or add an "anthropic" provider key under Account → Provider Keys.',
  openai: 'Set HDSEARCH_OPENAI_KEY or add an "openai" provider key under Account → Provider Keys.',
  xai: 'Set HDSEARCH_XAI_KEY or add an "xai" provider key under Account → Provider Keys.',
  google: 'Set HDSEARCH_GOOGLE_AI_KEY or add a "google" provider key under Account → Provider Keys.',
  groq: 'Set HDSEARCH_GROQ_KEY or add a "groq" provider key under Account → Provider Keys.',
  mistral: 'Set HDSEARCH_MISTRAL_KEY or add a "mistral" provider key under Account → Provider Keys.',
  openrouter: 'Set HDSEARCH_OPENROUTER_KEY or add an "openrouter" provider key under Account → Provider Keys.',
  azure: 'Set HDSEARCH_AZURE_OPENAI_KEY or add an "azure_openai" provider key under Account → Provider Keys.',
  aws_bedrock: 'Set AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY, or add an "aws_access_key" provider key under Account → Provider Keys.',
};

function noProviderMessage(model: LlmModel): string {
  if (model.provider === 'ollama') {
    return `Ollama is not reachable at ${process.env.HDSEARCH_OLLAMA_URL || 'http://127.0.0.1:11434'}. Start Ollama (\`ollama serve\`) and pull a model, or pick a different model.`;
  }
  const hint = PROVIDER_HINTS[model.provider];
  if (hint) return `No ${model.provider} API key configured. ${hint} Or pick a local Ollama model — those need no key.`;
  return `No provider available for ${model.label}. Add the required key under Account → Provider Keys, or pick another model.`;
}
