// AI Mode endpoints (spec §11). POST /v1/ai/chat streams a tool-augmented answer over
// SSE; GET /v1/ai/models lists models + per-provider availability. Model is auto-selected
// by the OR optimizer (cost/latency/failure) unless the caller pins one. Providers:
// Anthropic (key) and Ollama (local, keyless) today; others slot in by provider id.
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { requireAuth, requireScope } from '../auth.js';
import { listModelsForPlan, getModel, defaultModelForPlan, refreshDynamicModels, refreshFromDb, getProviderMeta } from '../ai/models.js';
import { runAiChat } from '../ai/orchestrator.js';
import { getProvider } from '../ai/providers/index.js';
import type { LlmModel } from '../ai/models.js';
import { getProviderPrefs } from '../provider-prefs.js';
import { log, errFields } from '../logger.js';
import { chargeUserCredits } from '../charge-credits.js';
import { isDemoUser } from '../auth.js';
import { recordHistory } from '../history.js';
import {
  isFirstTurn,
  loadAiThread,
  saveAiThread,
  type AiContentPart,
  type AiMessageRecord,
  type AiThreadBlob,
} from '../ai-threads.js';
import { randomUUID } from 'node:crypto';
import { retrieveFileContext, analyzeThreadMedia, buildMediaLimitationNote } from '../files/retrieve.js';
import { threadHasReadyFiles } from '../files/db.js';

export const aiRoutes = new Hono();

aiRoutes.use('*', requireAuth());

const ChatBody = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1) })).min(1),
  modelOverride: z.string().min(1),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  sourceDetails: z.enum(['low', 'medium', 'high']).optional(),
  threadId: z.string().min(1).max(128).optional(),
  temporary: z.boolean().optional(),
  title: z.string().min(1).max(200).optional(),
  // RAG: file attachments to ground this turn on. Optional — when absent but the
  // thread has processed files, retrieval still runs over all of them.
  fileIds: z.array(z.string().min(1).max(64)).max(50).optional(),
  clientTime: z
    .object({
      utcIso: z.string().min(1).max(64),
      utcFormatted: z.string().min(1).max(128),
      localFormatted: z.string().min(1).max(128),
      timeZone: z.string().min(1).max(64),
    })
    .optional(),
});

/** Availability per model = its provider can serve it (key present / endpoint reachable). */
async function availabilityMap(models: LlmModel[], userId?: string, planId?: string): Promise<Map<string, boolean>> {
  const byProvider = new Map<string, Promise<boolean>>();
  const out = new Map<string, boolean>();
  await Promise.all(
    models.map(async (m) => {
      const provider = getProvider(m.provider);
      if (!provider) {
        out.set(m.id, false);
        return;
      }
      const pk = `${m.provider}::${planId || ''}`;
      if (!byProvider.has(pk)) byProvider.set(pk, provider.available(m, userId, planId).catch(() => false));
      out.set(m.id, await byProvider.get(pk)!);
    }),
  );
  return out;
}

aiRoutes.get('/models', requireScope('search:read'), async (c) => {
  const p = c.get('principal');
  await Promise.all([refreshFromDb(), refreshDynamicModels()]);
  const prefs = await getProviderPrefs(p.userId);
  const catalog = c.req.query('catalog') === '1' || c.req.query('catalog') === 'true';
  const allModels = listModelsForPlan(p.plan);
  const models = catalog ? allModels : allModels.filter((m) => !prefs.disabled.includes(m.id));
  const avail = await availabilityMap(allModels, p.userId, p.plan);
  const def = defaultModelForPlan(p.plan);
  const providerNames = new Map(getProviderMeta().map((prov) => [prov.id, prov.name]));
  return c.json({
    default: def.id,
    plan: p.plan,
    models: models.map((m) => ({
      id: m.id,
      provider: m.provider,
      providerLabel: providerNames.get(m.provider) || m.provider,
      label: m.label,
      contextTokens: m.contextTokens,
      maxOutputTokens: m.maxOutputTokens,
      inputPer1M: m.inputPer1M,
      outputPer1M: m.outputPer1M,
      capabilities: m.capabilities,
      accessType: m.accessType,
      requiresKeys: m.requiresKeys,
      available: avail.get(m.id) ?? false,
      defaultRank: m.defaultRank,
    })),
  });
});

// GET /v1/ai/providers — LLM providers that require user keys (for Account → Provider Keys UI)
aiRoutes.get('/providers', requireScope('search:read'), async (c) => {
  await refreshFromDb();
  const providers = getProviderMeta()
    .filter((p) => p.keyFields.length > 0 && !p.dynamic)
    .map((p) => ({
      id: p.id,
      label: p.name,
      requiresKeys: p.keyFields,
      accessType: p.accessType,
      docsUrl: p.docsUrl,
    }));
  return c.json({ count: providers.length, providers });
});

