export interface EmphasisToken {
  type: 'text' | 'bold' | 'italic';
  value: string;
}

/**
 * Splits one line of already-non-math text (a `tokenizeMathText` text
 * token, never touching `$...$` spans — this runs strictly after that
 * split) on `**bold**` and `*italic*` markdown — the only emphasis the
 * imported EGE content actually uses (e.g. Russian EGE passages/
 * conditions highlighting a word: "в тексте выделено **СТАРЫЙ**").
 * `**` is checked before `*` so a bold span is never misread as two
 * italic markers. No nesting, no other markdown (links, headings,
 * lists) — deliberately minimal, matching exactly what the content
 * uses today.
 */
export function parseEmphasis(line: string): readonly EmphasisToken[] {
  const tokens: EmphasisToken[] = [];
  const pattern = /\*\*([^*]+?)\*\*|\*([^*]+?)\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: line.slice(lastIndex, match.index) });
    }
    const [, bold, italic] = match;
    if (bold !== undefined) {
      tokens.push({ type: 'bold', value: bold });
    } else {
      tokens.push({ type: 'italic', value: italic! });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < line.length) {
    tokens.push({ type: 'text', value: line.slice(lastIndex) });
  }
  return tokens;
}
