'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FC, type PropsWithChildren } from 'react';
import {
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ActionBarPrimitive,
  AuiIf,
  useAssistantApi,
  useAuiState,
  type ToolCallMessagePartProps,
} from '@assistant-ui/react';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import remarkGfm from 'remark-gfm';
import { Sources, proxiedImg, type Source } from '../markdown';
import { llmProviderLabel } from '@/lib/llm-provider-labels';
import type { HdsToolResult } from './types';
import { useAiSearch, AUTO_SELECT_ENABLED } from './ai-search-context';
import { AiMessageErrorBanner } from './ai-message-error-banner';
import { AiComposerSettings } from './ai-composer-settings';
import { AiModelPicker } from './ai-model-picker';
import { HD_SEARCH_TOOL_BY_NAME, RenderHdTool } from './hd-search-toolkit';
import { AiAutoThreadTitle } from './ai-auto-thread-title';
import { AiComposerDisclaimer } from './ai-composer-disclaimer';
import { AiAttachButton, AiAttachmentTray, AiDictateButton } from './ai-file-attachments';
import { CenteredComposerShell } from '../centered-composer-shell';

const MARKDOWN_COMPONENTS = {
  p: ({ node, ...p }: { node?: unknown; children?: React.ReactNode }) => (
    <p className="my-2 text-base leading-6 text-ink-800 first:mt-0 last:mb-0" {...p} />
  ),
  h1: ({ node, ...p }: { node?: unknown; children?: React.ReactNode }) => (
    <h1 className="mb-2 mt-4 text-2xl font-semibold text-ink-900 first:mt-0" {...p} />
  ),
  h2: ({ node, ...p }: { node?: unknown; children?: React.ReactNode }) => (
    <h2 className="mb-2 mt-4 text-xl font-semibold text-ink-900 first:mt-0" {...p} />
  ),
  h3: ({ node, ...p }: { node?: unknown; children?: React.ReactNode }) => (
    <h3 className="mb-1.5 mt-3 text-lg font-semibold text-ink-900 first:mt-0" {...p} />
  ),
  a: ({ node, ...p }: { node?: unknown; href?: string; children?: React.ReactNode }) => (
    <a className="font-medium text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-800" target="_blank" rel="noreferrer" {...p} />
  ),
  ul: ({ node, ...p }: { node?: unknown; children?: React.ReactNode }) => (
    <ul className="my-2 list-disc space-y-1 pl-5 text-base leading-6 text-ink-800" {...p} />
  ),
  ol: ({ node, ...p }: { node?: unknown; children?: React.ReactNode }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5 text-base leading-6 text-ink-800" {...p} />
  ),
  li: ({ node, ...p }: { node?: unknown; children?: React.ReactNode }) => <li className="leading-6" {...p} />,
  img: ({ node, src, alt, ...p }: { node?: unknown; src?: string; alt?: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={proxiedImg(src)} alt={alt || ''} className="my-2 max-h-80 rounded-lg" referrerPolicy="no-referrer" loading="lazy" {...p} />
  ),
  table: ({ node, ...p }: { node?: unknown; children?: React.ReactNode }) => (
    <div className="my-2 overflow-x-auto rounded-lg border border-ink-200">
      <table className="w-full text-left text-base text-ink-800" {...p} />
    </div>
  ),
  thead: ({ node, ...p }: { node?: unknown; children?: React.ReactNode }) => (
    <thead className="border-b border-ink-200 bg-ink-50 text-sm uppercase text-ink-500" {...p} />
  ),
  th: ({ node, ...p }: { node?: unknown; children?: React.ReactNode }) => (
    <th className="px-3 py-2 font-medium" {...p} />
  ),
  td: ({ node, ...p }: { node?: unknown; children?: React.ReactNode }) => (
    <td className="border-t border-ink-100 px-3 py-2 align-top" {...p} />
  ),
};

/** Drop orphan markdown table pipe lines the model sometimes emits near tool cards. */
function stripStrayMarkdownPipes(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*\|\s*$/.test(line))
    .map((line) => {
      const singleCell = line.match(/^\s*\|\s*([^|]+?)\s*\|\s*$/);
      return singleCell ? singleCell[1]!.trim() : line;
    })
    .join('\n');
}

