import { IntegrationsContent } from '@/components/content/integrations-content';

export const dynamic = 'force-dynamic';

export default function IntegrationsPage() {
  return <IntegrationsContent docsHref="/dashboard/docs" accountHref="/dashboard/account" />;
}