aiRoutes.post('/chat', requireScope('search:read'), async (c) => {
  const p = c.get('principal');
  const parsed = ChatBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);
  const body = parsed.data;

  await refreshDynamicModels();
  const chatPrefs = await getProviderPrefs(p.userId);
  const models = listModelsForPlan(p.plan).filter((m) => !chatPrefs.disabled.includes(m.id));
  const avail = await availabilityMap(models, p.userId, p.plan);

  const model = getModel(body.modelOverride);
  if (!model) {
    return c.json({ error: 'bad_request', message: `unknown model: ${body.modelOverride}` }, 400);
  }
  // Open-source: no plan-based model gating — models are limited only by whether
  // an API key / provider is actually available (checked below).
  if (!(avail.get(model.id) ?? false)) {
    return c.json(
      {
        error: 'model_unavailable',
        message: `${model.label} is not available (missing API key or provider unreachable). Add keys under Account → Provider Keys, or pick another model.`,
        model: model.id,
        provider: model.provider,
      },
      400,
    );
  }
  const reason = 'pinned by user';
  const fallbacks: LlmModel[] = [];

  log.info('ai chat', { user: p.userId, model: model.id, provider: model.provider, plan: p.plan, reason });

  const userPrompt = body.messages.filter((m) => m.role === 'user').pop()?.content || '';
  const temporary = !!body.temporary;
  const persistable = !isDemoUser(p.userId) && !temporary;

  // Stable threadId across turns: client passes one; if missing, mint one so the
  // client can bind future turns to the same conversation.
  const threadId = body.threadId?.trim() || randomUUID();

  // First turn = the (user, thread) pair has no zset entry yet. `recordHistory` fires
  // once per thread (not per turn) to keep the recents list from filling with duplicates.
  const firstTurn = persistable ? await isFirstTurn(p.userId, threadId) : false;
  if (persistable && firstTurn && userPrompt) {
    void recordHistory(p.userId, {
      q: userPrompt.slice(0, 500),
      modality: 'ai',
      ts: Date.now(),
      source: 'ai',
      model: model!.id,
    });
  }

  return streamSSE(c, async (stream) => {
    // Assistant-turn accumulator — mirrors the parts emitted by the orchestrator so the
    // saved blob matches what the client rendered. Tool calls index by id so tool_result
    // can update the same part in place.
    const assistantParts: AiContentPart[] = [];
    const toolIndex = new Map<string, { type: 'tool-call'; toolCallId: string; toolName: string; args: unknown; result?: unknown; isError?: boolean }>();
    let textPart: { type: 'text'; text: string } | null = null;
    let reasoningPart: { type: 'reasoning'; text: string } | null = null;
    let assistantCredits = 0;

    try {
      // RAG grounding: if this thread has processed files (or the client named
      // some), retrieve relevant chunks and inject them into the model turn WITHOUT
      // mutating the transcript we persist. Best-effort — never blocks/fails the chat.
      let chatMessages = body.messages;
      if (!isDemoUser(p.userId) && userPrompt) {
        const wantRag = (body.fileIds && body.fileIds.length > 0) || (await threadHasReadyFiles(p.userId, threadId).catch(() => false));
        if (wantRag) {
          const rag = await retrieveFileContext(p.userId, threadId, userPrompt, body.fileIds);
          if (rag) {
            await stream.writeSSE({ event: 'file_context', data: JSON.stringify({ citations: rag.citations }) });
            // Prepend the grounded context to the latest user message (provider-agnostic).
            const msgs = body.messages.map((m) => ({ ...m }));
            for (let i = msgs.length - 1; i >= 0; i--) {
              if (msgs[i]!.role === 'user') {
                msgs[i] = { ...msgs[i]!, content: `${rag.context}\n\n---\n\nUser question:\n${msgs[i]!.content}` };
                break;
              }
            }
            chatMessages = msgs;
          }
        }
      }

      // Media handling: attach images the model can SEE (vision), and for any media it
      // can't process (images on a non-vision model, or any audio/video), surface a
      // professional notice + a note so the model explains the limitation in its own voice.
      if (!isDemoUser(p.userId)) {
        const media = await analyzeThreadMedia(p.userId, threadId, body.fileIds, { vision: !!model.capabilities?.vision });
        if (media.images.length || media.unsupported.length) {
          const msgs = chatMessages.map((m) => ({ ...m }));
          const lastUser = (() => {
            for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i]!.role === 'user') return i;
            return -1;
          })();
          if (media.images.length && lastUser >= 0) {
            (msgs[lastUser] as { images?: unknown }).images = media.images;
          }
          if (media.unsupported.length) {
            // Deterministic professional notice for the UI…
            await stream.writeSSE({
              event: 'attachment_notice',
              data: JSON.stringify({ unsupported: media.unsupported, model: model.label }),
            });
            // …and a note so the model's own reply is coherent, not a confused "I see no image".
            if (lastUser >= 0) {
              msgs[lastUser] = { ...msgs[lastUser]!, content: msgs[lastUser]!.content + buildMediaLimitationNote(media.unsupported, model.label) };
            }
          }
          chatMessages = msgs;
        }
      }

      for await (const ev of runAiChat({
        model: model!,
        fallbacks,
        strictModel: true,
        messages: chatMessages,
        userId: p.userId,
        planId: p.plan,
        effort: body.effort ?? 'high',
        sourceDetails: body.sourceDetails ?? 'low',
        reason,
        clientTime: body.clientTime,
      })) {
        // Fan out to the client first — persistence must never delay the stream.
        if (ev.type === 'done') {
          const enriched = { ...ev, threadId, temporary } as typeof ev & { threadId: string; temporary: boolean };
          await stream.writeSSE({ event: 'done', data: JSON.stringify(enriched) });
        } else {
          await stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) });
        }

        // Accumulate the assistant turn for the saved blob.
        if (ev.type === 'text') {
          if (!textPart) { textPart = { type: 'text', text: '' }; assistantParts.push(textPart); }
          textPart.text += ev.delta;
        } else if (ev.type === 'thinking') {
          if (!reasoningPart) { reasoningPart = { type: 'reasoning', text: '' }; assistantParts.push(reasoningPart); }
          reasoningPart.text += ev.delta;
        } else if (ev.type === 'tool_call') {
          const part: AiContentPart = { type: 'tool-call', toolCallId: ev.id, toolName: ev.name, args: ev.input };
          toolIndex.set(ev.id, part as never);
          assistantParts.push(part);
        } else if (ev.type === 'tool_result') {
          const part = toolIndex.get(ev.id);
          if (part) {
            part.result = { ui: ev.ui, citations: ev.citations, error: ev.error };
            if (ev.error) part.isError = true;
          }
        } else if (ev.type === 'usage') {
          assistantCredits = ev.credits;
        } else if (ev.type === 'done') {
          chargeUserCredits(p, {
            sessionId: `hds:ai:${p.userId}`,
            taskId: `ai:${model!.id}:${Date.now()}`,
            credits: ev.credits,
            costUsd: ev.credits / 100,
            minimum: 1,
          });
        }
      }

      // Persist after the stream drains. Best-effort — a failed save never affects
      // the client that already saw its `done` event. Explicit .catch() defends
      // against future refactors that raise before the inner helpers catch.
      if (persistable) {
        persistTurn({
          userId: p.userId,
          threadId,
          firstTurn,
          title: body.title,
          modelId: model!.id,
          inputMessages: body.messages,
          assistantParts,
          assistantCredits,
        }).catch((e) => log.warn('ai thread persist failed', errFields(e)));
      }
    } catch (e) {
      log.error('ai stream failed', errFields(e));
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ type: 'error', message: (e as Error).message, retriable: true }) });
    }
  });
});

