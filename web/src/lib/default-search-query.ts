import { searchHref } from './search-routes';

/** Plain search page — no prefilled query. */
export function trySearchHref(): string {
  return searchHref();
}
