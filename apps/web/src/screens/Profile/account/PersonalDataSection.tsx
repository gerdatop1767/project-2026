import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  DISPLAY_NAME_MAX_LENGTH,
  displayNameProblem,
  normalizeDisplayName,
} from '@zybrilka/shared';
import { ApiError, deleteAvatar, updateProfileName, uploadAvatar } from '../../../lib/api.js';
import { useAuth } from '../../../lib/authContext.js';
import { Button } from '../../../ui/Button/Button.js';
import { Icon } from '../../../ui/Icon/Icon.js';
import { Input } from '../../../ui/Input/Input.js';
import { ProfileAvatar } from '../../../ui/ProfileAvatar/ProfileAvatar.js';
import { AVATAR_ACCEPT, AvatarFileError, avatarProblemText, prepareAvatar } from './avatarImage.js';
import styles from './Account.module.css';

type Notice = { kind: 'success' | 'error'; text: string } | null;

const NAME_PROBLEMS = {
  too_long: `Не больше ${DISPLAY_NAME_MAX_LENGTH} символов.`,
  forbidden_characters: 'Нельзя использовать символы < и >.',
} as const;

const AVATAR_SERVER_ERRORS: Record<string, string> = {
  too_large: 'Файл слишком большой. Выберите фото поменьше.',
  invalid_image: 'Сервер не принял это изображение. Подойдёт JPG, PNG или WebP от 64×64 пикселей.',
};

function networkOrServerText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status === 401) {
    return 'Сессия закончилась. Войдите снова.';
  }
  return fallback;
}

export interface PersonalDataSectionProps {
  /** Seam for tests: turns a picked file into the blob to upload. */
  prepare?: (file: File) => Promise<Blob>;
}

/**
 * «Личные данные»: the picture and the display name the user can change.
 * Provider data (VK / Telegram) is only a default — whatever is saved here
 * wins and is never overwritten by a later sign-in. Every successful save
 * returns the refreshed user from the server and pushes it into the auth
 * context, so the header, menu and profile cards update without a reload.
 */