function MarkdownText() {
  const showCursor = useAuiState(
    (s) =>
      s.message.role === 'assistant' &&
      s.message.isLast &&
      s.message.status?.type === 'running' &&
      s.message.content.some((p) => p.type === 'text' && (p as { text?: string }).text?.trim()),
  );
  return (
    <div className="min-w-0">
      <MarkdownTextPrimitive
        className="aui-md"
        remarkPlugins={[remarkGfm]}
        preprocess={stripStrayMarkdownPipes}
        components={MARKDOWN_COMPONENTS}
      />
      {showCursor ? (
        <span
          className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[1px] animate-pulse bg-ink-800 align-baseline"
          aria-hidden
        />
      ) : null}
    </div>
  );
}

function PlainText({ text }: { text: string }) {
  return <span>{text}</span>;
}

function ToolFallback(props: ToolCallMessagePartProps<Record<string, unknown>, HdsToolResult>) {
  return <RenderHdTool {...props} />;
}

function HiddenTools() {
  return null;
}

function toolActivityLabel(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'hd_search':
      return `Searching the web for “${String(args.q ?? 'your query').slice(0, 80)}”…`;
    case 'hd_crawl':
      return `Reading ${hostLabel(String(args.url ?? ''))}…`;
    case 'hd_archive':
      return `Checking archive for ${hostLabel(String(args.url ?? ''))}…`;
    case 'hd_maps':
      return `Mapping “${String(args.q ?? args.query ?? 'places').slice(0, 60)}”…`;
    case 'hd_plot_map':
      return 'Plotting map…';
    case 'hd_chart':
      return 'Building chart…';
    case 'hd_weather':
      return `Checking weather for ${String(args.location ?? 'location').slice(0, 40)}…`;
    default:
      return `Running ${toolName.replace(/^hd_/, '').replace(/_/g, ' ')}…`;
  }
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || 'page';
  } catch {
    return 'page';
  }
}

/** ChatGPT-style inline status inside the assistant bubble (not in the scroll footer). */
function AssistantActivityLine() {
  const { showSteps } = useAiSearch();
  const line = useAuiState((s) => {
    if (s.message.role !== 'assistant' || !s.message.isLast) return null;
    if (s.message.status?.type !== 'running') return null;

    const hasText = s.message.content.some(
      (p) => p.type === 'text' && Boolean((p as { text?: string }).text?.trim()),
    );
    if (hasText) return null;

    const tools = s.message.content.filter((p) => p.type === 'tool-call') as {
      toolName: string;
      args?: Record<string, unknown>;
      result?: unknown;
    }[];
    if (showSteps && tools.length) return null;

    const pending = tools.filter((t) => t.result === undefined);
    if (pending.length) {
      const active = pending[pending.length - 1]!;
      return toolActivityLabel(active.toolName, active.args ?? {});
    }

    const reasoning = s.message.content.find((p) => p.type === 'reasoning') as { text?: string } | undefined;
    if (reasoning?.text?.trim()) return 'Thinking…';

    return 'Working on your request…';
  });

  if (!line) return null;

  return (
    <div className="flex items-center gap-2 py-0.5 text-base text-ink-500" aria-live="polite">
      <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-ink-200 border-t-brand-500" />
      <span>{line}</span>
    </div>
  );
}

function ToolStepsSummary() {
  const visible = useAuiState((s) => {
    if (s.message.role !== 'assistant') return false;
    if (s.message.status?.type === 'running') return false;
    return s.message.content.some((p) => p.type === 'tool-call');
  });
  const toolCount = useAuiState((s) =>
    s.message.role === 'assistant'
      ? s.message.content.filter((p) => p.type === 'tool-call').length
      : 0,
  );
  const namesStr = useAuiState((s) =>
    s.message.role === 'assistant'
      ? [...new Set(s.message.content.filter((p) => p.type === 'tool-call').map((p) => (p as { toolName: string }).toolName))].join(', ')
      : '',
  );
  if (!visible || !toolCount) return null;
  return (
    <div className="mb-2 text-sm text-ink-400">
      Ran {toolCount} tool{toolCount > 1 ? 's' : ''} ({namesStr})
    </div>
  );
}

