/** Snapshot of the user's clock from the browser (sent with every AI chat request). */
export interface ClientDatetimeContext {
  utcIso: string;
  utcFormatted: string;
  localFormatted: string;
  timeZone: string;
}

/** Read current UTC + local time using the browser's timezone and locale. */
export function getClientDatetimeContext(now = new Date()): ClientDatetimeContext {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const utcIso = now.toISOString();
  const utcFormatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    dateStyle: 'full',
    timeStyle: 'long',
  }).format(now);
  const localFormatted = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'full',
    timeStyle: 'long',
    timeZone,
  }).format(now);
  return { utcIso, utcFormatted, localFormatted, timeZone };
}
