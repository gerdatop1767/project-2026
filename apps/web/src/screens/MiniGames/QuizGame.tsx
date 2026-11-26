import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MATCH_SEPARATOR,
  QUIZ_PERFECT_BONUS,
  QUIZ_ROUND_MIN,
  QUIZ_ROUND_SIZE,
  QUIZ_POINTS_PER_CORRECT,
  quizGameById,
  quizRoundScore,
  type MiniGameFinishResponse,
  type QuizAnswerResponse,
  type QuizMode,
  type QuizProgressResponse,
  type QuizQuestion,
} from '@zybrilka/shared';
import {
  ApiError,
  abandonQuizRound,
  answerQuiz,
  finishQuizRound,
  getQuizActive,
  getQuizProgress,
  getQuizRound,
} from '../../lib/api.js';
import { useAccountGate } from '../../lib/accountGate.js';
import { clsx } from '../../lib/clsx.js';
import { BackRow } from '../../ui/BackRow/BackRow.js';
import { Button } from '../../ui/Button/Button.js';
import { Card } from '../../ui/Card/Card.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { Skeleton } from '../../ui/Skeleton/Skeleton.js';
import { SlideUp } from '../../ui/motion/motion.js';
import { AnswerMathText, InlineMathText, MathText } from '../../ui/MathText/MathText.js';
import { GameIcon } from './GameIcon.js';
import { RoundSizePicker, effectiveRoundSize, useRoundSize } from './RoundSize.js';
import { GameRules } from './GameRules.js';
import { useGameQuestionCount } from './MiniGames.js';
import styles from './QuizGame.module.css';
import { ContinueCard, NewGameChoice, resumeProgress, useSavedRound } from './savedRound.js';
import { GameRating } from './GameRating.js';

type Phase =
  | { kind: 'menu' }
  | { kind: 'loading' }
  | { kind: 'empty'; mode: QuizMode }
  | { kind: 'error'; message?: string }
  | { kind: 'playing' }
  | { kind: 'summary' };

const newId = () => crypto.randomUUID();

/** Where the questions come from, when it is not only ЕГЭ tasks. */
const SOURCE_NOTE: Record<string, string> = {
  'theory-practice': 'Вопросы — проверенный банк школьной теории с пояснениями.',
  'expressions-blitz': 'Вопросы — из заданий ЕГЭ и вычисляемые выражения тех же типов.',
};

