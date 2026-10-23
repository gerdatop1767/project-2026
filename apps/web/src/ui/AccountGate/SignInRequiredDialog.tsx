import type { AccountFeature } from '../../lib/accountGate.js';
import { useIsDesktop } from '../../lib/useIsDesktop.js';
import { BottomSheet } from '../BottomSheet/BottomSheet.js';
import { Modal } from '../Modal/Modal.js';
import { Button } from '../Button/Button.js';
import styles from './SignInRequiredDialog.module.css';

const copy: Record<AccountFeature, { title: string; text: string }> = {
  statistics: {
    title: 'Статистика — после входа',
    text: 'Чтобы считать твой прогресс по номерам и темам и строить графики, нужен аккаунт.',
  },
  mistakes: {
    title: 'Мои ошибки — после входа',
    text: 'Мы запоминаем задания с ошибками и собираем из них тренировку — для этого нужен аккаунт.',
  },
  favorites: {
    title: 'Избранное — после входа',
    text: 'Сохранённые задания хранятся в твоём аккаунте, чтобы не потеряться.',
  },
  smartTraining: {
    title: 'Умная тренировка — после входа',
    text: 'Она подбирает задания по твоему прогрессу — а прогресс сохраняется в аккаунте.',
  },
  unseen: {
    title: '«Только нерешённые» — после входа',
    text: 'Чтобы знать, какие задания ты уже решал, нужен аккаунт.',
  },
  essay: {
    title: 'Пример сочинения — после входа',
    text: 'Отметка «Я решил» и пример сочинения сохраняются в аккаунте.',
  },
  level: {
    title: 'Уровень — после входа',
    text: 'Опыт начисляется за верно решённые задания и хранится в аккаунте.',
  },
};

export interface SignInRequiredDialogProps {
  feature: AccountFeature | null;
  onClose: () => void;
  onSignIn: () => void;
}

/**
 * «Нужна регистрация»: a calm window over the current screen (which stays
 * as it was) — the mascot, what this feature needs an account for, and
 * the way in. Never a blank page, never a redirect.
 */
export function SignInRequiredDialog({ feature, onClose, onSignIn }: SignInRequiredDialogProps) {
  const isDesktop = useIsDesktop();
  const Surface = isDesktop ? Modal : BottomSheet;
  const content = feature ? copy[feature] : null;

  return (
    <Surface open={feature !== null} onClose={onClose} title={content?.title}>
      {content && (
        <div className={styles.body}>
          <img
            src="/branding/v2/support-bison.webp"
            alt=""
            aria-hidden="true"
            width={560}
            height={672}
            decoding="async"
            className={styles.mascot}
          />
          <p className={styles.text}>{content.text}</p>
          <p className={styles.note}>
            Решать задания можно и без аккаунта: ответы проверяются, но не сохраняются.
          </p>
          <div className={styles.actions}>
            <Button variant="primary" fullWidth onClick={onSignIn}>
              Войти или зарегистрироваться
            </Button>
            <Button variant="secondary" fullWidth onClick={onClose}>
              Не сейчас
            </Button>
          </div>
        </div>
      )}
    </Surface>
  );
}
