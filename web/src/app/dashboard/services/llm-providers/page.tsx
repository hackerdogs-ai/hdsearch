import { LlmProvidersManager } from '@/components/llm-providers-manager';

export const dynamic = 'force-dynamic';

export default function LlmProvidersPage() {
  return (
    <div className="space-y-6">
      <LlmProvidersManager />
    </div>
  );
}
