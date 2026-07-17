export function SearchComposerDisclaimer({ className = '' }: { className?: string }) {
  return (
    <p className={`text-center text-sm leading-5 text-ink-400 ${className}`.trim()}>
      Results are fetched live from third-party providers. Coverage varies by source.
    </p>
  );
}
