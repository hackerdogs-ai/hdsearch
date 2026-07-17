export function AiComposerDisclaimer({ className = '' }: { className?: string }) {
  return (
    <p className={`text-center text-sm leading-5 text-ink-400 ${className}`.trim()}>
      hdsearch can make mistakes. Verify important information and citations.
    </p>
  );
}
