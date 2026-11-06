import { useMemo } from 'react';
import { clsx } from '../../lib/clsx.js';
import { AnswerMathText, InlineMathText } from '../MathText/MathText.js';
import { bindPlainFormulas, parseSolution, type SolutionBlock } from './solutionBlocks.js';
import styles from './SolutionText.module.css';

/**
 * A written solution, laid out for reading (docs/testing/solutions-display-audit.md):
 * - each paragraph is its own block with clear spacing;
 * - «Шаг N.» blocks get the label as a small heading and a thin rail, so
 *   steps read as a sequence — not a card per line;
 * - «Что дано», «Идея», «ОДЗ», «Проверка»… get their label emphasised;
 * - «Ответ» is one highlighted block at the end;
 * - formulas: `$$…$$` stays a display block, an inline `$…$` stays whole
 *   (it scrolls in place if wider than the screen); a formula written in
 *   plain text never breaks in the middle (bindPlainFormulas).
 * The words, numbers and formulas are exactly the stored ones.
 */
export function SolutionText({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseSolution(text), [text]);
  return (
    <div className={clsx(styles.solution, className)}>
      {blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  );
}

function Block({ block }: { block: SolutionBlock }) {
  const body = useMemo(() => bindPlainFormulas(block.body), [block.body]);
  if (block.kind === 'answer') {
    return (
      <div className={styles.answer} data-block="answer">
        <span className={styles.answerLabel}>{block.label}</span>{' '}
        <span className={styles.answerBody}>
          <AnswerMathText text={body} />
        </span>
      </div>
    );
  }
  if (block.kind === 'step') {
    return (
      <div className={styles.step} data-block="step">
        <p className={styles.stepLabel}>{block.label}</p>
        <div className={styles.body}>
          <InlineMathText text={body} />
        </div>
      </div>
    );
  }
  if (block.label) {
    return (
      <div className={clsx(styles.labelled, styles[block.kind])} data-block={block.kind}>
        <span className={styles.label}>{block.label}</span> <InlineMathText text={body} />
      </div>
    );
  }
  return (
    <div className={styles.text} data-block="text">
      <InlineMathText text={body} />
    </div>
  );
}
