import { useState } from 'react';
import { miniGameRules } from '@zybrilka/shared';
import { Icon } from '../../ui/Icon/Icon.js';
import { Modal } from '../../ui/Modal/Modal.js';
import styles from './GameRules.module.css';

/**
 * «Правила игры» on a game's start screen: a quiet button that opens this
 * game's own rules (goal, how to answer, scoring, end of the round). Never
 * opened by force — a player who knows the rules just plays.
 */
export function GameRules({ gameId, title }: { gameId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const rules = miniGameRules(gameId);
  if (!rules) return null;
  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <Icon name="info" size={18} />
        Правила игры
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Правила игры"
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
