/**
 * Answers only (never conditions or solutions): a long answer such as
 * `$a\in(-\infty;-3)\cup(-3;-1)\cup(1;3)$` is one KaTeX formula, and a
 * formula never breaks (global.css `.katex { white-space: nowrap }`), so on
 * a phone it can only be scrolled. Here such a formula is cut — at the
 * top level only, never inside brackets, braces, `\left…\right` or a
 * fraction — before each `\cup` and after each `,`/`;` that separates
 * items, into several formulas with a space between them: each piece stays
 * whole, and the line may wrap between pieces. Same symbols, same order;
 * only where a line may break changes.
 */
const OPEN = new Set(['(', '[', '{']);
const CLOSE = new Set([')', ']', '}']);

export function splitFormulaAtTopLevel(tex: string): string[] {
  const pieces: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  const cut = (at: number) => {
    const piece = tex.slice(start, at).trim();
    if (piece) pieces.push(piece);
    start = at;
  };
  while (i < tex.length) {
    const ch = tex[i]!;
    if (ch === '\\') {
      const word = /^\\[a-zA-Z]+/.exec(tex.slice(i))?.[0];
      if (word === '\\left' || word === '\\right') {
        depth = Math.max(0, depth + (word === '\\left' ? 1 : -1));
        i += word.length;
        // The delimiter after \left / \right: ( ] . \{ \langle …
        const delim = /^\s*(\\[a-zA-Z]+|\\.|.)/.exec(tex.slice(i));
        i += delim ? delim[0].length : 0;
        continue;
      }
      if (word === '\\cup' && depth === 0 && i > start) {
        cut(i);
        i += word.length;
        continue;
      }
      // \, \; \{ … is an escaped symbol (never a bracket); \name is a command.
      i += word ? word.length : 2;
      continue;
    }
    if (OPEN.has(ch)) depth++;
    else if (CLOSE.has(ch)) depth = Math.max(0, depth - 1);
    else if ((ch === ',' || ch === ';') && depth === 0) {
      // The separator stays with the left piece. The spacing command after
      // it (\  \, \; \quad) is dropped: the space between the two
      // formulas takes its place (and a lone trailing «\» would not parse).
      cut(i + 1);
      const spacing = /^(\s|\\[ ,;:!]|\\quad|\\qquad)+/.exec(tex.slice(i + 1));
      i += 1 + (spacing ? spacing[0].length : 0);
      start = i;
      continue;
    }
    i++;
  }
  cut(tex.length);
  return pieces.length > 0 ? pieces : [tex];
}

/** Rewrites every inline `$…$` of an answer into wrap-friendly pieces. */
export function wrapAnswerMath(text: string): string {
  if (text.includes('$$')) return text;
  return text.replace(/\$([^$]+?)\$/g, (whole, tex: string) => {
    const pieces = splitFormulaAtTopLevel(tex);
    if (pieces.length === 1) return whole;
    // A piece that starts with \cup gets an empty group before it, so
    // KaTeX keeps it a binary operator with its normal spacing.
    return pieces.map((p) => `$${p.startsWith('\\cup') ? `{}${p}` : p}$`).join(' ');
  });
}
