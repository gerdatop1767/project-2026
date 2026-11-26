import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DictionaryAnswerResponse,
  DictionaryMechanic,
  DictionaryQuestion,
  DictionaryReferenceResponse,
  DictionarySummaryResponse,
  MiniGameFinishResponse,
} from '@zybrilka/shared';
import { QUIZ_ROUND_MIN, QUIZ_ROUND_SIZE } from '@zybrilka/shared';
import {
  ApiError,
  abandonDictionaryRound,
  answerDictionary,
  finishDictionaryRound,
  getDictionaryActive,
  getDictionaryReference,
  getDictionaryRound,
  getDictionarySummary,
} from '../../lib/api.js';
import { useAccountGate } from '../../lib/accountGate.js';
import { clsx } from '../../lib/clsx.js';
import { useNavigation } from '../../lib/navigation.js';
import { BackRow } from '../../ui/BackRow/BackRow.js';
import { Button } from '../../ui/Button/Button.js';
import { Card } from '../../ui/Card/Card.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { Skeleton } from '../../ui/Skeleton/Skeleton.js';
import { SlideUp } from '../../ui/motion/motion.js';
import { GameIcon } from './GameIcon.js';
import { GameRating } from './GameRating.js';
import { GameRules } from './GameRules.js';
import { RoundSizePicker, effectiveRoundSize, useRoundSize } from './RoundSize.js';
import { ContinueCard, NewGameChoice, resumeProgress, useSavedRound } from './savedRound.js';
import {
  dictCurrent,
  dictNext,
  dictRecord,
  dictScore,
  matchesSearch,
  resumeDictRound,
  startDictRound,
  type DictRoundState,
} from './dictionaryRound.js';
import styles from './DictionaryGame.module.css';

const GAME = 'dictionary';
type Mode = 'all' | 'mistakes';

const mechanicTitles: Record<DictionaryMechanic, string> = {
  gap: 'Вставь букву',
  spelling: 'Как пишется',
  'find-error': 'Найди ошибку',
  exception: 'Найди исключение',
  group: 'К какой группе',
};

type Phase =
  | { kind: 'menu' }
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'error'; message?: string }
  | { kind: 'playing'; mode: Mode };

interface Checked {
  readonly chosen: string;
  readonly result: DictionaryAnswerResponse;
}

const newAnswerId = () => crypto.randomUUID();

/** Parses the session mode `9:nn:all` back into the choice it was made from. */
function parseMode(mode: string): { task: number; category: string | null; mode: Mode } | null {
  const [task, category, m] = mode.split(':');
  if (!task || !category || !m) return null;
  return {
    task: Number(task),
    category: category === 'all' ? null : category,
    mode: m === 'mistakes' ? 'mistakes' : 'all',
  };
}

/**
 * «Словарные слова и исключения» (docs/DICTIONARY_GAME.md): one game, the
 * ЕГЭ task chosen inside it, five kinds of questions checked on the
 * server, explanations and memory aids after each answer, a searchable
 * reference of every word. Progress, «Мои ошибки», saved rounds and the
 * game's own ratings — like every mini-game.
 */
