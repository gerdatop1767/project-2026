import { Fragment, memo, useMemo, type ReactNode } from 'react';
import { clsx } from '../../lib/clsx.js';
import styles from './TheoryMarkdown.module.css';

/**
 * Renders the theory archives' Markdown subset (headings, paragraphs,
 * lists, check lists, tables, a quote; **bold**, *italic*, `code`) as
 * React elements — never as HTML, so a stray `<` in a file stays text.
 * Sections under a «Ловушки»/«Исключения»-like heading are tinted, and
 * algorithm sections get their own card, so long rules stay readable.
 */

type Inline = string;

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; text: Inline }
  | { type: 'paragraph'; lines: Inline[] }
  | { type: 'quote'; lines: Inline[] }
  | { type: 'list'; ordered: boolean; start: number; items: { text: Inline; checkbox: boolean }[] }
  | { type: 'table'; head: Inline[]; rows: Inline[][] };

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === '') {
      i++;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1]!.length as 1 | 2 | 3,
        text: heading[2]!,
      });
      i++;
      continue;
    }
    if (trimmed.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        const row = cells(lines[i]!);
        if (!row.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(row);
        i++;
      }
      blocks.push({ type: 'table', head: rows[0] ?? [], rows: rows.slice(1) });
      continue;
    }
    if (trimmed.startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('>')) {
        quote.push(lines[i]!.trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'quote', lines: quote });
      continue;
    }
    const bullet = /^[-*]\s+/;
    const numbered = /^(\d+)\.\s+/;
    if (bullet.test(trimmed) || numbered.test(trimmed)) {
      const ordered = numbered.test(trimmed);
      const start = ordered ? Number(numbered.exec(trimmed)![1]) : 1;
      const items: { text: string; checkbox: boolean }[] = [];
      while (i < lines.length) {
        const t = lines[i]!.trim();
        if (ordered ? !numbered.test(t) : !bullet.test(t)) break;
        let text = t.replace(ordered ? numbered : bullet, '');
        const checkbox = /^\[[ xX]\]\s+/.test(text);
        if (checkbox) text = text.replace(/^\[[ xX]\]\s+/, '');
        items.push({ text, checkbox });
        i++;
      }
      blocks.push({ type: 'list', ordered, start, items });
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length) {
      const t = lines[i]!.trim();
      if (t === '' || /^(#{1,3}\s|\||>|[-*]\s|\d+\.\s)/.test(t)) break;
      paragraph.push(t);
      i++;
    }
    blocks.push({ type: 'paragraph', lines: paragraph });
  }
  return blocks;
}

const STRESS_WORD = /([а-яё]+[АЕЁИОУЫЭЮЯ][а-яё]*)/g;

/** «тОрты» → т<span>О</span>рты: the stressed vowel the archive writes in
 * capitals, highlighted. The text itself is untouched. */
function withStress(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(STRESS_WORD)) {
    const word = match[0];
    const at = match.index;
    out.push(text.slice(last, at));
    const v = word.search(/[АЕЁИОУЫЭЮЯ]/);
    out.push(
      <span key={`${keyPrefix}-${at}`} className={styles.stressWord}>
        {word.slice(0, v)}
        <span className={styles.stress}>{word[v]}</span>
        {word.slice(v + 1)}
      </span>,
    );
    last = at + word.length;
  }
  out.push(text.slice(last));
  return out;
}

export function renderInline(text: string, stress = false, keyPrefix = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let n = 0;
  const plain = (s: string) => (stress ? withStress(s, `${keyPrefix}-${n++}`) : [s]);
  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    out.push(...plain(text.slice(last, match.index)));
    const key = `${keyPrefix}-${match.index}`;
    if (token.startsWith('**')) {
      out.push(<strong key={key}>{plain(token.slice(2, -2))}</strong>);
    } else if (token.startsWith('`')) {
      out.push(
        <span key={key} className={styles.example}>
          {plain(token.slice(1, -1))}
        </span>,
      );
    } else {
      out.push(<em key={key}>{plain(token.slice(1, -1))}</em>);
    }
    last = match.index + token.length;
  }
  out.push(...plain(text.slice(last)));
  return out;
}

