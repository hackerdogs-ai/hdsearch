'use client';

/**
 * Tool renderers for assistant-ui MessagePrimitive.Parts (tools.by_name + Fallback).
 * Avoids Tools({ toolkit }) + useAui() — that path caused infinite store update loops here.
 */
import type { ToolCallMessagePartComponent } from '@assistant-ui/core/react';
import { HdToolCallRenderer } from './tool-card-view';
import type { HdsToolResult } from './types';

const BUILTIN_TOOL_NAMES = [
  'hd_search',
  'hd_crawl',
  'hd_archive',
  'hd_maps',
  'hd_plot_map',
  'hd_chart',
  'hd_weather',
  'hd_render',
] as const;

export const RenderHdTool: ToolCallMessagePartComponent<Record<string, unknown>, HdsToolResult> = (
  props,
) => (
  <HdToolCallRenderer
    toolName={props.toolName}
    args={(props.args ?? {}) as Record<string, unknown>}
    result={props.result as HdsToolResult | undefined}
    status={props.status}
    isError={props.isError}
  />
);

/** Stable by-name map for built-in hd-search tools. */
export const HD_SEARCH_TOOL_BY_NAME: Record<string, ToolCallMessagePartComponent> = Object.fromEntries(
  BUILTIN_TOOL_NAMES.map((name) => [name, RenderHdTool]),
);
