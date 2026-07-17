import { redirect } from 'next/navigation';
import type { SearchPageParams } from '@/components/search-page';
import { searchHref } from '@/lib/search-routes';

/** Legacy `/search` URLs → canonical `/`. */
export default function SearchRedirect({ searchParams }: { searchParams: SearchPageParams }) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (v == null || v === '') continue;
    if (Array.isArray(v)) v.forEach((item) => sp.append(k, item));
    else sp.set(k, v);
  }
  redirect(searchHref(sp));
}