const WARN = /ловушк|исключени|как ловят|не путай|важн|нюанс|ошибк/i;
const STEPS =
  /алгоритм|как решать|как исправлять|метод|как определить|как выбрать|как учить|чек-лист|перед сдачей|как заниматься/i;

type Section =
  { heading: Block & { type: 'heading' }; blocks: Block[] } | { heading: null; blocks: Block[] };

function sections(blocks: Block[]): Section[] {
  const out: Section[] = [{ heading: null, blocks: [] }];
  for (const block of blocks) {
    if (block.type === 'heading' && block.level <= 2) {
      out.push({ heading: block, blocks: [] });
    } else {
      out[out.length - 1]!.blocks.push(block);
    }
  }
  return out.filter((s) => s.heading || s.blocks.length > 0);
}

function BlockView({ block, stress, k }: { block: Block; stress: boolean; k: string }) {
  switch (block.type) {
    case 'heading':
      return <h4 className={styles.subheading}>{renderInline(block.text, stress, k)}</h4>;
    case 'paragraph':
      return (
        <p className={styles.paragraph}>
          {block.lines.map((line, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              {renderInline(line, stress, `${k}-${i}`)}
            </Fragment>
          ))}
        </p>
      );
    case 'quote':
      return (
        <div className={styles.quote}>
          {block.lines.map((line, i) => (
            <p key={i}>{renderInline(line, stress, `${k}-${i}`)}</p>
          ))}
        </div>
      );
    case 'list': {
      const checklist = block.items.every((item) => item.checkbox);
      const items = block.items.map((item, i) => (
        <li key={i} className={clsx(item.checkbox && styles.checkItem)}>
          {item.checkbox && <span className={styles.checkbox} aria-hidden="true" />}
          <span>{renderInline(item.text, stress, `${k}-${i}`)}</span>
        </li>
      ));
      return block.ordered ? (
        <ol className={styles.list} start={block.start}>
          {items}
        </ol>
      ) : (
        <ul className={clsx(styles.list, checklist && styles.checklist)}>{items}</ul>
      );
    }
    case 'table':
      return (
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Таблица">
          <table className={styles.table}>
            <thead>
              <tr>
                {block.head.map((c, i) => (
                  <th key={i} scope="col">
                    {renderInline(c, stress, `${k}-h${i}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((c, i) => (
                    <td key={i}>{renderInline(c, stress, `${k}-${r}-${i}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export interface TheoryMarkdownProps {
  source: string;
  /** Highlight stressed capital vowels (the orthoepy materials). */
  stress?: boolean;
  /** Drop the file's own `# title` (the screen already shows one). */
  skipTitle?: boolean;
  className?: string;
}

export const TheoryMarkdown = memo(function TheoryMarkdown({
  source,
  stress = false,
  skipTitle = true,
  className,
}: TheoryMarkdownProps) {
  const parsed = useMemo(() => {
    const blocks = parseMarkdown(source);
    if (skipTitle && blocks[0]?.type === 'heading' && blocks[0].level === 1) blocks.shift();
    return sections(blocks);
  }, [source, skipTitle]);

  return (
    <div className={clsx(styles.root, className)}>
      {parsed.map((section, s) => {
        const title = section.heading?.text ?? '';
        const tone = !section.heading
          ? undefined
          : WARN.test(title)
            ? 'warn'
            : STEPS.test(title)
              ? 'steps'
              : undefined;
        return (
          <section key={s} className={styles.section} data-tone={tone}>
            {section.heading &&
              (section.heading.level === 1 ? (
                <h3 className={styles.title}>{renderInline(title, stress, `s${s}`)}</h3>
              ) : (
                <h3 className={styles.heading}>{renderInline(title, stress, `s${s}`)}</h3>
              ))}
            {section.blocks.map((block, b) => (
              <BlockView key={b} block={block} stress={stress} k={`s${s}b${b}`} />
            ))}
          </section>
        );
      })}
    </div>
  );
});
