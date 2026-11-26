import { useState, type ReactNode } from 'react';
import { gameStudyRule, miniGameRules, type StudyRule } from '@zybrilka/shared';
import { clsx } from '../../lib/clsx.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { Modal } from '../../ui/Modal/Modal.js';
import styles from './GameRules.module.css';

/** `**word**` → the word in bold; nothing else is markup. */
function rich(text: string): ReactNode {
  const parts = text.split('**');
  return parts.map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part));
}

/** The study material of one ЕГЭ task, in its seven fixed parts. */
export function StudyRuleBody({ rule }: { rule: StudyRule }) {
  return (
    <div className={styles.rule}>
      <section>
        <h3 className={styles.heading}>Когда применяется</h3>
        <p>{rich(rule.when)}</p>
      </section>

      <section>
        <h3 className={styles.heading}>Основные случаи</h3>
        <div className={styles.cases}>
          {rule.cases.map((c) => (
            <div key={c.title} className={styles.case}>
              <h4 className={styles.caseTitle}>{c.title}</h4>
              {c.text && <p>{rich(c.text)}</p>}
              {c.table && (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        {c.table.head.map((h, i) => (
                          <th key={i} scope="col">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {c.table.rows.map((row, r) => (
                        <tr key={r}>
                          {row.map((cell, i) => (
                            <td key={i}>{rich(cell)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {c.points && (
                <ul className={styles.points}>
                  {c.points.map((p) => (
                    <li key={p}>{rich(p)}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className={styles.heading}>Исключения</h3>
        <ul className={clsx(styles.points, styles.exceptions)}>
          {rule.exceptions.map((e) => (
            <li key={e}>{rich(e)}</li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className={styles.heading}>Примеры</h3>
        <ul className={styles.examples}>
          {rule.examples.map((e) => (
            <li key={e.text}>
              <span className={styles.exampleText}>{rich(e.text)}</span>
              <span className={styles.exampleNote}>{rich(e.note)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className={styles.heading}>Типичные ошибки</h3>
        <ul className={styles.mistakes}>
          {rule.mistakes.map((m) => (
            <li key={m.wrong}>
              <span className={styles.wrong}>
                <Icon name="close" size={14} /> {rich(m.wrong)}
              </span>
              <span className={styles.right}>
                <Icon name="check" size={14} /> {rich(m.right)}
              </span>
              <span className={styles.why}>{rich(m.why)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.memo}>
        <h3 className={styles.heading}>
          <Icon name="hint" size={16} /> Краткая памятка
        </h3>
        <ul className={styles.points}>
          {rule.memo.map((m) => (
            <li key={m}>{rich(m)}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** «Правила»: the task's study material, openable before and during a round. */
export function StudyRulesButton({
  gameId,
  compact = false,
}: {
  gameId: string;
  /** In a round: a small chip that leaves the question in view. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rule = gameStudyRule(gameId);
  if (!rule) return null;
  return (
    <>
      <button
        type="button"
        className={clsx(styles.trigger, compact && styles.compact)}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <Icon name="reference" size={compact ? 16 : 18} />
        Правила
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={rule.title}
        subtitle={rule.egeTask}
        icon="reference"
        wide
      >
        <div className={styles.body}>
          <StudyRuleBody rule={rule} />
          <button type="button" className={styles.close} onClick={() => setOpen(false)}>
            {compact ? 'Вернуться к вопросу' : 'Понятно'}
          </button>
        </div>
      </Modal>
    </>
  );
}

/** «Как играть»: what the game asks, scoring and the end of a round. */
function HowToPlay({ gameId, title }: { gameId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const rules = miniGameRules(gameId);
  if (!rules) return null;
  return (
    <>
      <button
        type="button"
        className={styles.link}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <Icon name="info" size={16} />
        Как играть
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Как играть"
        subtitle={title}
        icon="info"
      >
        <div className={styles.body}>
          <section>
            <h3 className={styles.heading}>Что тренируем</h3>
            <p>{rules.goal}</p>
          </section>
          <section>
            <h3 className={styles.heading}>Как играть</h3>
            <ol className={styles.steps}>
              {rules.how.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>
          <section>
            <h3 className={styles.heading}>Очки</h3>
            <p>{rules.scoring}</p>
          </section>
          <section>
            <h3 className={styles.heading}>Конец раунда</h3>
            <p>{rules.end}</p>
          </section>
          <button type="button" className={styles.close} onClick={() => setOpen(false)}>
            Понятно
          </button>
        </div>
      </Modal>
    </>
  );
}

/**
 * A game's start screen: «Правила» — the ЕГЭ task's study material — and,
 * quieter, «Как играть». Neither opens by force.
 */
export function GameRules({ gameId, title }: { gameId: string; title: string }) {
  return (
    <div className={styles.row}>
      <StudyRulesButton gameId={gameId} />
      <HowToPlay gameId={gameId} title={title} />
    </div>
  );
}
