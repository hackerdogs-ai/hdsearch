// OpenAI-compatible API endpoints. Allows any OpenAI SDK client to call hd-search
// AI Mode with tool-augmented search. Maps OpenAI request/response format to/from
// the internal orchestrator.
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { requireAuth, requireScope } from '../auth.js';
import { listModelsForPlan, getModel, defaultModelForPlan, refreshDynamicModels, refreshFromDb } from '../ai/models.js';
import { AUTO_SELECT_ENABLED, selectModels, rankExplicit, type SelectContext } from '../ai/model-selector.js';
import { runAiChat } from '../ai/orchestrator.js';
import { getProvider } from '../ai/providers/index.js';
import { statsFor } from '../ai/health.js';
import { getProviderPrefs, userLlmRankOrder } from '../provider-prefs.js';
import type { LlmModel } from '../ai/models.js';
import { log, errFields } from '../logger.js';
import { chargeUserCredits } from '../charge-credits.js';

export const openaiRoutes = new Hono();

openaiRoutes.use('*', requireAuth());

const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

const ChatCompletionsBody = z.object({
  model: z.string().optional(),
  messages: z.array(MessageSchema).min(1),
  stream: z.boolean().default(false),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().min(1).optional(),
  max_completion_tokens: z.number().int().min(1).optional(),
});

