/** Client-reported clock context (browser → API on each chat turn). */
export interface ClientTimeContext {
  /** ISO-8601 instant in UTC, e.g. `2026-06-30T14:22:01.123Z`. */
  utcIso: string;
  /** Human-readable UTC datetime for the model. */
  utcFormatted: string;
  /** Human-readable datetime in the user's locale/timezone. */
  localFormatted: string;
  /** IANA timezone, e.g. `America/Los_Angeles`. */
  timeZone: string;
}

export function buildTimeContextBlock(clientTime?: ClientTimeContext): string {
  if (clientTime?.utcIso && clientTime.timeZone) {
    const utcLine = clientTime.utcFormatted
      ? `${clientTime.utcFormatted} (${clientTime.utcIso})`
      : clientTime.utcIso;
    const localLine = clientTime.localFormatted || clientTime.utcIso;
    return `\n\n## CURRENT DATE AND TIME
- UTC: ${utcLine}
- User local (${clientTime.timeZone}): ${localLine}
Use these when interpreting "today", "now", deadlines, or time-sensitive questions.`;
  }

  const now = new Date();
  return `\n\n## CURRENT DATE AND TIME
- UTC: ${now.toISOString()} (server clock; user timezone not provided)
Use UTC when interpreting "today", "now", or time-sensitive questions.`;
}
