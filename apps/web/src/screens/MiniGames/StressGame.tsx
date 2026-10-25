import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  StressAnswerResponse,
  StressMode,
  StressProgressResponse,
  StressQuestion,
} from '@zybrilka/shared';
import { answerStress, getStressProgress, getStressRound } from '../../lib/api.js';
import { useAccountGate } from '../../lib/accountGate.js';
import { clsx } from '../../lib/clsx.js';
import { useNavigation } from '../../lib/navigation.js';
import { BackRow } from '../../ui/BackRow/BackRow.js';
import { Button } from '../../ui/Button/Button.js';
import { Card } from '../../ui/Card/Card.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { Skeleton } from '../../ui/Skeleton/Skeleton.js';
import { SlideUp } from '../../ui/motion/motion.js';
import {
  currentQuestion,
  isFinished,
  next,
  recordAnswer,
  roundScore,
  startRound,
  type RoundState,
} from './stressRound.js';
import styles from './StressGame.module.css';

const modeTitles: Record<StressMode, string> = {
  all: 'Все слова',
  mistakes: 'Мои ошибки',
  hard: 'Сложные слова',
};

type Phase =
  | { kind: 'menu' }
  | { kind: 'loading'; mode: StressMode }
  | { kind: 'empty'; mode: StressMode }
  | { kind: 'error'; mode: StressMode }
  | { kind: 'playing'; mode: StressMode };

interface Checked {
  readonly chosen: number;
  readonly result: StressAnswerResponse;
}

const newAnswerId = () => crypto.randomUUID();

/**
 * «Ударения» (docs/MINI_GAMES.md): the word without stress, the player
 * taps the stressed vowel, the server checks it. A miss can be retried
 * at once and comes back later in the round. Progress (learned words,
 * accuracy, the words confused most) is kept for signed-in players.
 */
