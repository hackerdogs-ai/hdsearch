// Instant feedback while dashboard RSC payload loads (account/history/etc. hit the API).
export default function DashboardLoading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-8 w-48 rounded bg-ink-100" />
      <div className="card h-40 rounded-xl bg-white" />
      <div className="card h-64 rounded-xl bg-white" />
    </div>
  );
}
