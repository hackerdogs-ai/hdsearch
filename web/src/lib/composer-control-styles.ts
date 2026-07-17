/** Shared footer control styling for search + AI composers. */

export const COMPOSER_CHEVRON_BG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%236b7280'%3E%3Cpath fill-rule='evenodd' d='M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z'/%3E%3C/svg%3E")`;

/** Pill select / dropdown trigger — label + chevron. */
export const composerControlClass =
  'flex h-8 min-w-0 shrink-0 items-center rounded-full bg-ink-100 text-xs font-medium text-ink-600 outline-none hover:bg-ink-200 focus-visible:ring-2 focus-visible:ring-brand-400/40';

export const composerSelectClass = `${composerControlClass} cursor-pointer appearance-none bg-[length:0.65rem] bg-[right_0.55rem_center] bg-no-repeat pr-7`;
