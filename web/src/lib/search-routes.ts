/** Marketing / product overview (former site home). */
export const PRODUCT_HOME_PATH = '/home';

/** Canonical search experience URL (`/` with optional query). */
export function searchHref(params?: Record<string, string | undefined> | URLSearchParams): string {
  const sp = new URLSearchParams();
  if (params instanceof URLSearchParams) {
    params.forEach((v, k) => sp.append(k, v));
  } else if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') sp.set(k, v);
    }
  }
  const qs = sp.toString();
  return qs ? `/?${qs}` : '/';
}