/** «А (1) б (2) в» → text pieces and slot numbers. */
export function splitSlots(text: string): (string | number)[] {
  const out: (string | number)[] = [];
  let last = 0;
  for (const m of text.matchAll(/\((\d{1,2})\)/g)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push(Number(m[1]));
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Words of a text as tappable tokens and the text between them. */
export function splitWords(text: string): { word: boolean; text: string }[] {
  const out: { word: boolean; text: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(/[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*/g)) {
    if (m.index! > last) out.push({ word: false, text: text.slice(last, m.index) });
    out.push({ word: true, text: m[0] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ word: false, text: text.slice(last) });
  return out;
}

/** The gap «▢» of a question, drawn as a blank. */
const showGap = (text: string) => text.replace(/▢/g, '_____');

/**
 * A quiz mini-game (docs/MINI_GAMES.md § Игры-викторины): rounds of 10
 * questions from real ЕГЭ tasks. The FIRST answer to a question counts:
 * after it the question is locked and the right answer is shown with the
 * task's own explanation. 10 points per right answer, +20 for a perfect
 * round. Progress, the best round and «Мои ошибки» are kept for signed-in
 * players; a guest plays the same rounds without saving.
 */
export function QuizGame({ gameId }: { gameId: string }) {
  const game = quizGameById(gameId);
  const { isGuest, requireAccount } = useAccountGate();
  const [phase, setPhase] = useState<Phase>({ kind: 'menu' });
  const [questions, setQuestions] = useState<readonly QuizQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<readonly boolean[]>([]);
  const [checked, setChecked] = useState<QuizAnswerResponse | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [slots, setSlots] = useState<ReadonlySet<number>>(new Set());
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const [typed, setTyped] = useState('');
  /** `match`: the right item chosen for each left item (by left index). */
  const [pairs, setPairs] = useState<readonly (string | null)[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [progress, setProgress] = useState<QuizProgressResponse | null>(null);
  const sessionId = useRef<string | null>(null);
  const answerId = useRef(newId());
  const [roundSize, setRoundSize] = useRoundSize(gameId, QUIZ_ROUND_SIZE);
  const available = useGameQuestionCount(gameId);
  // The round in progress, kept on the server (any device, after a reload).
  const fetchActive = useCallback((sid?: string) => getQuizActive(gameId, sid), [gameId]);
  const abandon = useCallback((sid: string) => abandonQuizRound(gameId, sid), [gameId]);
  const saved = useSavedRound({ gameId, signedIn: !isGuest, fetchActive, abandon });
  const [choiceFor, setChoiceFor] = useState<QuizMode | null>(null);
  const [counted, setCounted] = useState<MiniGameFinishResponse | null>(null);

  const loadProgress = useCallback(() => {
    if (isGuest) return;
    getQuizProgress(gameId).then(setProgress, () => setProgress(null));
  }, [gameId, isGuest]);
  useEffect(loadProgress, [loadProgress]);

  if (!game) {
    return (
      <SlideUp className={styles.page}>
        <BackRow to={{ screen: 'miniGames' }} label="Мини-игры" />
        <Card>
          <p className="text-body">Такой игры нет.</p>
        </Card>
      </SlideUp>
    );
  }

  const resetQuestion = () => {
    setChecked(null);
    setChosen(null);
    setSlots(new Set());
    setPicked(new Set());
    setTyped('');
    setPairs([]);
    setSendError(false);
    answerId.current = newId();
  };

  const play = (mode: QuizMode) => {
    if (mode === 'mistakes' && !requireAccount('gameProgress')) return;
    // A round is unfinished: continue it or start anew — never lost silently.
    if (saved.resume) {
      setChoiceFor(mode);
      return;
    }
    void startRound(mode);
  };

  const startRound = async (mode: QuizMode) => {
    setPhase({ kind: 'loading' });
    try {
      const round = await getQuizRound(
        gameId,
        mode,
        Math.max(QUIZ_ROUND_MIN, effectiveRoundSize(roundSize, available)),
      );
      if (round.questions.length === 0) {
        setPhase({ kind: 'empty', mode });
        return;
      }
      sessionId.current = round.sessionId;
      saved.started(round.sessionId);
      setQuestions(round.questions);
      setIndex(0);
      setResults([]);
      setCounted(null);
      resetQuestion();
      setPhase({ kind: 'playing' });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const n = (error.body as { available?: number } | null)?.available;
        setPhase({
          kind: 'error',
          message:
            n !== undefined
              ? `В игре сейчас ${n} вопросов — выбери не больше ${n}.`
              : 'В игре меньше вопросов, чем выбрано.',
        });
        return;
      }
      setPhase({ kind: 'error' });
    }
  };

  /** «Продолжить игру»: the saved round from where it stopped. */
  const resumeRound = () => {
    const r = saved.resume;
    if (!r) return;
    const firstOf = new Map(r.answered.map((a) => [a.itemId, a.firstCorrect]));
    const next = r.questions.findIndex((q) => !firstOf.has(q.itemId));
    sessionId.current = r.sessionId;
    setQuestions(r.questions);
    setIndex(next === -1 ? r.questions.length - 1 : next);
    setResults(r.questions.filter((q) => firstOf.has(q.itemId)).map((q) => firstOf.get(q.itemId)!));
    setCounted(null);
    resetQuestion();
    setPhase({ kind: 'playing' });
  };

  const startAnew = async (mode: QuizMode) => {
    setChoiceFor(null);
    await saved.giveUp();
    void startRound(mode);
  };

  const question = questions[index];
  const send = async (answer: string, option?: string) => {
    if (!question || checked || sending) return;
    if (option !== undefined) setChosen(option);
    setSending(true);
    setSendError(false);
    try {
      const result = await answerQuiz(gameId, {
        itemId: question.itemId,
        answer,
        clientAnswerId: answerId.current,
        ...(sessionId.current ? { sessionId: sessionId.current } : {}),
      });
      setChecked(result);
      setResults((r) => [...r, result.correct]);
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  };

  const goNext = () => {
    if (index + 1 < questions.length) {
      setIndex(index + 1);
      resetQuestion();
      return;
    }
    // The server counts the result; the screen shows its numbers.
    if (sessionId.current)
      void finishQuizRound(gameId, sessionId.current).then((r) => {
        setCounted(r);
        loadProgress();
      });
    saved.finished();
    setPhase({ kind: 'summary' });
  };

  const right = results.filter(Boolean).length;
  /** Math games store formulas as `$…$` (and a little markdown): typeset them. */
  const math = game.subjectId === 'math';
  const points = results.filter(Boolean).length * QUIZ_POINTS_PER_CORRECT;

  return (
    <SlideUp className={styles.page}>
      <BackRow to={{ screen: 'miniGames' }} label="Мини-игры" />
      <header className={styles.head}>
        <GameIcon gameId={game.id} topic={game.topic} size="lg" />
        <div className={styles.headText}>
          <p className={styles.kicker}>
            {game.subjectId === 'math' ? 'Математика' : 'Русский язык'} · {game.egeTask}
          </p>
          <h1 className="text-h1">{game.title}</h1>
        </div>
      </header>

      {phase.kind === 'menu' && (
        <Card className={styles.menu}>
          <p className="text-body">{game.description}</p>
          <p className={styles.note}>
            {SOURCE_NOTE[game.id] ?? 'Вопросы — из настоящих заданий ЕГЭ.'} Засчитывается первый
            ответ: 10 очков за верный, +{QUIZ_PERFECT_BONUS} за раунд без ошибок.
          </p>
          {isGuest ? (
            <p className={styles.note}>Войди, чтобы сохранять прогресс и проходить свои ошибки.</p>
          ) : (
            progress && (
              <section className={styles.progress} aria-label="Твой прогресс">
                <h2 className="text-h3">Твой прогресс</h2>
                <ul className={styles.stats}>
                  <li>
                    <span>выучено</span>
                    <b>
                      {progress.learned} из {progress.bankSize}
                    </b>
                  </li>
                  <li>
                    <span>точность</span>
                    <b>
                      {progress.accuracyPercent === null ? '—' : `${progress.accuracyPercent}%`}
                    </b>
                  </li>
                  <li>
                    <span>на повторение</span>
                    <b>{progress.mistakes}</b>
                  </li>
                  <li>
                    <span>лучший раунд</span>
                    <b>{progress.bestScore === null ? '—' : `${progress.bestScore} очк.`}</b>
                  </li>
                </ul>
              </section>
            )
          )}
          {saved.resume && (
            <ContinueCard
              {...resumeProgress(saved.resume, QUIZ_POINTS_PER_CORRECT)}
              onContinue={resumeRound}
              onNew={() => void saved.giveUp()}
            />
          )}
          <GameRules gameId={game.id} title={game.title} />
          <RoundSizePicker
            gameId={game.id}
            value={roundSize}
            onChange={setRoundSize}
            available={available}
          />
          <div className={styles.actions}>
            <Button onClick={() => play('all')}>
              <Icon name="play" size={18} /> Играть
            </Button>
            <Button variant="secondary" onClick={() => play('mistakes')}>
              Мои ошибки
            </Button>
          </div>
        </Card>
      )}

      {phase.kind === 'menu' && <GameRating gameId={game.id} />}
      {phase.kind === 'loading' && <Skeleton height={220} />}

      {phase.kind === 'error' && (
        <Card role="alert" className={styles.menu}>
          <p className="text-body">{phase.message ?? 'Не удалось загрузить вопросы.'}</p>
          <Button variant="secondary" onClick={() => setPhase({ kind: 'menu' })}>
            Назад
          </Button>
        </Card>
      )}

      {phase.kind === 'empty' && (
        <Card className={styles.menu}>
          <p className="text-body">
            {phase.mode === 'mistakes'
              ? 'Ошибок на повторение нет — всё, что ты решал, сейчас верно.'
              : 'Вопросов пока нет.'}
          </p>
          <Button variant="secondary" onClick={() => setPhase({ kind: 'menu' })}>
            Назад
          </Button>
        </Card>
      )}

      {phase.kind === 'playing' && question && (
        <>
          <div className={styles.bar}>
            <span>
              Вопрос {index + 1} из {questions.length}
            </span>
            <span className={styles.track} aria-hidden="true">
              <span
                style={{ width: `${((index + (checked ? 1 : 0)) / questions.length) * 100}%` }}
              />
            </span>
            <span className={styles.points}>{points} очк.</span>
          </div>
          <Card className={styles.question}>
            <p className={styles.instruction}>{question.prompt ?? game.instruction}</p>
            {question.kind === 'slots' ? (
              <p className={styles.sentence}>
                {splitSlots(question.text).map((piece, i) =>
                  typeof piece === 'number' ? (
                    <button
                      key={i}
                      type="button"
                      className={clsx(
                        styles.slot,
                        slots.has(piece) && styles.slotOn,
                        checked?.correctSlots?.includes(piece) && styles.slotRight,
                        checked &&
                          slots.has(piece) &&
                          !checked.correctSlots?.includes(piece) &&
                          styles.slotWrong,
                      )}
                      aria-pressed={slots.has(piece)}
                      aria-label={`Место ${piece}${slots.has(piece) ? ', запятая' : ''}`}
                      disabled={checked !== null}
                      onClick={() =>
                        setSlots((s) => {
                          const n = new Set(s);
                          if (n.has(piece)) n.delete(piece);
                          else n.add(piece);
                          return n;
                        })
                      }
                    >
                      {slots.has(piece) ? ',' : piece}
                    </button>
                  ) : (
                    <span key={i}>{piece}</span>
                  ),
                )}
              </p>
            ) : question.kind === 'words' ? (
              <p className={styles.sentence}>
                {splitWords(question.text).map((t, i) =>
                  t.word ? (
                    <button
                      key={i}
                      type="button"
                      className={clsx(styles.word, picked.has(i) && styles.wordOn)}
                      aria-pressed={picked.has(i)}
                      disabled={checked !== null}
                      onClick={() =>
                        setPicked((s) => {
                          const n = new Set(s);
                          if (n.has(i)) n.delete(i);
                          else n.add(i);
                          return n;
                        })
                      }
                    >
                      {t.text}
                    </button>
                  ) : (
                    <span key={i}>{t.text}</span>
                  ),
                )}
              </p>
            ) : math ? (
              <div className={styles.text}>
                <MathText text={question.text.replace(/\n(?!\n)/g, '\n\n')} />
              </div>
            ) : (
              <div className={styles.text}>
                {showGap(question.text)
                  .split('\n')
                  .filter((l) => l.trim())
                  .map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
              </div>
            )}

            {question.kind === 'choice' && question.options && (
              <div
                className={clsx(
                  styles.options,
                  question.options.some((o) => o.length > 14) && styles.optionsWide,
                )}
              >
                {question.options.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={clsx(
                      styles.option,
                      checked &&
                        (option === checked.correctOption ||
                          (checked.correct && option === chosen)) &&
                        styles.optionRight,
                      checked && option === chosen && !checked.correct && styles.optionWrong,
                    )}
                    disabled={checked !== null || sending}
                    onClick={() => void send(option, option)}
                  >
                    {math ? <InlineMathText text={option} /> : option}
                  </button>
                ))}
              </div>
            )}

            {question.kind === 'input' && !checked && (
              <form
                className={styles.inputRow}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (typed.trim()) void send(typed.trim());
                }}
              >
                <input
                  className={styles.input}
                  aria-label="Ответ"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  inputMode={game.subjectId === 'math' ? 'decimal' : 'text'}
                />
                <Button type="submit" disabled={!typed.trim() || sending}>
                  Проверить
                </Button>
              </form>
            )}

            {question.kind === 'match' && question.left && question.options && (
              <ol className={styles.match} aria-label="Пары">
                {question.left.map((leftItem, i) => {
                  const mine = pairs[i] ?? null;
                  const right = checked?.correctPairs?.[i];
                  return (
                    <li key={leftItem} className={styles.matchRow}>
                      <p className={styles.matchLeft}>
                        <InlineMathText text={leftItem} />
                      </p>
                      <div
                        className={styles.matchOptions}
                        role="radiogroup"
                        aria-label={`Пара для: ${leftItem.replace(/\$/g, '')}`}
                      >
                        {question.options!.map((option) => (
                          <button
                            key={option}
                            type="button"
                            role="radio"
                            aria-checked={mine === option}
                            disabled={checked !== null || sending}
                            className={clsx(
                              styles.matchOption,
                              mine === option && styles.matchOn,
                              checked && option === right && styles.optionRight,
                              checked && mine === option && option !== right && styles.optionWrong,
                            )}
                            onClick={() =>
                              setPairs((p) => {
                                const next = [...p];
                                while (next.length < question.left!.length) next.push(null);
                                next[i] = option;
                                return next;
                              })
                            }
                          >
                            <InlineMathText text={option} />
                          </button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}

            {question.kind === 'match' && !checked && (
              <Button
                disabled={
                  sending ||
                  !question.left ||
                  pairs.filter((x) => x !== null).length < question.left.length
                }
                onClick={() => void send(pairs.map((x) => x ?? '').join(MATCH_SEPARATOR))}
              >
                Проверить
              </Button>
            )}

            {(question.kind === 'slots' || question.kind === 'words') && !checked && (
              <Button
                disabled={sending || (question.kind === 'words' && picked.size === 0)}
                onClick={() => {
                  if (question.kind === 'slots') {
                    void send([...slots].sort((a, b) => a - b).join(''));
                  } else {
                    const tokens = splitWords(question.text);
                    void send(
                      [...picked]
                        .sort((a, b) => a - b)
                        .map((i) => tokens[i]!.text)
                        .join(' '),
                    );
                  }
                }}
              >
                Проверить
              </Button>
            )}

            {sendError && (
              <p className={styles.error} role="alert">
                Не удалось проверить ответ — попробуй ещё раз.
              </p>
            )}

            {checked && (
              <div
                className={clsx(styles.feedback, checked.correct ? styles.good : styles.bad)}
                role="status"
              >
                <p className={styles.verdict}>
                  <Icon name={checked.correct ? 'success' : 'errorCircle'} size={20} />
                  {checked.correct ? (
                    'Верно!'
                  ) : checked.correctPairs ? (
                    'Неверно — правильная пара отмечена зелёным в каждой строке'
                  ) : (
                    <span>
                      Неверно. Правильно:{' '}
                      {math ? <AnswerMathText text={checked.display} /> : checked.display}
                    </span>
                  )}
                </p>
                {checked.correct && (
                  <p className={styles.points}>+{QUIZ_POINTS_PER_CORRECT} очк.</p>
                )}
                {checked.alsoCorrect && checked.alsoCorrect.length > 0 && (
                  <p className={styles.note}>
                    Тоже верно по ключу другого задания источника: {checked.alsoCorrect.join(', ')}.
                  </p>
                )}
                {checked.explanation ? (
                  <details className={styles.explanation} open={!checked.correct}>
                    <summary>
                      {checked.explanationSource === 'author'
                        ? 'Пояснение'
                        : checked.explanationSource === 'auto'
                          ? 'Пояснение по ключу (сформировано автоматически)'
                          : 'Разбор из задания'}
                    </summary>
                    <div className={styles.explanationText}>
                      <MathText text={checked.explanation} />
                    </div>
                  </details>
                ) : (
                  <p className={styles.note}>
                    Правильный ответ — по ключу задания ЕГЭ. Разбора этого вопроса в задании нет.
                  </p>
                )}
                <Button onClick={goNext}>
                  {index + 1 < questions.length ? 'Дальше' : 'Итог раунда'}
                </Button>
              </div>
            )}
          </Card>
        </>
      )}

      {saved.resume && (
        <NewGameChoice
          open={choiceFor !== null}
          {...resumeProgress(saved.resume, QUIZ_POINTS_PER_CORRECT)}
          onClose={() => setChoiceFor(null)}
          onContinue={() => {
            setChoiceFor(null);
            resumeRound();
          }}
          onNew={() => void startAnew(choiceFor ?? 'all')}
        />
      )}

      {phase.kind === 'summary' && (
        <Card className={styles.summary} aria-label="Итог раунда">
          <h2 className="text-h2">Итог раунда</h2>
          <p>
            <span className={styles.bigScore}>
              {counted?.score ?? quizRoundScore(right, questions.length)}
            </span>{' '}
            <span className="text-body text-secondary">очков</span>
          </p>
          <p className="text-body">
            Верно {right} из {questions.length}
            {right === questions.length && ` — идеальный раунд, +${QUIZ_PERFECT_BONUS}!`}
          </p>
          {isGuest && (
            <p className={styles.note}>Результат не сохранён: войди, чтобы копить прогресс.</p>
          )}
          <div className={styles.actions}>
            <Button onClick={() => play('all')}>
              <Icon name="play" size={18} /> Ещё раунд
            </Button>
            {!isGuest && right < questions.length && (
              <Button variant="secondary" onClick={() => play('mistakes')}>
                Мои ошибки
              </Button>
            )}
            <Button variant="ghost" onClick={() => setPhase({ kind: 'menu' })}>
              В меню игры
            </Button>
          </div>
        </Card>
      )}
    </SlideUp>
  );
}
