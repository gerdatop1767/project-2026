import { Fragment, useEffect, useMemo, useRef, useState, type Ref } from 'react';
import katex from 'katex';
import { tokenizeMathText } from './mathTokenizer.js';
import { parseEmphasis } from './emphasis.js';
import { clsx } from '../../lib/clsx.js';
import styles from './MathText.module.css';

/**
 * Renders EGE task content (condition/hint/explanation) as a mix of
 * plain text and real math typesetting — never one giant formula and
 * never plain text for a formula either. `$...$`/`$$...$$` spans go
 * through KaTeX (fractions, roots, powers, indices, ≤/≥/≠, systems,
 * intervals, trig/log/derivative notation, coordinates, ...); the rest
 * renders as ordinary text, with blank lines becoming separate
 * paragraphs (matches how the source content already uses them to
 * separate "Шаг 1. ...\n\nШаг 2. ...").
 */
export function MathText({ text, className }: { text: string; className?: string }) {
  const paragraphs = useMemo(() => text.split(/\n{2,}/), [text]);
  return (
    <>
      {paragraphs.map((paragraph, i) => (
        <p key={i} className={className}>
          <MathLine text={paragraph} />
        </p>
      ))}
    </>
  );
}

/**
 * Same math+text mixing as `MathText`, without the paragraph split or
 * wrapping `<p>` — for a single line of content that's already inside
 * its own block element (a step title, a per-part explanation already
 * wrapped in a `<p>`, ...), where nesting another `<p>` would be invalid.
 */
export function InlineMathText({ text }: { text: string }) {
  return <MathLine text={text} />;
}

function MathLine({ text }: { text: string }) {
  const tokens = useMemo(() => tokenizeMathText(text), [text]);
  return (
    <>
      {tokens.map((token, i) => {
        if (token.type === 'math') {
          return <KatexSpan key={i} tex={token.value} block={token.block ?? false} />;
        }
        const lines = token.value.split('\n');
        return (
          <Fragment key={i}>
            {lines.map((line, j) => (
              <Fragment key={j}>
                <EmphasisLine text={line} />
                {j < lines.length - 1 && <br />}
              </Fragment>
            ))}
          </Fragment>
        );
      })}
    </>
  );
}

/** Renders one plain-text line with `**bold**`/`*italic*` spans as real `<strong>`/`<em>` — see `parseEmphasis`'s doc comment. */
function EmphasisLine({ text }: { text: string }) {
  const tokens = useMemo(() => parseEmphasis(text), [text]);
  return (
    <>
      {tokens.map((token, i) => {
        if (token.type === 'bold') return <strong key={i}>{token.value}</strong>;
        if (token.type === 'italic') return <em key={i}>{token.value}</em>;
        return <Fragment key={i}>{token.value}</Fragment>;
      })}
    </>
  );
}

function KatexSpan({ tex, block }: { tex: string; block: boolean }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, {
        throwOnError: false,
        displayMode: block,
      });
    } catch {
      // Malformed LaTeX in stored content — fail visibly as plain text
      // rather than crashing the whole task screen.
      return null;
    }
  }, [tex, block]);

  // Tracks whether this formula is actually wider than its box, and
  // (once it is) which edge still has more to scroll to — drives the
  // fade cues below so a long formula on mobile never just looks
  // silently cut off (EGE Fidelity Final Polish, Block 2: #15's
  // horizontal scroll had no visible affordance).
  const scrollRef = useRef<HTMLElement>(null);
  const [overflow, setOverflow] = useState({ scrollable: false, atStart: true, atEnd: true });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function update() {
      if (!el) return;
      setOverflow({
        scrollable: el.scrollWidth > el.clientWidth + 1,
        atStart: el.scrollLeft <= 1,
        atEnd: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1,
      });
    }
    update();
    el.addEventListener('scroll', update, { passive: true });
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      resizeObserver.disconnect();
    };
  }, [html]);

  if (html === null) {
    return <>{tex}</>;
  }
  const Tag = block ? 'div' : 'span';
  return (
    <span
      className={clsx(styles.scrollWrap, block && styles.scrollWrapBlock)}
      data-scrollable={overflow.scrollable}
      data-at-start={overflow.atStart}
      data-at-end={overflow.atEnd}
    >
      <Tag
        ref={scrollRef as Ref<HTMLDivElement>}
        className={block ? styles.scrollBlock : styles.scrollInline}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </span>
  );
}
