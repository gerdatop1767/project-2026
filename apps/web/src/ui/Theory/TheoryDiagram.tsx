import type { TheoryDiagramId } from '../../data/theory/russianTheory.js';
import { clsx } from '../../lib/clsx.js';
import styles from './TheoryDiagram.module.css';

/**
 * Small visual schemes for a rule. Every example is taken from the
 * archive's own materials (the file named next to each one) — nothing
 * is invented here; the text is real text, the colours only point.
 */
export function TheoryDiagram({ id }: { id: TheoryDiagramId }) {
  if (id === 'stress') return <StressDiagram />;
  if (id === 'junction') return <JunctionDiagram />;
  return <ParticipleDiagram />;
}

/** task-04-theory «Мини-пример» and its answer: 1, 3, 5 are right. */
const stressExamples: readonly { word: [string, string, string]; ok: boolean; fix?: string }[] = [
  { word: ['т', 'О', 'рты'], ok: true },
  { word: ['зв', 'О', 'нит'], ok: false, fix: 'звонИт' },
  { word: ['крас', 'И', 'вее'], ok: true },
  { word: ['свекл', 'А', ''], ok: false, fix: 'свЁкла' },
  { word: ['начал', 'А', ''], ok: true },
];

function StressDiagram() {
  return (
    <figure className={styles.figure}>
      <figcaption className={styles.caption}>
        Ударная гласная — заглавной буквой. Ответ к мини-примеру: <strong>135</strong>
      </figcaption>
      <ul className={styles.stressGrid}>
        {stressExamples.map(({ word: [a, v, b], ok, fix }, i) => (
          <li key={i} className={clsx(styles.stressCard, ok ? styles.ok : styles.bad)}>
            <span className={styles.stressNumber}>{i + 1}</span>
            <span className={styles.stressWord}>
              {a}
              <span className={styles.stressVowel}>{v}</span>
              {b}
            </span>
            <span className={styles.stressVerdict}>{ok ? 'верно' : `нужно: ${fix}`}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** task-19-practice №5 and №6: the comma at «что, когда» — and none at
 * «что если … то». */
function JunctionDiagram() {
  return (
    <figure className={styles.figure}>
      <figcaption className={styles.caption}>
        Стык союзов: решает вторая часть двойного союза
      </figcaption>
      <div className={styles.junction}>
        <p className={styles.sentence}>
          <span className={styles.part}>Я знал</span>
          <span className={styles.comma}>,</span> <span className={styles.conj}>что</span>
          <span className={clsx(styles.comma, styles.key)}>,</span>{' '}
          <span className={styles.clause}>когда наступит вечер</span>
          <span className={styles.comma}>,</span> <span className={styles.part}>мы уйдём.</span>
        </p>
        <p className={styles.note}>
          Придаточное «когда наступит вечер» можно убрать — запятая между «что» и «когда» нужна.
        </p>
        <p className={styles.sentence}>
          <span className={styles.part}>Я знал</span>
          <span className={styles.comma}>,</span> <span className={styles.conj}>что</span>
          <span className={styles.gap} aria-label="запятой нет">
            ∅
          </span>{' '}
          <span className={styles.clause}>если наступит вечер</span>
          <span className={styles.comma}>,</span> <span className={styles.conj}>то</span>{' '}
          <span className={styles.part}>мы уйдём.</span>
        </p>
        <p className={styles.note}>Дальше идёт «то» — на стыке «что если» запятой нет.</p>
      </div>
    </figure>
  );
}

/** task-17-theory «Причастный оборот». */
function ParticipleDiagram() {
  return (
    <figure className={styles.figure}>
      <figcaption className={styles.caption}>
        Причастный оборот: где стоит определяемое слово
      </figcaption>
      <div className={styles.participle}>
        <p className={styles.sentence}>
          <span className={styles.noun}>Дом</span>
          <span className={styles.comma}>,</span>{' '}
          <span className={styles.clause}>построенный недавно</span>
          <span className={styles.comma}>,</span> красив.
        </p>
        <p className={styles.note}>Оборот после слова — обособляется.</p>
        <p className={styles.sentence}>
          <span className={styles.clause}>Построенный недавно</span>{' '}
          <span className={styles.noun}>дом</span> красив.
        </p>
        <p className={styles.note}>Оборот перед словом — обычно без запятых.</p>
        <p className={styles.sentence}>
          <span className={styles.clause}>Уставший</span>
          <span className={styles.comma}>,</span> <span className={styles.noun}>он</span> уснул.
        </p>
        <p className={styles.note}>При личном местоимении — обособляется и перед ним.</p>
      </div>
    </figure>
  );
}