function genId(): string {
  return `chatcmpl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function availabilityMap(models: LlmModel[], userId?: string, planId?: string): Promise<Map<string, boolean>> {
  const byProvider = new Map<string, Promise<boolean>>();
  const out = new Map<string, boolean>();
  await Promise.all(
    models.map(async (m) => {
      const provider = getProvider(m.provider);
      if (!provider) { out.set(m.id, false); return; }
      const pk = `${m.provider}::${planId || ''}`;
      if (!byProvider.has(pk)) byProvider.set(pk, provider.available(m, userId, planId).catch(() => false));
      out.set(m.id, await byProvider.get(pk)!);
    }),
  );
  return out;
}

// GET /v1/openai/models — OpenAI-compatible model listing
openaiRoutes.get('/models', requireScope('search:read'), async (c) => {
  const p = c.get('principal');
  await Promise.all([refreshFromDb(), refreshDynamicModels()]);
  const prefs = await getProviderPrefs(p.userId);
  const models = listModelsForPlan(p.plan).filter((m) => !prefs.disabled.includes(m.id));
  return c.json({
    object: 'list',
    data: models.map((m) => ({
      id: m.id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: m.provider,
    })),
  });
});

// POST /v1/openai/chat/completions — OpenAI-compatible chat completions
openaiRoutes.post('/chat/completions', requireScope('search:read'), async (c) => {
  const p = c.get('principal');
  const parsed = ChatCompletionsBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: { message: 'Invalid request', type: 'invalid_request_error', param: null, code: null } }, 400);
  }
  const body = parsed.data;

  await refreshDynamicModels();
  const prefs = await getProviderPrefs(p.userId);
  const models = listModelsForPlan(p.plan).filter((m) => !prefs.disabled.includes(m.id));
  const avail = await availabilityMap(models, p.userId, p.plan);

  // Resolve model — system messages become part of the prompt, user/assistant passed through
  let model = body.model ? getModel(body.model) : undefined;
  let fallbacks: LlmModel[] = [];
  if (!model) {
    const promptTokens = Math.ceil(body.messages.reduce((n, m) => n + m.content.length, 0) / 4) + 1200;
    const ctx: SelectContext = {
      promptTokens,
      estOutputTokens: 800,
      needs: { tools: true },
      hasKey: (m) => avail.get(m.id) ?? false,
      statsFor,
    };
    const savedRank = userLlmRankOrder(prefs);
    if (savedRank.length) {
      const ranked = rankExplicit(models, savedRank, ctx);
      model = ranked[0];
      fallbacks = ranked.slice(1);
    } else if (AUTO_SELECT_ENABLED) {
      const ranked = selectModels(models, ctx);
      model = ranked[0]?.model;
      fallbacks = ranked.slice(1).map((r) => r.model);
    } else {
      const byDefault = [...models].sort((a, b) => a.defaultRank - b.defaultRank);
      const ranked = rankExplicit(models, byDefault.map((m) => m.id), ctx);
      model = ranked[0];
      fallbacks = ranked.slice(1);
    }
  }
  if (!model) model = defaultModelForPlan(p.plan);
  if (!fallbacks.length) {
    fallbacks = models.filter((m) => m.id !== model!.id && (avail.get(m.id) ?? false)).sort((a, b) => a.defaultRank - b.defaultRank);
  }

  // Split system messages from conversation
  const chatMessages = body.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  if (!chatMessages.length) {
    return c.json({ error: { message: 'At least one user message is required', type: 'invalid_request_error', param: 'messages', code: null } }, 400);
  }

  const completionId = genId();
  const created = Math.floor(Date.now() / 1000);

  if (body.stream) {
    return streamSSE(c, async (stream) => {
      let finalText = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let finishReason = 'stop';
      let sentRole = false;

      try {
        for await (const ev of runAiChat({ model: model!, fallbacks, messages: chatMessages, userId: p.userId, planId: p.plan })) {
          if (ev.type === 'text') {
            finalText += ev.delta;
            const chunk: any = {
              id: completionId,
              object: 'chat.completion.chunk',
              created,
              model: model!.id,
              choices: [{
                index: 0,
                delta: sentRole ? { content: ev.delta } : { role: 'assistant', content: ev.delta },
                finish_reason: null,
              }],
            };
            sentRole = true;
            await stream.writeSSE({ data: JSON.stringify(chunk) });
          } else if (ev.type === 'usage') {
            inputTokens = ev.inputTokens;
            outputTokens = ev.outputTokens;
          } else if (ev.type === 'done') {
            finishReason = ev.stopReason === 'end_turn' ? 'stop' : ev.stopReason === 'tool_use' ? 'tool_calls' : ev.stopReason;
            const finalChunk = {
              id: completionId,
              object: 'chat.completion.chunk',
              created,
              model: model!.id,
              choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
              usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
            };
            await stream.writeSSE({ data: JSON.stringify(finalChunk) });
            await stream.writeSSE({ data: '[DONE]' });

            chargeUserCredits(p, {
              sessionId: `hds:openai:${p.userId}`,
              taskId: `openai:${model!.id}:${Date.now()}`,
              credits: ev.credits,
              costUsd: ev.credits / 100,
              minimum: 1,
            });
          } else if (ev.type === 'error') {
            const errChunk = {
              error: { message: ev.message, type: 'server_error', param: null, code: null },
            };
            await stream.writeSSE({ data: JSON.stringify(errChunk) });
            await stream.writeSSE({ data: '[DONE]' });
          }
        }
      } catch (e) {
        log.error('openai compat stream failed', errFields(e));
        await stream.writeSSE({ data: JSON.stringify({ error: { message: (e as Error).message, type: 'server_error' } }) });
        await stream.writeSSE({ data: '[DONE]' });
      }
    });
  }

  // Non-streaming response
  let finalText = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let finishReason = 'stop';

  try {
    for await (const ev of runAiChat({ model: model!, fallbacks, messages: chatMessages, userId: p.userId, planId: p.plan })) {
      if (ev.type === 'text') finalText += ev.delta;
      else if (ev.type === 'usage') {
        inputTokens = ev.inputTokens;
        outputTokens = ev.outputTokens;
      } else if (ev.type === 'done') {
        finishReason = ev.stopReason === 'end_turn' ? 'stop' : ev.stopReason;
        chargeUserCredits(p, {
          sessionId: `hds:openai:${p.userId}`,
          taskId: `openai:${model!.id}:${Date.now()}`,
          credits: ev.credits,
          costUsd: ev.credits / 100,
          minimum: 1,
        });
      }
    }
  } catch (e) {
    log.error('openai compat failed', errFields(e));
    return c.json({ error: { message: (e as Error).message, type: 'server_error', param: null, code: null } }, 500);
  }

  return c.json({
    id: completionId,
    object: 'chat.completion',
    created,
    model: model!.id,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: finalText },
      finish_reason: finishReason,
    }],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  });
});