function CopyMessageButton() {
  const isCopied = useAuiState((s) => s.message.isCopied);

  return (
    <ActionBarPrimitive.Copy
      copiedDuration={1500}
      title={isCopied ? 'Copied' : 'Copy'}
      aria-label={isCopied ? 'Copied to clipboard' : 'Copy response'}
      className="flex h-8 min-w-8 items-center justify-center rounded-lg text-ink-500 transition hover:bg-ink-100 hover:text-ink-700 disabled:cursor-not-allowed disabled:opacity-40 data-[copied=true]:bg-brand-50 data-[copied=true]:px-2.5 data-[copied=true]:text-brand-700"
    >
      <span
        className={`material-symbols-outlined text-[1.25rem] leading-none ${isCopied ? 'hidden' : ''}`}
        aria-hidden={isCopied}
      >
        content_copy
      </span>
      <span className={`text-xs font-medium leading-none ${isCopied ? '' : 'hidden'}`} aria-live="polite">
        Copied
      </span>
    </ActionBarPrimitive.Copy>
  );
}

function AssistantFooterRow() {
  const citationsJson = useAuiState((s) => {
    if (s.message.role !== 'assistant') return '';
    const out: Source[] = [];
    for (const p of s.message.content) {
      if (p.type !== 'tool-call') continue;
      const r = (p as { result?: HdsToolResult }).result;
      if (r?.citations) out.push(...r.citations);
    }
    return out.length ? JSON.stringify(out) : '';
  });
  const citations = useMemo<Source[]>(() => (citationsJson ? JSON.parse(citationsJson) : []), [citationsJson]);

  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <ActionBarPrimitive.Root hideWhenRunning autohide="not-last" className="flex items-center">
        <CopyMessageButton />
      </ActionBarPrimitive.Root>
      {citations.length > 0 ? <Sources sources={citations} className="mt-0" /> : null}
    </div>
  );
}

function MessageMetaFooter() {
  const custom = useAuiState((s) =>
    s.message.role === 'assistant' ? (s.message.metadata?.custom as Record<string, unknown> | undefined) : undefined,
  );
  const { models } = useAiSearch();
  if (!custom?.model && custom?.credits == null) return null;
  const modelId = custom?.model != null ? String(custom.model) : '';
  const m = models.find((x) => x.id === modelId);
  const credits = custom?.credits;
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1 text-sm text-ink-400">
      {modelId && <span className="chip py-0.5">{m?.label || modelId}</span>}
      {custom?.provider != null && (
        <span className="chip bg-ink-100 py-0.5 text-ink-500">
          {llmProviderLabel(String(custom.provider), m?.providerLabel)}
        </span>
      )}
      {custom?.reason != null && custom.reason !== 'pinned by user' && <span>· {String(custom.reason)}</span>}
      {credits != null && (
        <span className="chip py-0.5 text-brand-700">
          {Number(credits) === 0 ? 'free (self-hosted)' : `${credits} credits`}
        </span>
      )}
    </div>
  );
}

function ReasoningPart({ text }: { text: string }) {
  return (
    <details className="mb-2 rounded-lg border border-ink-100 bg-ink-50 px-3 py-2 text-sm text-ink-600">
      <summary className="cursor-pointer font-medium">Thinking</summary>
      <pre className="mt-2 whitespace-pre-wrap font-sans">{text}</pre>
    </details>
  );
}

function ToolGroup({ children }: PropsWithChildren) {
  return <div className="flex flex-col gap-2">{children}</div>;
}

const PARTS_WITH_TOOLS = {
  Text: MarkdownText,
  Reasoning: ReasoningPart,
  ToolGroup,
  tools: { by_name: HD_SEARCH_TOOL_BY_NAME, Fallback: ToolFallback },
} as const;

const PARTS_NO_TOOLS = {
  Text: MarkdownText,
  Reasoning: ReasoningPart,
  tools: { Override: HiddenTools },
} as const;
const AiSearchMessage: FC = () => {
  const { showSteps } = useAiSearch();
  const partComponents = showSteps ? PARTS_WITH_TOOLS : PARTS_NO_TOOLS;

  return (
    <MessagePrimitive.Root className="group">
      <AiMessageErrorBanner />
      <AuiIf condition={(s) => s.message.role === 'user'}>
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-2xl bg-brand-600 px-4 py-2.5 text-base leading-6 text-white">
            <MessagePrimitive.Parts components={{ Text: PlainText }} />
          </div>
        </div>
      </AuiIf>

      <AuiIf condition={(s) => s.message.role === 'assistant'}>
        <div className="space-y-2">
          <AssistantActivityLine />
          {!showSteps && <ToolStepsSummary />}
          <MessagePrimitive.Parts components={partComponents as any} />
          <AssistantFooterRow />
          <MessageMetaFooter />
        </div>
      </AuiIf>
    </MessagePrimitive.Root>
  );
};