export function DictionaryGame() {
  const { navigate } = useNavigation();
  const { isGuest, requireAccount } = useAccountGate();
  const [summary, setSummary] = useState<DictionarySummaryResponse | null>(null);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [task, setTask] = useState(9);
  const [category, setCategory] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'menu' });
  const [round, setRound] = useState<DictRoundState | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [counted, setCounted] = useState<MiniGameFinishResponse | null>(null);
  /** Words answered this round (for the summary's «повтори»). */
  const [wordOf, setWordOf] = useState<ReadonlyMap<string, string>>(new Map());
  const [roundOf, setRoundOf] = useState<{ task: number; category: string | null } | null>(null);
  const answerId = useRef(newAnswerId());
  const sessionId = useRef<string | null>(null);
  const [roundSize, setRoundSize] = useRoundSize(GAME, QUIZ_ROUND_SIZE);
  const saved = useSavedRound({
    gameId: GAME,
    signedIn: !isGuest,
    fetchActive: getDictionaryActive,
    abandon: abandonDictionaryRound,
  });
  const [choiceFor, setChoiceFor] = useState<Mode | null>(null);

  const loadSummary = useCallback(() => {
    getDictionarySummary().then(
      (s) => {
        setSummary(s);
        setSummaryFailed(false);
      },
      () => setSummaryFailed(true),
    );
  }, []);
  useEffect(loadSummary, [loadSummary, isGuest]);

  const taskInfo = summary?.tasks.find((t) => t.taskNumber === task) ?? null;
  const categoryInfo = taskInfo?.categories.find((c) => c.id === category) ?? null;
  const available = categoryInfo?.questions ?? taskInfo?.questions ?? null;

  function play(mode: Mode) {
    if (mode !== 'all' && !requireAccount('gameProgress')) return;
    if (saved.resume) {
      setChoiceFor(mode);
      return;
    }
    void begin(mode);
  }

  function continueSaved() {
    const r = saved.resume;
    if (!r) return;
    const from = parseMode(r.mode);
    setChoiceFor(null);
    setChecked(null);
    setCounted(null);
    setWordOf(new Map());
    setRound(resumeDictRound(r.questions, r.answered));
    setRoundOf(from ? { task: from.task, category: from.category } : null);
    sessionId.current = r.sessionId;
    answerId.current = newAnswerId();
    setPhase({ kind: 'playing', mode: from?.mode ?? 'all' });
  }

  async function startAnew(mode: Mode) {
    setChoiceFor(null);
    await saved.giveUp();
    void begin(mode);
  }

  async function begin(mode: Mode) {
    setPhase({ kind: 'loading' });
    setChecked(null);
    setWordOf(new Map());
    try {
      const data = await getDictionaryRound({
        task,
        category,
        mode,
        size: Math.max(QUIZ_ROUND_MIN, effectiveRoundSize(roundSize, available)),
      });
      if (data.questions.length === 0) {
        setPhase({ kind: 'empty' });
        return;
      }
      setRound(startDictRound(data.questions));
      setRoundOf({ task, category });
      sessionId.current = data.sessionId;
      saved.started(data.sessionId);
      setCounted(null);
      answerId.current = newAnswerId();
      setPhase({ kind: 'playing', mode });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const n = (error.body as { available?: number } | null)?.available;
        setPhase({
          kind: 'error',
          message:
            n !== undefined
              ? `Здесь сейчас ${n} вопросов — выбери не больше ${n}. Вопросы не повторяются и не придумываются ради числа.`
              : undefined,
        });
        return;
      }
      setPhase({ kind: 'error' });
    }
  }

  async function choose(question: DictionaryQuestion, option: string) {
    if (checked || sending || !round) return;
    setSending(true);
    setSendError(false);
    try {
      const result = await answerDictionary({
        itemId: question.itemId,
        answer: option,
        clientAnswerId: answerId.current,
        ...(sessionId.current ? { sessionId: sessionId.current } : {}),
      });
      setWordOf((m) => new Map(m).set(question.itemId, result.word));
      setChecked({ chosen: option, result });
      setRound(dictRecord(round, result.correct));
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  }

  function goNext() {
    if (!round) return;
    answerId.current = newAnswerId();
    setChecked(null);
    const moved = dictNext(round);
    setRound(moved);
    if (!dictCurrent(moved)) {
      if (sessionId.current)
        void finishDictionaryRound(sessionId.current).then((r) => {
          setCounted(r);
          loadSummary();
        });
      sessionId.current = null;
      saved.finished();
    }
  }

  const back = <BackRow to={{ screen: 'miniGames' }} label="Мини-игры" />;

  if (phase.kind === 'playing' && round) {
    const question = dictCurrent(round);
    if (!question) {
      const score = dictScore(round);
      const missed = [...new Set(score.missed.map((id) => wordOf.get(id)).filter(Boolean))];
      return (
        <SlideUp className={styles.page}>
          {back}
          <Card className={styles.summary}>
            <h1 className="text-h2">Раунд окончен</h1>
            <p className={styles.bigScore}>
              {score.correct}{' '}
              <span className="text-body text-secondary">из {score.total} с первого раза</span>
            </p>
            {counted && (
              <p className="text-body-sm text-secondary">
                Очков за раунд: <strong>{counted.score}</strong>
              </p>
            )}
            {missed.length > 0 && (
              <div>
                <p className="text-body-sm text-secondary">Повтори эти слова:</p>
                <ul className={styles.wordChips}>
                  {missed.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className={styles.actions}>
              <Button onClick={() => play(phase.mode)}>Ещё раунд</Button>
              {missed.length > 0 && (
                <Button variant="secondary" onClick={() => play('mistakes')}>
                  Тренировать ошибки
                </Button>
              )}
              <Button variant="ghost" onClick={() => setPhase({ kind: 'menu' })}>
                К заданиям
              </Button>
            </div>
          </Card>
        </SlideUp>
      );
    }
    const shown = Math.min(round.position + 1, round.queue.length);
    const wide = question.mechanic !== 'gap' || question.options.length > 3;
    const playingTask = summary?.tasks.find((t) => t.taskNumber === roundOf?.task);
    return (
      <SlideUp className={styles.page}>
        {back}
        <div className={styles.playHead}>
          <span className="text-body-sm text-secondary">
            {playingTask ? `Задание ${playingTask.taskNumber} · ` : ''}
            {mechanicTitles[question.mechanic]}
          </span>
          <span
            className={styles.counter}
            aria-label={`Вопрос ${shown} из ${round.queue.length}`}
          >
            {shown} / {round.queue.length}
          </span>
        </div>
        <Card className={styles.question}>
          <p className={styles.prompt}>{question.prompt}</p>
          {question.text && <p className={styles.shown}>{question.text}</p>}
          <div
            className={clsx(styles.options, wide && styles.optionsWide)}
            role="group"
            aria-label="Варианты ответа"
          >
            {question.options.map((o) => {
              const right = checked?.result.correctOption === o;
              const wrongPick = checked && !checked.result.correct && checked.chosen === o;
              return (
                <button
                  key={o}
                  type="button"
                  className={clsx(
                    styles.option,
                    right && styles.optionRight,
                    wrongPick && styles.optionWrong,
                  )}
                  disabled={sending || checked !== null}
                  onClick={() => void choose(question, o)}
                >
                  {o}
                </button>
              );
            })}
          </div>
          <div aria-live="polite" className={styles.feedback}>
            {checked && (
              <>
                <p className={checked.result.correct ? styles.good : styles.bad}>
                  <Icon name={checked.result.correct ? 'success' : 'errorCircle'} size={18} />
                  {checked.result.correct ? 'Верно: ' : 'Правильно: '}
                  <strong>{checked.result.word}</strong>
                </p>
                <p className={styles.explanation}>{checked.result.explanation}</p>
                {checked.result.memo && (
                  <p className={styles.memo}>
                    <span className={styles.memoLabel}>Как запомнить</span>
                    {checked.result.memo}
                  </p>
                )}
              </>
            )}
            {sendError && (
              <p className={styles.bad} role="alert">
                Не удалось проверить — нажми ещё раз.
              </p>
            )}
          </div>
          {checked && (
            <div className={styles.actions}>
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
        <div className={styles.headRow}>
          <GameIcon gameId={GAME} topic="orthography" size="lg" />
          <h1 className="text-h1">Словарные слова и исключения</h1>
        </div>
        <p className="text-body-sm text-secondary">
          Слова, которые нельзя проверить правилом, исключения и трудные написания к заданиям 9,
          10, 12–15 ЕГЭ. Выбери задание — и тренируй его слова в пяти видах вопросов.
        </p>
      </header>

      {saved.resume && (
        <ContinueCard
          {...resumeProgress(saved.resume, 10)}
          onContinue={continueSaved}
          onNew={() => void saved.giveUp()}
        />
      )}
      {saved.resume && (
        <NewGameChoice
          open={choiceFor !== null}
          {...resumeProgress(saved.resume, 10)}
          onClose={() => setChoiceFor(null)}
          onContinue={continueSaved}
          onNew={() => void startAnew(choiceFor ?? 'all')}
        />
      )}

      {summaryFailed && (
        <Card role="alert">
          <p className="text-body">Не удалось загрузить задания — попробуй ещё раз.</p>
          <Button variant="secondary" onClick={loadSummary}>
            Повторить
          </Button>
        </Card>
      )}
      {!summary && !summaryFailed && <Skeleton height={160} />}
      {summary && (
        <section aria-labelledby="dict-tasks" className={styles.section}>
          <h2 id="dict-tasks" className="text-h3">
            Задание
          </h2>
          <div className={styles.tasks} role="radiogroup" aria-label="Номер задания">
            {summary.tasks.map((t) => (
              <button
                key={t.taskNumber}
                type="button"
                role="radio"
                aria-checked={t.taskNumber === task}
                className={clsx(styles.task, t.taskNumber === task && styles.taskOn)}
                onClick={() => {
                  setTask(t.taskNumber);
                  setCategory(null);
                }}
              >
                <span className={styles.taskNumber}>№{t.taskNumber}</span>
                <span className={styles.taskTitle}>{t.title}</span>
                <span className={styles.taskMeta}>
                  {t.learned !== null ? `${t.learned} из ${t.words} слов` : `${t.words} слов`}
                  {t.bestScore !== null && ` · рекорд ${t.bestScore}`}
                </span>
              </button>
            ))}
          </div>
          {taskInfo && (
            <>
              <p className="text-body-sm text-secondary">{taskInfo.description}</p>
              <div className={styles.chips} role="radiogroup" aria-label="Группа слов">
                <button
                  type="button"
                  role="radio"
                  aria-checked={category === null}
                  className={clsx(styles.chip, category === null && styles.chipOn)}
                  onClick={() => setCategory(null)}
                >
                  Все группы
                </button>
                {taskInfo.categories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={category === c.id}
                    className={clsx(styles.chip, category === c.id && styles.chipOn)}
                    onClick={() => setCategory(c.id)}
                  >
                    {c.title} <span className={styles.chipCount}>{c.words}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {phase.kind === 'loading' && <Skeleton height={80} />}
      {phase.kind === 'empty' && (
        <Card>
          <p className="text-body">
            Ошибок в этом задании нет — все слова, где ты ошибался, уже исправлены.
          </p>
        </Card>
      )}
      {phase.kind === 'error' && (
        <Card role="alert">
          <p className="text-body">{phase.message ?? 'Не удалось загрузить вопросы — попробуй ещё раз.'}</p>
        </Card>
      )}

      <GameRules gameId={GAME} title="Словарные слова и исключения" />
      <RoundSizePicker
        gameId={GAME}
        value={roundSize}
        onChange={setRoundSize}
        available={available}
      />
      <div className={styles.modes}>
        <Button fullWidth onClick={() => play('all')} disabled={!summary}>
          <Icon name="play" size={18} /> Начать
        </Button>
        <Button variant="secondary" fullWidth onClick={() => play('mistakes')} disabled={!summary}>
          Мои ошибки
          {isGuest && <Icon name="lock" size={14} />}
        </Button>
      </div>

      {summary && <Reference task={task} summary={summary} />}

      <GameRating gameId={GAME} />

      {isGuest && (
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
      )}

      <details className={styles.sources}>
        <summary>Откуда слова</summary>
        <p>
          Списки составлены по правилам орфографии, которые проверяют задания 9–15 ЕГЭ, и сверены с
          орфографическим словарём. Приёмы запоминания — это подсказки для памяти, а не
          происхождение слова. Нашёл ошибку — напиши в поддержку.
        </p>
      </details>
    </SlideUp>
  );
}

/**
 * «Справочник»: the words of the chosen task by group, with the rule; a
 * search finds a word in every task. Tap a word — its explanation and
 * memory aid.
 */
function Reference({ task, summary }: { task: number; summary: DictionarySummaryResponse }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [refs, setRefs] = useState<ReadonlyMap<number, DictionaryReferenceResponse>>(new Map());
  const [failed, setFailed] = useState(false);
  const searching = query.trim().length > 0;
  const needed = searching ? summary.tasks.map((t) => t.taskNumber) : [task];
  const missing = open ? needed.filter((n) => !refs.has(n)) : [];
  const missingKey = missing.join(',');

  useEffect(() => {
    if (!missingKey) return;
    let live = true;
    Promise.all(missingKey.split(',').map((n) => getDictionaryReference(Number(n)))).then(
      (loaded) => {
        if (!live) return;
        setRefs((m) => {
          const next = new Map(m);
          for (const r of loaded) next.set(r.taskNumber, r);
          return next;
        });
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [missingKey]);

  const shown = needed
    .map((n) => refs.get(n))
    .filter((r): r is DictionaryReferenceResponse => r !== undefined)
    .map((r) => ({
      ...r,
      categories: r.categories
        .map((c) => ({
          ...c,
          words: c.words.filter((w) => matchesSearch(query, w.word, w.explanation)),
        }))
        .filter((c) => c.words.length > 0),
    }))
    .filter((r) => r.categories.length > 0);
  const found = shown.reduce((n, r) => n + r.categories.reduce((k, c) => k + c.words.length, 0), 0);

  return (
    <section className={styles.reference} aria-labelledby="dict-reference">
      <button
        type="button"
        className={styles.referenceToggle}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        id="dict-reference"
      >
        <Icon name="topic" size={18} />
        <span>Справочник слов</span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={18} />
      </button>
      {open && (
        <div className={styles.referenceBody}>
          <label className={styles.search}>
            <Icon name="search" size={16} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Найти слово во всех заданиях"
              aria-label="Поиск по словам"
            />
          </label>
          {failed && (
            <p className={styles.bad} role="alert">
              Не удалось загрузить справочник.
            </p>
          )}
          {missing.length > 0 && !failed && <Skeleton height={80} />}
          {missing.length === 0 && searching && (
            <p className="text-body-sm text-secondary" aria-live="polite">
              {found > 0 ? `Найдено: ${found}` : 'Ничего не найдено'}
            </p>
          )}
          {shown.map((r) => (
            <div key={r.taskNumber} className={styles.refTask}>
              {searching && <h3 className="text-h4">Задание {r.taskNumber}</h3>}
              {r.categories.map((c) => (
                <div key={c.id} className={styles.refGroup}>
                  <h4 className={styles.refGroupTitle}>{c.title}</h4>
                  <p className={styles.refRule}>{c.rule}</p>
                  <ul className={styles.refWords}>
                    {c.words.map((w) => (
                      <li key={w.word}>
                        <details>
                          <summary>
                            {w.word}
                            {w.exception && <span className={styles.badge}>исключение</span>}
                          </summary>
                          <p>{w.explanation}</p>
                          {w.memo && (
                            <p className={styles.memo}>
                              <span className={styles.memoLabel}>Как запомнить</span>
                              {w.memo}
                            </p>
                          )}
                        </details>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
