/** First 50 chars of user text — matches Streamlit chat session naming. */
export function extractSessionNameFromContent(content: unknown): string {
  if (content == null) return 'Unnamed Session';

  let text = '';
  if (typeof content === 'object' && content !== null && !Array.isArray(content)) {
    const o = content as Record<string, unknown>;
    text =
      (typeof o.content === 'string' ? o.content : '') ||
      (typeof o.user_prompt === 'string' ? o.user_prompt : '') ||
      String(content);
  } else if (typeof content === 'string') {
    text = content;
  } else {
    text = String(content);
  }

  if (!text.trim()) return 'Unnamed Session';
  const name = text.slice(0, 50).trim();
  return (name + (text.length > 50 ? '...' : '')).trim() || 'Unnamed Session';
}