const SCROLL_EDGE_CLASS =
  'flex h-9 w-9 items-center justify-center rounded-full border border-ink-200 bg-white text-ink-600 shadow-md transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700';

function ThreadScrollToTop({ viewportEl }: { viewportEl: HTMLElement | null }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = viewportEl;
    if (!el) return;

    const update = () => {
      setShow(el.scrollTop > 1);
    };

    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [viewportEl]);

  const scrollToTop = useCallback(() => {
    viewportEl?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [viewportEl]);

  if (!show) return null;

  return (
    <button
      type="button"
      title="Scroll to top"
      aria-label="Scroll to top"
      onClick={scrollToTop}
      className={`pointer-events-auto absolute top-2 left-1/2 z-10 -translate-x-1/2 ${SCROLL_EDGE_CLASS}`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="block shrink-0"
      >
        <path d="M8 12.5V3.5" />
        <path d="M4.5 6.5 8 3.5 11.5 6.5" />
      </svg>
    </button>
  );
}

function ThreadScrollToBottom() {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <button
        type="button"
        title="Scroll to bottom"
        aria-label="Scroll to bottom"
        className={`absolute -top-11 left-1/2 z-10 -translate-x-1/2 ${SCROLL_EDGE_CLASS} disabled:pointer-events-none disabled:opacity-0`}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="block shrink-0"
        >
          <path d="M8 3.5v9" />
          <path d="M4.5 9.5 8 12.5 11.5 9.5" />
        </svg>
      </button>
    </ThreadPrimitive.ScrollToBottom>
  );
}

function AiSignInPrompt() {
  return (
    <div className="w-full rounded-2xl border border-brand-200 bg-brand-50/60 px-6 py-8 text-center shadow-sm ring-1 ring-brand-100">
      <p className="text-base text-ink-700">Sign in to use AI Search</p>
      <a href="/login" className="btn-primary mt-4 inline-flex text-sm">
        Sign in
      </a>
    </div>
  );
}

function AiSignInLanding() {
  return (
    <>
      <AiSignInPrompt />
      <AiComposerDisclaimer className="mt-3" />
    </>
  );
}

function AiSearchComposer({ className = '' }: { className?: string }) {
  const { groupedModels, modelOverride, setModelOverride, modelsReady } = useAiSearch();
  const isEmpty = useAuiState((s) => s.thread.messages.length === 0);

  return (
    <div className={className}>
      <ComposerPrimitive.Root className="rounded-2xl border border-ink-200 bg-white shadow-sm ring-1 ring-ink-100 focus-within:border-brand-400 focus-within:ring-brand-200">
      <AiAttachmentTray />
      {/* Input line: '+' attach at the start, dictate + send at the end (ChatGPT layout). */}
      <div className="flex items-end gap-1 px-2 py-1.5 sm:gap-1.5">
        <AiAttachButton className="mb-0.5" />
        <ComposerPrimitive.Input
          placeholder={isEmpty ? 'Ask anything' : 'Ask a follow-up…'}
          className="max-h-48 min-h-[40px] flex-1 resize-none bg-transparent px-1.5 py-2 text-base leading-6 outline-none"
        />
        <AiDictateButton className="mb-0.5" />
        <AuiIf condition={(s) => s.thread.isRunning}>
          <ComposerPrimitive.Cancel asChild>
            <button
              type="button"
              title="Stop generating"
              aria-label="Stop generating"
              className="relative mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center overflow-visible rounded-full bg-white text-brand-700 shadow-sm hover:bg-brand-50"
            >
              <span
                className="hd-progress-ring pointer-events-none absolute -inset-0.5 rounded-full border-2 border-brand-200 border-t-brand-500"
                aria-hidden
              />
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="relative z-10" aria-hidden>
                <rect x="3" y="3" width="10" height="10" rx="1" />
              </svg>
            </button>
          </ComposerPrimitive.Cancel>
        </AuiIf>
        <AuiIf condition={(s) => !s.thread.isRunning}>
          <ComposerPrimitive.Send asChild>
            <button
              type="submit"
              title="Send message"
              className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M8 12V4" />
                <path d="M4 7l4-4 4 4" />
              </svg>
            </button>
          </ComposerPrimitive.Send>
        </AuiIf>
      </div>
      {/* Controls row: model + settings, left-aligned under the input. */}
      <div className="flex items-center gap-3 border-t border-ink-100 px-2 py-2 sm:px-3">
        <AiModelPicker
          variant="composer"
          grouped={groupedModels}
          value={modelOverride}
          modelsReady={modelsReady}
          autoSelectEnabled={AUTO_SELECT_ENABLED}
          onChange={setModelOverride}
        />
        <AiComposerSettings />
      </div>
    </ComposerPrimitive.Root>
      <AiComposerDisclaimer className="mt-3" />
    </div>
  );
}

