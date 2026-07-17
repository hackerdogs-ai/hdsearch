/** Payload our API attaches to tool-call results for tool-UI rendering. */
export type HdsToolResult = {
  ui?: { kind: string; data: unknown };
  citations?: { title: string; url: string }[];
  error?: string;
};

export type ModelInfo = {
  id: string;
  label: string;
  provider: string;
  providerLabel?: string;
  available: boolean;
  accessType: string;
  requiresKeys?: string[];
  inputPer1M: number;
  outputPer1M: number;
  capabilities?: { tools?: boolean; vision?: boolean; audio?: boolean; video?: boolean };
};

export type GroupedModels = [string, ModelInfo[]][];
