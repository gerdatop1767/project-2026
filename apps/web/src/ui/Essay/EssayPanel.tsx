import { useState } from 'react';
import { MathText } from '../MathText/MathText.js';
import { Button } from '../Button/Button.js';
import { Icon } from '../Icon/Icon.js';
import { Collapse } from '../motion/motion.js';
import { clsx } from '../../lib/clsx.js';
import styles from './EssayPanel.module.css';

export interface EssayPanelProps {
  explanation: string;
  /** `undefined`/absent for a non-essay task (never rendered then); `null` means no sample has been prepared yet. */
  sampleEssay: string | null | undefined;
  acknowledged: boolean;
  acknowledging: boolean;
  onAcknowledge: () => void;
}

/**
 * Replaces the answer field + "Проверить ответ" for an essay task
 * (e.g. EGE Russian 27) — there is nothing to auto-grade
 * (`EssayNotGradableError`). "Я решил" records that the user wrote
 * their own essay (on paper/черновик — see "Расширить поле"), then
 * unlocks "Пример решения": a genuine example essay, explicitly
 * labelled as ONE possible answer, never presented as the single
 * correct one. Shared between TaskDesktop and TaskMobile so both
 * screens show identical essay behavior.
 */
export function EssayPanel({
  explanation,
  sampleEssay,
  acknowledged,
  acknowledging,
  onAcknowledge,
}: EssayPanelProps) {
  const [sampleOpen, setSampleOpen] = useState(false);

  return (
    <div className={styles.panel}>
      <p className={styles.title}>Задание с развёрнутым ответом (сочинение)</p>
      <p className={clsx('text-body-sm', 'text-secondary')}>
        Это задание не проверяется автоматически — напишите сочинение на бумаге или в черновике
        (можно воспользоваться «Расширить поле» в инструментах).
      </p>
      {explanation && (
        <div className={styles.explanation}>
          <MathText text={explanation} />
        </div>
      )}

      {!acknowledged ? (
        <Button variant="secondary" loading={acknowledging} onClick={onAcknowledge}>
          <Icon name="check" size={16} /> Я решил
        </Button>
      ) : (
        <>
          <p className={styles.acknowledgedNote}>
            <Icon name="check" size={16} /> Отмечено как решённое
          </p>
          <button
            type="button"
            className={styles.sampleToggle}
            aria-expanded={sampleOpen}
            onClick={() => setSampleOpen((v) => !v)}
          >
            Пример решения
            <Icon name={sampleOpen ? 'chevronUp' : 'chevronDown'} size={16} />
          </button>
          <Collapse open={sampleOpen}>
            <div className={styles.sampleBody}>
              {sampleEssay ? (
                <>
                  <p className={styles.sampleDisclaimer}>
                    Это один из возможных примеров сочинения — не единственный верный ответ.
                  </p>
                  <MathText text={sampleEssay} className={styles.sampleParagraph} />
                </>
              ) : (
                <p className={clsx('text-body-sm', 'text-secondary')}>
                  Пример сочинения для этого задания пока не подготовлен.
                </p>
              )}
            </div>
          </Collapse>
        </>
      )}
    </div>
  );
}