function AiThreadViewport({ initialQuery, centeredEmpty }: { initialQuery: string; centeredEmpty?: boolean }) {
  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null);
  const { signInRequiredForAi, signedIn } = useAiSearch();
  const isEmpty = useAuiState((s) => s.thread.messages.length === 0);
  const needsSignIn = signInRequiredForAi && !signedIn;
  /** Same centered landing for header AI tab, + New chat, and sign-in gate. */
  const showLanding = Boolean(centeredEmpty && (isEmpty || needsSignIn));

  return (
    <ThreadPrimitive.Viewport
      ref={setViewportEl}
      turnAnchor="top"
      scrollToBottomOnRunStart
      className="relative flex min-h-0 flex-1 flex-col overflow-y-auto scroll-smooth"
    >
      <ThreadScrollToTop viewportEl={viewportEl} />
      {showLanding ? (
        <CenteredComposerShell
          title={needsSignIn ? undefined : 'Ask Anything'}
          lift={needsSignIn ? 'signin' : 'default'}
        >
          {needsSignIn ? <AiSignInLanding /> : <AiSearchComposer />}
        </CenteredComposerShell>
      ) : (
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-1 pt-2">
          <div className="mb-4 flex flex-col gap-y-6 empty:hidden">
            <ThreadPrimitive.Messages components={{ Message: AiSearchMessage }} />
          </div>

          <ThreadPrimitive.ViewportFooter className="relative sticky bottom-0 z-10 mt-auto flex flex-col gap-2 overflow-visible border-t border-transparent bg-white pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
            <ThreadScrollToBottom />
            <AiSearchComposer />
          </ThreadPrimitive.ViewportFooter>
        </div>
      )}
    </ThreadPrimitive.Viewport>
  );
}

/** Auto-send initial query from search bar (once). Must run inside ThreadPrimitive.Root. */
function InitialQueryRunner({ initialQuery }: { initialQuery: string }) {
  const api = useAssistantApi();
  const { modelOverride, modelsReady, signInRequiredForAi, signedIn } = useAiSearch();
  const startedRef = useRef(false);

  useEffect(() => {
    if (signInRequiredForAi && !signedIn) return;
    if (!initialQuery.trim() || startedRef.current || !modelsReady || !modelOverride) return;
    startedRef.current = true;

    const query = initialQuery.trim();
    void (async () => {
      try {
        // A query arriving from the search bar / AI tab must open a fresh chat
        // rather than extend whatever conversation is currently active (the
        // runtime keeps the previously-viewed thread as main across navigation).
        if (api.thread().getState().messages.length > 0) {
          await api.threads().switchToNewThread();
        }
        api.thread().append(query);
      } catch {
        // Best-effort fallback: append to the current thread.
        api.thread().append(query);
      }
    })();
  }, [api, initialQuery, modelOverride, modelsReady, signInRequiredForAi, signedIn]);

  return null;
}

export function AiSearchThread({
  initialQuery = '',
  centeredEmpty = false,
}: {
  initialQuery?: string;
  centeredEmpty?: boolean;
}) {
  return (
    <ThreadPrimitive.Root className="flex min-h-0 min-w-0 flex-1 flex-col">
      <AiAutoThreadTitle />
      <InitialQueryRunner initialQuery={initialQuery} />
      <AiThreadViewport initialQuery={initialQuery} centeredEmpty={centeredEmpty} />
    </ThreadPrimitive.Root>
  );
}