export function StressGame() {
  const { navigate } = useNavigation();
  const { isGuest, requireAccount } = useAccountGate();
  const [phase, setPhase] = useState<Phase>({ kind: 'menu' });
  const [round, setRound] = useState<RoundState | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [progress, setProgress] = useState<StressProgressResponse | null>(null);
  /** Marked forms seen this round, for the summary. */
  const [markedOf, setMarkedOf] = useState<ReadonlyMap<string, string>>(new Map());
  /** One id per question attempt: a retry after a network error is the
   * same answer (counted once), «Повторить слово» is a new one. */
  const answerId = useRef(newAnswerId());

  const loadProgress = useCallback(() => {
    if (isGuest) return;
    getStressProgress().then(setProgress, () => setProgress(null));
  }, [isGuest]);

  useEffect(loadProgress, [loadProgress]);

  async function play(mode: StressMode) {
    if (mode !== 'all' && !requireAccount('gameProgress')) return;
    setPhase({ kind: 'loading', mode });
    setChecked(null);
    setMarkedOf(new Map());
    try {
      const data = await getStressRound(mode);
      if (data.questions.length === 0) {
        setPhase({ kind: 'empty', mode });
        return;
      }
      setRound(startRound(data.questions));
      answerId.current = newAnswerId();
      setPhase({ kind: 'playing', mode });
    } catch {
      setPhase({ kind: 'error', mode });
    }
  }

  async function choose(question: StressQuestion, index: number) {
    if (checked || sending || !round) return;
    setSending(true);
    setSendError(false);
    try {
      const result = await answerStress({
        wordId: question.wordId,
        index,
        clientAnswerId: answerId.current,
      });
      setMarkedOf((m) => new Map(m).set(question.wordId, result.marked));
      setChecked({ chosen: index, result });
      setRound(recordAnswer(round, result.correct));
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  }

  function retryWord() {
    answerId.current = newAnswerId();
    setChecked(null);
  }

  function goNext() {
    if (!round) return;
    answerId.current = newAnswerId();
    setChecked(null);
    const moved = next(round);
    setRound(moved);
    if (isFinished(moved)) loadProgress();
  }

  const back = <BackRow to={{ screen: 'miniGames' }} label="Мини-игры" />;

  if (phase.kind === 'playing' && round) {
    const question = currentQuestion(round);
    if (!question) {
      const score = roundScore(round);
      return (
        <SlideUp className={styles.page}>
          {back}
          <Card className={styles.summary}>
            <h1 className="text-h2">Раунд окончен</h1>
            <p className={styles.bigScore}>
              {score.correct}{' '}
              <span className="text-body text-secondary">из {score.total} с первого раза</span>
            </p>
            {score.missed.length > 0 && (
              <div>
                <p className="text-body-sm text-secondary">Повтори эти слова:</p>
                <ul className={styles.wordList}>
                  {score.missed.map((id) => (
                    <li key={id}>{markedOf.get(id)}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className={styles.actions}>
              <Button onClick={() => void play(phase.mode)}>Ещё раунд</Button>
              {score.missed.length > 0 && (
                <Button variant="secondary" onClick={() => void play('mistakes')}>
                  Тренировать ошибки
                </Button>
              )}
              <Button variant="ghost" onClick={() => setPhase({ kind: 'menu' })}>
                К прогрессу
              </Button>
            </div>
          </Card>
        </SlideUp>
      );
    }
    const shown = Math.min(round.position + 1, round.queue.length);
    return (
      <SlideUp className={styles.page}>
        {back}
        <div className={styles.playHead}>
          <span className="text-body-sm text-secondary">{modeTitles[phase.mode]}</span>
          <span className={styles.counter} aria-label={`Слово ${shown} из ${round.queue.length}`}>
            {shown} / {round.queue.length}
          </span>
        </div>
        <Card className={styles.question}>
          <p className="text-body-sm text-secondary">
            {checked ? 'Ударение:' : 'Нажми на ударную гласную'}
          </p>
          <Word
            question={question}
            checked={checked}
            disabled={sending}
            onChoose={(i) => void choose(question, i)}
          />
          <p className={styles.grammar}>
            {question.partOfSpeech}
            {question.formNote && ` · ${question.formNote}`}
          </p>
          <div aria-live="polite" className={styles.feedback}>
            {checked &&
              (checked.result.correct ? (
                <p className={styles.good}>
                  <Icon name="success" size={18} /> Верно: {checked.result.marked}
                </p>
              ) : (
                <p className={styles.bad}>
                  <Icon name="errorCircle" size={18} /> Правильно: {checked.result.marked}
                </p>
              ))}
            {checked?.result.note && <p className={styles.note}>{checked.result.note}</p>}
            {sendError && (
              <p className={styles.bad} role="alert">
                Не удалось проверить — нажми ещё раз.
              </p>
            )}
          </div>
          {checked && (
            <div className={styles.actions}>
              {!checked.result.correct && (
                <Button variant="secondary" onClick={retryWord}>
                  <Icon name="retry" size={16} /> Повторить слово
                </Button>
              )}
              <Button onClick={goNext} autoFocus>
                Дальше
              </Button>
            </div>
          )}
        </Card>
      </SlideUp>
    );
  }

  return (
    <SlideUp className={styles.page}>
      {back}
      <header className={styles.head}>
        <h1 className="text-h1">Ударения</h1>
        <p className="text-body-sm text-secondary">
          Слова из орфоэпического словника для задания 4 ЕГЭ по русскому языку. Слова в раунде
          перемешаны, ошибки возвращаются.
        </p>
      </header>

      {phase.kind === 'loading' && <Skeleton height={120} />}
      {phase.kind === 'empty' && (
        <Card>
          <p className="text-body">
            {phase.mode === 'mistakes'
              ? 'Ошибок нет — все слова, в которых ты ошибался, уже исправлены.'
              : 'Пока нет слов, в которых ты часто путаешься.'}
          </p>
        </Card>
      )}
      {phase.kind === 'error' && (
        <Card role="alert">
          <p className="text-body">Не удалось загрузить слова — попробуй ещё раз.</p>
        </Card>
      )}

      <div className={styles.modes}>
        <Button fullWidth onClick={() => void play('all')}>
          <Icon name="play" size={18} />{' '}
          {progress && progress.seen > 0 ? 'Продолжить тренировку' : 'Начать'}
        </Button>
        <Button variant="secondary" fullWidth onClick={() => void play('mistakes')}>
          Мои ошибки{progress && progress.mistakes > 0 ? ` · ${progress.mistakes}` : ''}
          {isGuest && <Icon name="lock" size={14} />}
        </Button>
        <Button variant="secondary" fullWidth onClick={() => void play('hard')}>
          Сложные слова
          {isGuest && <Icon name="lock" size={14} />}
        </Button>
      </div>

      {isGuest ? (
        <p className="text-body-sm text-secondary">
          Играть можно без входа. Чтобы сохранялись выученные слова и ошибки,{' '}
          <button
            type="button"
            className={styles.link}
            onClick={() => navigate({ screen: 'login' })}
          >
            войди
          </button>
          .
        </p>
      ) : (
        progress && <ProgressPanel progress={progress} />
      )}

      <details className={styles.sources}>
        <summary>Откуда слова и насколько они проверены</summary>
        <p>
          Слова взяты из орфоэпического словника ФИПИ прошлых лет. С официальным файлом
          «Орфоэпический список – 2026» словарь пока не сверен, поэтому это не полный официальный
          перечень на 2026 год. Слова, которых, по сообщениям, нет в списке 2026, помечены при
          ответе. Ударение каждой формы проверено по нормативному орфоэпическому словарю; слова с
          допустимыми вариантами в игре не показываются.
        </p>
      </details>
    </SlideUp>
  );
}

/** The word as tappable vowels; after the answer — which one is right. */
function Word({
  question,
  checked,
  disabled,
  onChoose,
}: {
  question: StressQuestion;
  checked: Checked | null;
  disabled: boolean;
  onChoose: (index: number) => void;
}) {
  const vowels = new Set(question.vowels);
  return (
    <div className={styles.word} role="group" aria-label={`Слово «${question.display}»`}>
      {[...question.display].map((ch, i) => {
        if (!vowels.has(i)) {
          return (
            <span key={i} className={styles.letter} aria-hidden="true">
              {ch}
            </span>
          );
        }
        const isRight = checked?.result.correctIndex === i;
        const isWrongPick = checked && !checked.result.correct && checked.chosen === i;
        return (
          <button
            key={i}
            type="button"
            className={clsx(
              styles.vowel,
              isRight && styles.vowelRight,
              isWrongPick && styles.vowelWrong,
            )}
            disabled={disabled || checked !== null}
            aria-label={`Ударение на «${ch}», ${question.vowels.indexOf(i) + 1}-я гласная`}
            onClick={() => onChoose(i)}
          >
            {isRight ? ch.toUpperCase() : ch}
          </button>
        );
      })}
    </div>
  );
}

function ProgressPanel({ progress }: { progress: StressProgressResponse }) {
  const share = progress.dictionarySize > 0 ? progress.learned / progress.dictionarySize : 0;
  const maxDay = Math.max(1, ...progress.daily.map((d) => d.answers));
  return (
    <section className={styles.progress} aria-labelledby="stress-progress">
      <h2 id="stress-progress" className="text-h3">
        Прогресс
      </h2>
      <div>
        <p className={styles.learned}>
          <strong>{progress.learned}</strong> из {progress.dictionarySize} слов выучено
        </p>
        <span className={styles.bar} aria-hidden="true">
          <span style={{ width: `${Math.round(share * 100)}%` }} />
        </span>
        <p className="text-body-sm text-secondary">Выучено — два верных ответа подряд.</p>
      </div>
      <dl className={styles.stats}>
        <div>
          <dt>Верно</dt>
          <dd className={styles.good}>{progress.correct}</dd>
        </div>
        <div>
          <dt>Неверно</dt>
          <dd className={styles.bad}>{progress.wrong}</dd>
        </div>
        <div>
          <dt>Точность</dt>
          <dd>{progress.accuracyPercent !== null ? `${progress.accuracyPercent}%` : '—'}</dd>
        </div>
      </dl>
      {progress.daily.length > 0 && (
        <div>
          <p className="text-body-sm text-secondary">Последние две недели</p>
          <ul className={styles.days} aria-label="Ответы по дням">
            {progress.daily.map((d) => (
              <li
                key={d.date}
                title={`${d.date}: ${d.correct} из ${d.answers}`}
                aria-label={`${d.date}: верно ${d.correct} из ${d.answers}`}
              >
                <span style={{ height: `${(d.answers / maxDay) * 100}%` }}>
                  <span style={{ height: `${(d.correct / d.answers) * 100}%` }} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {progress.hardWords.length > 0 && (
        <div>
          <p className="text-body-sm text-secondary">Сложные слова</p>
          <ul className={styles.wordList}>
            {progress.hardWords.map((w) => (
              <li key={w.wordId}>
                {w.marked} <span className="text-secondary">· ошибок: {w.wrong}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
