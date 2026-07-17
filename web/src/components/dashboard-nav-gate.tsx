import { DashboardNav } from '@/components/dashboard-nav';
import { loadDashboardAccount } from '@/lib/dashboard-account';

/** Sidebar role — shares the same cached account fetch as the header. */
export async function DashboardNavGate() {
  const { role } = await loadDashboardAccount();
  return <DashboardNav role={role} />;
}

export function DashboardNavFallback() {
  return <DashboardNav role="user" />;
}
