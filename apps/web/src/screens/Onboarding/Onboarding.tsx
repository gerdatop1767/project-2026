import { useEffect, useState } from 'react';
import type { SelfReportedScore, TargetScore } from '@zybrilka/shared';
import { useNavigation } from '../../lib/navigation.js';
import { useAuth } from '../../lib/authContext.js';
import { getLearningProfile, saveLearningProfile } from '../../lib/api.js';
import { selfReportedScoreOptions, targetScoreOptions } from '../../lib/learningProfileLabels.js';
import { subjects } from '../../data/subjects.js';
import { SubjectIcon } from '../../ui/SubjectIcon/SubjectIcon.js';
import { Button } from '../../ui/Button/Button.js';
import { Card } from '../../ui/Card/Card.js';
import { Chip } from '../../ui/Chip/Chip.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { Logo } from '../../ui/Logo/Logo.js';
import { clsx } from '../../lib/clsx.js';
import { FadeIn } from '../../ui/motion/motion.js';
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
    <div className={styles.stack}>
      <div className={styles.header}>
        <button type="button" className={styles.backButton} onClick={goBack} aria-label="Назад">
          <Icon name="back" size={22} />
        </button>
        <div
          className={styles.stepDots}
          role="progressbar"
          aria-label="Шаг онбординга"
          aria-valuenow={step}
          aria-valuemin={1}
          aria-valuemax={TOTAL_STEPS}
        >
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <span key={i} className={clsx(styles.stepDot, i < step && styles.stepDotDone)} />
          ))}
        </div>
      </div>

      <FadeIn key={step} className={styles.content}>
        {step === 1 && (
          <div className={styles.centered}>
            <Logo size={56} />
            <h1 className="text-h1">Добро пожаловать в Zybrilka!</h1>
            <p className="text-body text-secondary">
              Это нужно один раз, чтобы Зубрилка могла подобрать обучение под тебя. Ответим на пару
              вопросов.
            </p>
            <Button
              variant="primary"
              fullWidth
              onClick={() => setStep(2)}
              disabled={loadingProfile}
            >
              Начать
            </Button>
          </div>
        )}

        {step === 2 && (
          <>
            <h1 className="text-h2">Какие предметы сдаёшь?</h1>
            <div className={styles.chipGrid}>
              {subjects.map((subject) => (
                <Chip
                  key={subject.id}
                  selected={selectedSubjects.includes(subject.id)}
                  data-subject-interactive
                  onClick={() => toggleSubject(subject.id)}
                >
                  <span className={styles.chipIcon}>
                    <SubjectIcon
                      subjectId={subject.id}
                      selected={selectedSubjects.includes(subject.id)}
                    />
                  </span>
                  {subject.shortName}
                </Chip>
              ))}
            </div>
            <Button
              variant="primary"
              fullWidth
              disabled={selectedSubjects.length === 0}
              onClick={() => setStep(3)}
            >
              Далее
            </Button>
          </>
        )}

        {step === 3 && (
          <>
            <h1 className="text-h2">Примерно на сколько ты сейчас пишешь?</h1>
            <p className="text-body-sm text-secondary">
              Это просто ориентир, а не точный результат — если не уверен, выбери «Не знаю».
            </p>
            <div className={styles.optionList}>
              {selectedSubjects.map((subjectId) => {
                const subject = subjects.find((s) => s.id === subjectId);
                return (
                  <div key={subjectId} className={styles.skillRow}>
                    <span className={clsx('text-body', styles.skillName)}>
                      {subject?.shortName ?? subjectId}
                    </span>
                    <div className={styles.chipGrid}>
                      {selfReportedScoreOptions.map((option) => (
                        <Chip
                          key={option.id}
                          selected={levels[subjectId] === option.id}
                          onClick={() => setLevels((prev) => ({ ...prev, [subjectId]: option.id }))}
                        >
                          {option.label}
                        </Chip>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <Button
              variant="primary"
              fullWidth
              disabled={!canContinueFromLevels}
              onClick={() => setStep(4)}
            >
              Далее
            </Button>
          </>
        )}

        {step === 4 && (
          <>
            <h1 className="text-h2">Какой результат хочешь получить?</h1>
            <div className={styles.optionList}>
              {selectedSubjects.map((subjectId) => {
                const subject = subjects.find((s) => s.id === subjectId);
                return (
                  <div key={subjectId} className={styles.skillRow}>
                    <span className={clsx('text-body', styles.skillName)}>
                      {subject?.shortName ?? subjectId}
                    </span>
                    <div className={styles.chipGrid}>
                      {targetScoreOptions.map((option) => (
                        <Chip
                          key={option.id}
                          selected={targets[subjectId] === option.id}
                          onClick={() =>
                            setTargets((prev) => ({ ...prev, [subjectId]: option.id }))
                          }
                        >
                          {option.label}
                        </Chip>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <Button
              variant="primary"
              fullWidth
              disabled={!canContinueFromTargets}
              onClick={() => setStep(5)}
            >
              Далее
            </Button>
          </>
        )}

        {step === 5 && (
          <>
            <div className={styles.centered}>
              <h1 className="text-h2">Почти готово!</h1>
            </div>
            <Card>
              <p className="text-body-sm text-secondary">
                Мы сохраним твой выбор и будем подбирать тренировку под тебя по мере решения
                заданий. Это можно изменить позже в профиле.
              </p>
            </Card>
            {saveError && (
              <p className="text-body-sm" style={{ color: 'var(--color-error)' }}>
                {saveError}
              </p>
            )}
            <Button variant="primary" fullWidth onClick={finish} disabled={saving}>
              {saving ? 'Сохраняем…' : 'Перейти к тренировкам'}
            </Button>
          </>
        )}
      </FadeIn>
    </div>
  );
}
