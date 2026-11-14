import { useState } from 'react';
import { parseMultiPartSpec, type TaskWithSolution } from '@zybrilka/shared';
import { revealAnswer } from '../../lib/api.js';
import { Button } from '../Button/Button.js';
import { Icon } from '../Icon/Icon.js';
import { Collapse } from '../motion/motion.js';
import { AnswerMathText } from '../MathText/MathText.js';
import { SolutionText } from '../Solution/SolutionText.js';
import styles from './RevealAnswer.module.css';

type State =
  | { step: 'idle' }
  | { step: 'confirm' }
  | { step: 'loading' }
  | { step: 'shown'; task: TaskWithSolution }
  | { step: 'error' };

/** «а) нет · б) 607» for a multi-part task, the display form otherwise. */
function answerText(task: TaskWithSolution): string {
  if (task.answerType === 'multi_part') {
    const spec = parseMultiPartSpec(task.correctAnswer);
    if (spec) return spec.parts.map((p) => `${p.label}) ${p.correctAnswer}`).join(' · ');
  }
  return task.correctAnswerDisplay ?? task.correctAnswer;
}

/**
 * «Показать ответ» before answering. The first tap only asks (the XP for
 * this task becomes 50%); «Показать» calls the server, which records it
 * and returns the answer and explanation. The share is decided by the
 * server alone (docs/XP.md) — nothing here sends or computes XP.
 */
export function RevealAnswer({ taskId }: { taskId: string }) {
  const [state, setState] = useState<State>({ step: 'idle' });

  function reveal() {
    setState({ step: 'loading' });
    revealAnswer(taskId).then(
      (task) => setState({ step: 'shown', task }),
      () => setState({ step: 'error' }),
    );
  }

  if (state.step === 'shown') {
    const { task } = state;
    return (
      <section className={styles.panel} aria-label="Ответ и решение">
        <p className={styles.label}>Ответ</p>
        <p className={styles.answer}>
          <AnswerMathText text={answerText(task)} />
        </p>
        {task.explanationMd && (
          <>
            <p className={styles.label}>Решение</p>
            <SolutionText text={task.explanationMd} className="text-body-sm" />
          </>
        )}
        <p className={styles.note}>
          Можно ввести ответ и проверить себя — за задание начислится 50% опыта.
        </p>
      </section>
    );
  }

  return (
    <div className={styles.root}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={state.step !== 'idle'}
        onClick={() => setState(state.step === 'idle' ? { step: 'confirm' } : { step: 'idle' })}
      >
        <Icon name="showSolution" size={16} /> Показать ответ
      </button>
      <Collapse open={state.step !== 'idle'}>
        <div className={styles.confirm} role="group" aria-label="Показать ответ?">
          <p>
            Если открыть ответ, за это задание начислится только <b>50% опыта</b>. Попробуй сначала
            решить сам — подсказка тоже поможет.
          </p>
          {state.step === 'error' && (
            <p className={styles.error} role="alert">
              Не удалось загрузить ответ. Попробуй ещё раз.
            </p>
          )}
          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => setState({ step: 'idle' })}>
              Решу сам
            </Button>
            <Button onClick={reveal} disabled={state.step === 'loading'}>
              {state.step === 'loading' ? 'Загружаем…' : 'Показать ответ'}
            </Button>
          </div>
        </div>
      </Collapse>
    </div>
  );
}
