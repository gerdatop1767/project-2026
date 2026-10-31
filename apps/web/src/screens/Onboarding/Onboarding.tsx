import { useEffect, useState } from 'react';
import type { SelfReportedScore, TargetScore } from '@zybrilka/shared';
import { useNavigation } from '../../lib/navigation.js';
import { useAuth } from '../../lib/authContext.js';
import { getLearningProfile, saveLearningProfile } from '../../lib/api.js';
import { selfReportedScoreOptions, targetScoreOptions } from '../../lib/learningProfileLabels.js';
import { subjects } from '../../data/subjects.js';
import { Button } from '../../ui/Button/Button.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { SubjectIcon } from '../../ui/SubjectIcon/SubjectIcon.js';
import { SubjectOptionList } from '../../ui/SubjectPicker/SubjectPicker.js';
import styles from './Onboarding.module.css';

const TOTAL_STEPS = 5;

/**
 * Onboarding (ZUBRILKA LEARNING INTELLIGENCE, Phase 1 vertical slice):
 * welcome → subjects → current level → target → save. Real persistence
 * via GET/PUT /me/learning-profile — see apps/api's learningProfile
 * module. Diagnostics, mastery, and everything else from the Learning
 * Intelligence audit are deliberately out of scope for this phase.
 */
export function Onboarding() {
  const { navigate, back } = useNavigation();
  const { refresh } = useAuth();
  const [step, setStep] = useState(1);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>(['math']);
  const [levels, setLevels] = useState<Partial<Record<string, SelfReportedScore>>>({});
  const [targets, setTargets] = useState<Partial<Record<string, TargetScore>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Resume an in-progress or completed profile instead of starting blank
  // — returning here via Profile's "Пройти диагностику заново" should
  // show what's already saved, not make the user re-pick everything.
  useEffect(() => {
    let cancelled = false;
    getLearningProfile()
      .then((profile) => {
        if (cancelled || profile.subjects.length === 0) return;
        setSelectedSubjects(profile.subjects.map((s) => s.subjectId));
        setLevels(
          Object.fromEntries(profile.subjects.map((s) => [s.subjectId, s.selfReportedScore])),
        );
        setTargets(Object.fromEntries(profile.subjects.map((s) => [s.subjectId, s.targetScore])));
      })
      .catch(() => {
        // No saved profile yet (or offline) — the blank defaults above are fine.
      })
      .finally(() => {
        if (!cancelled) setLoadingProfile(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleSubject(id: string) {
    setSelectedSubjects((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  }

  function goBack() {
    if (step === 1) {
      back();
    } else {
      setStep((s) => s - 1);
    }
  }

  const canContinueFromLevels = selectedSubjects.every((id) => levels[id] !== undefined);
  const canContinueFromTargets = selectedSubjects.every((id) => targets[id] !== undefined);

  async function finish() {
    setSaving(true);
    setSaveError(null);
    try {
      await saveLearningProfile({
        subjects: selectedSubjects.map((subjectId) => ({
          subjectId,
          selfReportedScore: levels[subjectId] ?? 'unknown',
          targetScore: targets[subjectId] ?? 'unknown',
        })),
      });
      // The server now says onboarding is complete — pull that into the
      // auth state BEFORE leaving, or the access gate would still think
      // it is owed and send the user straight back here.
      await refresh();
      navigate({ screen: 'home' });
    } catch {
      setSaveError('Не удалось сохранить профиль. Попробуй ещё раз.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      <BackdropArt />
      <div className={styles.header}>
        <button type="button" className={styles.backButton} onClick={goBack} aria-label="Назад">
          <Icon name="back" size={22} />
        </button>
        <div
          className={styles.progress}
          role="progressbar"
          aria-label="Шаг онбординга"
          aria-valuenow={step}
          aria-valuemin={1}
          aria-valuemax={TOTAL_STEPS}
        >
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <span key={i} className={styles.segment}>
              <span className={styles.segmentFill} data-done={i < step || undefined} />
            </span>
          ))}
        </div>
      </div>

      <div key={step} className={styles.content}>
        {step === 1 && (
          <div className={styles.hero}>
            <MascotArt
              srcSet="/branding/v2/onboarding/welcome-480.webp 480w, /branding/v2/onboarding/welcome-720.webp 720w"
              src="/branding/v2/onboarding/welcome-480.webp"
              width={480}
              height={402}
              variant="welcome"
            />
            <section className={styles.glass}>
              <h1 className={styles.heroTitle}>
                Добро пожаловать в <span className={styles.accent}>Zybrilka</span>!
              </h1>
              <p className={styles.lead}>
                Ответь на пару вопросов — и мы подберём обучение под тебя. Это нужно один раз.
              </p>
              <Button
                variant="primary"
                fullWidth
                className={styles.cta}
                onClick={() => setStep(2)}
                disabled={loadingProfile}
              >
                Начать <Icon name="arrowRight" size={18} />
              </Button>
            </section>
          </div>
        )}

        {step === 2 && (
          <section className={styles.glass}>
            <h1 className={styles.title}>
              Какие предметы <span className={styles.accent}>сдаёшь</span>?
            </h1>
            <p className={styles.lead}>
              Можно выбрать несколько — потом их легко поменять в профиле.
            </p>
            <SubjectOptionList
              multiple
              aria-label="Предметы ЕГЭ"
              value={selectedSubjects}
              onSelect={toggleSubject}
            />
            <Button
              variant="primary"
              fullWidth
              className={styles.cta}
              disabled={selectedSubjects.length === 0}
              onClick={() => setStep(3)}
            >
              Далее <Icon name="arrowRight" size={18} />
            </Button>
          </section>
        )}

        {step === 3 && (
          <section className={styles.glass}>
            <h1 className={styles.title}>
              Примерно на сколько ты сейчас <span className={styles.accent}>пишешь</span>?
            </h1>
            <p className={styles.lead}>
              Это просто ориентир, а не точный результат — если не уверен, выбери «Не знаю».
            </p>
            <div className={styles.subjectList}>
              {selectedSubjects.map((subjectId) => (
                <ScoreBlock
                  key={subjectId}
                  subjectId={subjectId}
                  options={selfReportedScoreOptions}
                  value={levels[subjectId]}
                  onChange={(id) => setLevels((prev) => ({ ...prev, [subjectId]: id }))}
                />
              ))}
            </div>
            <Button
              variant="primary"
              fullWidth
              className={styles.cta}
              disabled={!canContinueFromLevels}
              onClick={() => setStep(4)}
            >
              Далее <Icon name="arrowRight" size={18} />
            </Button>
          </section>
        )}

        {step === 4 && (
          <section className={styles.glass}>
            <h1 className={styles.title}>
              Какой результат хочешь <span className={styles.accent}>получить</span>?
            </h1>
            <p className={styles.lead}>Цель поможет понять, на какие задания делать упор.</p>
            <div className={styles.subjectList}>
              {selectedSubjects.map((subjectId) => (
                <ScoreBlock
                  key={subjectId}
                  subjectId={subjectId}
                  options={targetScoreOptions}
                  value={targets[subjectId]}
                  onChange={(id) => setTargets((prev) => ({ ...prev, [subjectId]: id }))}
                />
              ))}
            </div>
            <Button
              variant="primary"
              fullWidth
              className={styles.cta}
              disabled={!canContinueFromTargets}
              onClick={() => setStep(5)}
            >
              Далее <Icon name="arrowRight" size={18} />
            </Button>
          </section>
        )}

        {step === 5 && (
          <div className={styles.hero}>
            <MascotArt
              srcSet="/branding/v2/onboarding/done-320.webp 320w, /branding/v2/onboarding/done-480.webp 480w"
              src="/branding/v2/onboarding/done-320.webp"
              width={320}
              height={384}
              variant="done"
            />
            <section className={styles.glass}>
              <h1 className={styles.heroTitle}>
                Почти <span className={styles.accent}>готово</span>!
              </h1>
              <p className={styles.lead}>
                Мы сохраним твой выбор и будем подбирать тренировку под тебя по мере решения
                заданий. Это можно изменить позже в профиле.
              </p>
              {saveError && (
                <p className={styles.error} role="alert">
                  {saveError}
                </p>
              )}
              <Button
                variant="primary"
                fullWidth
                className={styles.cta}
                onClick={finish}
                disabled={saving}
              >
                {saving ? 'Сохраняем…' : 'Перейти к тренировкам'}
                {!saving && <Icon name="arrowRight" size={18} />}
              </Button>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

/** One subject's score choice: icon + name + options read as one group. */
function ScoreBlock<T extends string>({
  subjectId,
  options,
  value,
  onChange,
}: {
  subjectId: string;
  options: readonly { id: T; label: string }[];
  value: T | undefined;
  onChange: (id: T) => void;
}) {
  const subject = subjects.find((s) => s.id === subjectId);
  const name = subject?.name ?? subjectId;
  return (
    <div className={styles.subjectBlock} role="group" aria-label={name}>
      <span className={styles.subjectArt} aria-hidden="true">
        <SubjectIcon subjectId={subjectId} selected={value !== undefined} />
      </span>
      <div className={styles.subjectBody}>
        <span className={styles.subjectName}>{name}</span>
        <div className={styles.scoreRow}>
          {options.map((option) => {
            const selected = value === option.id;
            return (
              <button
                key={option.id}
                type="button"
                className={styles.score}
                data-selected={selected || undefined}
                aria-pressed={selected}
                onClick={() => onChange(option.id)}
              >
                {selected && <Icon name="check" size={14} />}
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** The mascot with a soft halo; on the last step a check badge pops in once. */
function MascotArt({
  src,
  srcSet,
  width,
  height,
  variant,
}: {
  src: string;
  srcSet: string;
  width: number;
  height: number;
  variant: 'welcome' | 'done';
}) {
  return (
    <div className={styles.mascot} data-variant={variant} aria-hidden="true">
      <span className={styles.halo} />
      <img
        src={src}
        srcSet={srcSet}
        sizes={
          variant === 'welcome'
            ? '(min-width: 900px) 420px, 78vw'
            : '(min-width: 900px) 260px, 52vw'
        }
        width={width}
        height={height}
        alt=""
        decoding="async"
        className={styles.mascotImg}
      />
      {variant === 'done' && (
        <span className={styles.doneBadge}>
          <svg viewBox="0 0 48 48" width="100%" height="100%">
            <circle cx="24" cy="24" r="21" fill="url(#onbDone)" />
            <defs>
              <linearGradient id="onbDone" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#a855f7" />
                <stop offset="1" stopColor="#ec4899" />
              </linearGradient>
            </defs>
            <path
              d="m15 24.5 6.2 6.2L33.5 18"
              fill="none"
              stroke="#fff"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={styles.doneCheck}
            />
          </svg>
        </span>
      )}
    </div>
  );
}

/** Quiet maths in the background — outline shapes, no motion. */
function BackdropArt() {
  return (
    <svg
      className={styles.backdrop}
      viewBox="0 0 400 800"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <g fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
        <path d="M40 120 72 102l32 18v36l-32 18-32-18Z M40 120l32 18 32-18 M72 138v36" />
        <path d="M318 210 352 290h-68Z M318 210l-6 80" />
        <circle cx="330" cy="560" r="26" />
        <path d="M30 640h70M65 605v70" opacity="0.6" />
      </g>
      <g fill="currentColor" fontFamily="serif" fontStyle="italic">
        <text x="300" y="120" fontSize="44">
          π
        </text>
        <text x="36" y="440" fontSize="22">
          x² + y²
        </text>
        <text x="270" y="700" fontSize="20">
          ЕГЭ
        </text>
      </g>
    </svg>
  );
}