interface PersistTurnArgs {
  userId: string;
  threadId: string;
  firstTurn: boolean;
  title?: string;
  modelId: string;
  inputMessages: { role: 'user' | 'assistant'; content: string }[];
  assistantParts: AiContentPart[];
  assistantCredits: number;
}

// Merge the new turn onto the existing (or fresh) blob and save. The client sends
// the full transcript-so-far each turn, so we rebuild the message list from that
// plus the accumulated assistant parts. That keeps user-side edits (e.g. resends)
// authoritative without a diff protocol.
async function persistTurn(a: PersistTurnArgs): Promise<void> {
  const now = Date.now();
  const existing = a.firstTurn ? null : await loadAiThread(a.userId, a.threadId);

  const messages: AiMessageRecord[] = a.inputMessages.map((m, i) => ({
    id: `u-${a.threadId}-${i}`,
    role: m.role,
    content: [{ type: 'text', text: m.content }],
    createdAt: existing?.messages[i]?.createdAt ?? now,
  }));
  messages.push({
    id: `a-${a.threadId}-${a.inputMessages.length}`,
    role: 'assistant',
    content: a.assistantParts,
    createdAt: now,
    credits: a.assistantCredits,
    model: a.modelId,
  });

  const title = (existing?.title || a.title || firstUserSnippet(a.inputMessages)).slice(0, 200);
  const blob: AiThreadBlob = {
    threadId: a.threadId,
    userId: a.userId,
    title,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    messages,
    temporary: false,
  };
  await saveAiThread(blob);
}

function firstUserSnippet(msgs: { role: string; content: string }[]): string {
  const first = msgs.find((m) => m.role === 'user')?.content?.trim() || 'New chat';
  return first.replace(/\s+/g, ' ').slice(0, 80);
}