export function PersonalDataSection({ prepare = prepareAvatar }: PersonalDataSectionProps) {
  const { user, updateUser } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);

  // ---- name
  const providerName = [user?.firstName, user?.lastName].filter(Boolean).join(' ');
  const savedName = user?.customName ?? '';
  const [name, setName] = useState(savedName);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameNotice, setNameNotice] = useState<Notice>(null);
  // Follow the saved name when it changes underneath us (saved here, or on
  // another device and re-fetched) — adjusted during render, not in an effect.
  const [syncedName, setSyncedName] = useState(savedName);
  if (syncedName !== savedName) {
    setSyncedName(savedName);
    setName(savedName);
  }

  const normalized = normalizeDisplayName(name);
  const problem = normalized ? displayNameProblem(normalized) : null;
  const nameDirty = (normalized ?? '') !== savedName;

  async function persistName(next: string | null) {
    setNameBusy(true);
    setNameNotice(null);
    try {
      const res = await updateProfileName(next);
      updateUser(res.user);
      setNameNotice({
        kind: 'success',
        text: next ? 'Имя сохранено.' : 'Имя сброшено к данным из соцсети.',
      });
    } catch (error) {
      setName(savedName);
      const body =
        error instanceof ApiError
          ? (error.body as { problem?: keyof typeof NAME_PROBLEMS })
          : undefined;
      setNameNotice({
        kind: 'error',
        text:
          (body?.problem && NAME_PROBLEMS[body.problem]) ||
          networkOrServerText(error, 'Не удалось сохранить имя. Проверьте соединение и повторите.'),
      });
    } finally {
      setNameBusy(false);
    }
  }

  function saveName(event: FormEvent) {
    event.preventDefault();
    if (problem || !nameDirty || nameBusy) return;
    void persistName(normalized);
  }

  // ---- avatar
  const [picked, setPicked] = useState<{ blob: Blob; previewUrl: string } | null>(null);
  const [avatarBusy, setAvatarBusy] = useState<'preparing' | 'uploading' | 'removing' | null>(null);
  const [avatarNotice, setAvatarNotice] = useState<Notice>(null);

  useEffect(() => {
    const url = picked?.previewUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [picked]);

  async function onFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow picking the same file again after a cancel
    if (!file) return;
    setAvatarNotice(null);
    setAvatarBusy('preparing');
    try {
      const blob = await prepare(file);
      setPicked({ blob, previewUrl: URL.createObjectURL(blob) });
    } catch (error) {
      setPicked(null);
      setAvatarNotice({
        kind: 'error',
        text:
          error instanceof AvatarFileError
            ? avatarProblemText[error.problem]
            : avatarProblemText.unreadable,
      });
    } finally {
      setAvatarBusy(null);
    }
  }

  async function savePicked() {
    if (!picked || avatarBusy) return;
    setAvatarBusy('uploading');
    setAvatarNotice(null);
    try {
      const res = await uploadAvatar(picked.blob);
      updateUser(res.user);
      setPicked(null);
      setAvatarNotice({ kind: 'success', text: 'Фото обновлено.' });
    } catch (error) {
      const code =
        error instanceof ApiError
          ? (error.body as { error?: string } | undefined)?.error
          : undefined;
      setAvatarNotice({
        kind: 'error',
        text:
          (code && AVATAR_SERVER_ERRORS[code]) ||
          networkOrServerText(
            error,
            'Не удалось загрузить фото. Проверьте соединение и повторите.',
          ),
      });
    } finally {
      setAvatarBusy(null);
    }
  }

  async function removeAvatar() {
    if (avatarBusy) return;
    setAvatarBusy('removing');
    setAvatarNotice(null);
    try {
      const res = await deleteAvatar();
      updateUser(res.user);
      setAvatarNotice({ kind: 'success', text: 'Своё фото удалено.' });
    } catch (error) {
      setAvatarNotice({
        kind: 'error',
        text: networkOrServerText(error, 'Не удалось удалить фото. Повторите позже.'),
      });
    } finally {
      setAvatarBusy(null);
    }
  }

  const shownAvatar = picked?.previewUrl ?? user?.avatarUrl;

  return (
    <section className={styles.section} aria-labelledby="personal-data-title">
      <h2 id="personal-data-title" className="text-h3">
        Личные данные
      </h2>

      <div className={styles.avatarRow}>
        <span className={styles.avatarFrame}>
          <ProfileAvatar
            src={shownAvatar}
            className={styles.avatarImage}
            fallback={<Icon name="profile" size={36} />}
          />
        </span>
        <div className={styles.avatarActions}>
          {picked ? (
            <>
              <p className="text-body-sm text-secondary">Так будет выглядеть ваше фото.</p>
              <div className={styles.buttonRow}>
                <Button loading={avatarBusy === 'uploading'} onClick={savePicked}>
                  Сохранить фото
                </Button>
                <Button
                  variant="secondary"
                  disabled={avatarBusy === 'uploading'}
                  onClick={() => setPicked(null)}
                >
                  Отмена
                </Button>
              </div>
            </>
          ) : (
            <div className={styles.buttonRow}>
              <Button
                variant="secondary"
                loading={avatarBusy === 'preparing'}
                disabled={avatarBusy !== null}
                onClick={() => fileInput.current?.click()}
              >
                <Icon name="palette" size={16} />{' '}
                {user?.hasCustomAvatar ? 'Заменить фото' : 'Выбрать фото'}
              </Button>
              {user?.hasCustomAvatar && (
                <Button
                  variant="ghost"
                  loading={avatarBusy === 'removing'}
                  disabled={avatarBusy !== null}
                  onClick={removeAvatar}
                >
                  Удалить своё фото
                </Button>
              )}
            </div>
          )}
          <input
            ref={fileInput}
            type="file"
            accept={AVATAR_ACCEPT}
            className={styles.hiddenInput}
            aria-label="Выбрать файл с фото"
            onChange={onFileChosen}
          />
        </div>
      </div>
      {avatarNotice && (
        <p
          role={avatarNotice.kind === 'error' ? 'alert' : 'status'}
          className={`text-body-sm ${avatarNotice.kind === 'error' ? styles.error : styles.success}`}
        >
          {avatarNotice.text}
        </p>
      )}

      <form className={styles.nameForm} onSubmit={saveName} noValidate>
        <Input
          label="Имя в Зубрилке"
          value={name}
          maxLength={DISPLAY_NAME_MAX_LENGTH * 2}
          autoComplete="nickname"
          placeholder={providerName || 'Как к вам обращаться'}
          helperText={
            providerName && !savedName
              ? `Сейчас показывается имя из соцсети: ${providerName}.`
              : `До ${DISPLAY_NAME_MAX_LENGTH} символов.`
          }
          errorText={problem ? NAME_PROBLEMS[problem] : undefined}
          onChange={(event) => {
            setName(event.target.value);
            setNameNotice(null);
          }}
        />
        <div className={styles.buttonRow}>
          <Button type="submit" loading={nameBusy} disabled={!nameDirty || Boolean(problem)}>
            Сохранить
          </Button>
          {nameDirty && (
            <Button
              type="button"
              variant="secondary"
              disabled={nameBusy}
              onClick={() => {
                setName(savedName);
                setNameNotice(null);
              }}
            >
              Отмена
            </Button>
          )}
          {savedName && !nameDirty && (
            <Button
              type="button"
              variant="ghost"
              disabled={nameBusy}
              onClick={() => {
                setName('');
                void persistName(null);
              }}
            >
              Вернуть имя из соцсети
            </Button>
          )}
        </div>
        {nameNotice && (
          <p
            role={nameNotice.kind === 'error' ? 'alert' : 'status'}
            className={`text-body-sm ${nameNotice.kind === 'error' ? styles.error : styles.success}`}
          >
            {nameNotice.text}
          </p>
        )}
      </form>
    </section>
  );
}
