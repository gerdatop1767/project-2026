export interface EmphasisToken {
  type: 'text' | 'bold' | 'italic';
  value: string;
}

/**
 * Splits one line of already-non-math text (a `tokenizeMathText` text
 * token, never touching `$...$` spans — this runs strictly after that
 * split) on `**bold**`, `*italic*` and `_italic_` markdown — the only
 * emphasis the imported EGE content actually uses (e.g. Russian EGE
 * passages/conditions highlighting a word: "в тексте выделено
 * **СТАРЫЙ**"; ЕГЭ-2027 math notes like "_В ответ запишите …_").
 * `**` is checked before `*` so a bold span is never misread as two
 * italic markers. An underscore only opens/closes a span at a word
 * boundary, so `A_1` or `snake_case` stay plain text. No nesting, no
 * other markdown (links, lists) — deliberately minimal, matching
 * exactly what the content uses today; headings are handled per line
 * by `parseHeading`.
 */
export function parseEmphasis(line: string): readonly EmphasisToken[] {
  const tokens: EmphasisToken[] = [];
  const pattern =
    /\*\*([^*]+?)\*\*|\*([^*]+?)\*|(?<![\p{L}\p{N}_])_([^_\s](?:[^_]*[^_\s])?)_(?![\p{L}\p{N}_])/gu;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: line.slice(lastIndex, match.index) });
    }
    const [, bold, italic, underscored] = match;
    if (bold !== undefined) {
      tokens.push({ type: 'bold', value: bold });
    } else {
      tokens.push({ type: 'italic', value: (italic ?? underscored)! });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < line.length) {
    tokens.push({ type: 'text', value: line.slice(lastIndex) });
  }
  return tokens;
}

/**
 * A markdown heading line (`### а)`, `## Шаг 1`) → its text, else null.
 * Solutions use them to separate the parts of a multi-part answer; a
 * `#` must be followed by a space, so «#5» or «№#» stays plain text.
 */
export function parseHeading(line: string): string | null {
  const match = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
  return match ? match[1]! : null;
}

/**
 * Splits text into runs of lines, marking each whole line wrapped in
 * `_…_` that contains a `$…$` formula as italic (markers removed) — e.g.
 * «_В ответ запишите результат в виде $a:b$._». Such a line can't be
 * handled by `parseEmphasis`, which only ever sees the text between
 * formulas. Other lines are kept together, joined by their newlines.
 */
export function splitItalicMathLines(text: string): { text: string; italic: boolean }[] {
  const segments: { text: string; italic: boolean }[] = [];
  let plain: string[] = [];
  for (const line of text.split('\n')) {
    const match = /^_([^_\s](?:.*[^_\s])?)_\s*$/.exec(line);
    if (match && line.includes('$')) {
      if (plain.length) segments.push({ text: plain.join('\n'), italic: false });
      plain = [];
      segments.push({ text: match[1]!, italic: true });
    } else {
      plain.push(line);
    }
  }
  if (plain.length || segments.length === 0)
    segments.push({ text: plain.join('\n'), italic: false });
  return segments;
}
