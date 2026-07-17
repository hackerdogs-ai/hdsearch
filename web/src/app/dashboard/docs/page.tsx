import { DocsContent } from '@/components/content/docs-content';

export const dynamic = 'force-dynamic';

export default function DocsPage() {
  return <DocsContent apiHref="/dashboard/api-reference" />;
}
