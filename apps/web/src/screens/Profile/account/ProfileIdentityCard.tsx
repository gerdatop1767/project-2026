import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  DISPLAY_NAME_MAX_LENGTH,
  displayNameProblem,
  normalizeDisplayName,
} from '@zybrilka/shared';
import { ApiError, deleteAvatar, updateProfileName, uploadAvatar } from '../../../lib/api.js';
import { useAuth } from '../../../lib/authContext.js';
import { displayName } from '../../../lib/userDisplay.js';
import { Button } from '../../../ui/Button/Button.js';
import { Card } from '../../../ui/Card/Card.js';
import { Icon } from '../../../ui/Icon/Icon.js';
import { Input } from '../../../ui/Input/Input.js';
import { ProfileAvatar } from '../../../ui/ProfileAvatar/ProfileAvatar.js';
import { AVATAR_ACCEPT, AvatarFileError, avatarProblemText, prepareAvatar } from './avatarImage.js';
import type { IdentitiesState } from './useIdentities.js';
import styles from './ProfileIdentityCard.module.css';

type Notice = { kind: 'success' | 'error'; text: string } | null;

const NAME_PROBLEMS = {
  too_long: `Не больше ${DISPLAY_NAME_MAX_LENGTH} символов.`,
  forbidden_characters: 'Нельзя использовать символы < и >.',
} as const;

const AVATAR_SERVER_ERRORS: Record<string, string> = {
  too_large: 'Файл слишком большой. Выберите фото поменьше.',
  invalid_image: 'Сервер не принял это изображение. Подойдёт JPG, PNG или WebP от 64×64 пикселей.',
};

const PROVIDER_SHORT = { vk: 'VK ID', telegram: 'Telegram', yandex: 'Яндекс ID' } as const;

function networkOrServerText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status === 401) {
    return 'Сессия закончилась. Войдите снова.';
  }
  return fallback;
}

/** "Вход: VK ID, Яндекс ID" — how this account is signed in, or null while unknown. */
function signInSummary(identities: IdentitiesState['data']): string | null {
  if (!identities) return null;
  // Email is not a sign-in method any more (VK ID / Yandex ID / Telegram only).
  const labels = identities.identities.flatMap((identity) =>
    identity.provider === 'email' ? [] : [PROVIDER_SHORT[identity.provider]],
  );
  return labels.length > 0 ? `Вход: ${labels.join(', ')}` : null;
}

export interface ProfileIdentityCardProps {
  identities: IdentitiesState;
  /** Seam for tests: turns a picked file into the blob to upload. */
  prepare?: (file: File) => Promise<Blob>;
}

/**
 * The one top card of the profile (desktop and mobile alike): picture, name,
 * how you sign in, and the controls to change the picture and the nickname —
 * edited in place, nothing repeated further down the page. Provider data
 * (VK / Telegram) is only a default; whatever is saved here wins and is never
 * overwritten by a later sign-in. Every successful save returns the refreshed
 * user from the server and pushes it into the auth context, so the header,
 * menu and this card update without a reload.
 */
export function ProfileIdentityCard({
  identities,
  prepare = prepareAvatar,
}: ProfileIdentityCardProps) {
  const { user, updateUser } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);

  // ---- name
  const providerName = [user?.firstName, user?.lastName].filter(Boolean).join(' ');
  const savedName = user?.customName ?? '';
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(savedName);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameNotice, setNameNotice] = useState<Notice>(null);

  // Follow the saved name when it changes underneath us — adjusted during
  // render, not in an effect.
  const [syncedName, setSyncedName] = useState(savedName);
  if (syncedName !== savedName) {
    setSyncedName(savedName);
    if (!editingName) setName(savedName);
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
      setEditingName(false);
      setNameNotice({
        kind: 'success',
        text: next ? 'Имя сохранено.' : 'Имя сброшено к данным из соцсети.',
      });
    } catch (error) {
      const body =
        error instanceof ApiError
          ? (error.body as { problem?: keyof typeof NAME_PROBLEMS } | undefined)
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
    if (problem || nameBusy) return;
    if (!nameDirty) {
      setEditingName(false);
      return;
    }
    void persistName(normalized);
  }

  function cancelName() {
    setName(savedName);
    setNameNotice(null);
    setEditingName(false);
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

  const openPicker = () => fileInput.current?.click();
  const shownName = displayName(user);
  const summary = signInSummary(identities.data) ?? (shownName ? null : 'Профиль ещё не настроен');
  const notice = avatarNotice ?? nameNotice;

  return (
    <Card className={styles.card}>
      <div className={styles.main}>
        <button
          type="button"
          className={styles.avatarButton}
          aria-label="Выбрать новое фото профиля"
          disabled={Boolean(picked) || avatarBusy !== null}
          onClick={openPicker}
        >
          <span className={styles.avatarFrame}>
            <ProfileAvatar
              src={picked?.previewUrl ?? user?.avatarUrl}
              className={styles.avatarImage}
              fallback={<Icon name="profile" size={32} />}
            />
          </span>
          <span className={styles.avatarBadge} aria-hidden="true">
            <Icon name="edit" size={12} />
          </span>
        </button>

        {editingName ? (
          <form className={styles.nameForm} onSubmit={saveName} noValidate>
            <Input
              aria-label="Имя в Зубрилке"
              value={name}
              autoFocus
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
            <div className={styles.actions}>
              <Button
                type="submit"
                className={styles.compact}
                loading={nameBusy}
                disabled={Boolean(problem)}
              >
                Сохранить
              </Button>
              <Button
                type="button"
                variant="secondary"
                className={styles.compact}
                disabled={nameBusy}
                onClick={cancelName}
              >
                Отмена
              </Button>
              {savedName && (
                <Button
                  type="button"
                  variant="ghost"
                  className={styles.compact}
                  disabled={nameBusy}
                  onClick={() => void persistName(null)}
                >
                  Имя из соцсети
                </Button>
              )}
            </div>
          </form>
        ) : (
          <>
            <div className={styles.info}>
              <p className={`text-h3 ${styles.name}`}>{shownName ?? 'Имя не задано'}</p>
              {summary && (
                <p className={`text-body-sm text-secondary ${styles.summary}`}>{summary}</p>
              )}
            </div>
            <div className={`${styles.actions} ${styles.actionsRow}`}>
              {picked ? (
                <>
                  <Button
                    className={styles.compact}
                    loading={avatarBusy === 'uploading'}
                    onClick={savePicked}
                  >
                    Сохранить фото
                  </Button>
                  <Button
                    variant="secondary"
                    className={styles.compact}
                    disabled={avatarBusy === 'uploading'}
                    onClick={() => setPicked(null)}
                  >
                    Отмена
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    className={styles.compact}
                    loading={avatarBusy === 'preparing'}
                    disabled={avatarBusy !== null}
                    onClick={openPicker}
                  >
                    <Icon name="palette" size={15} className={styles.btnIcon} /> Изменить аватар
                  </Button>
                  <Button
                    variant="secondary"
                    className={styles.compact}
                    disabled={avatarBusy !== null}
                    onClick={() => {
                      setNameNotice(null);
                      setAvatarNotice(null);
                      setName(savedName);
                      setEditingName(true);
                    }}
                  >
                    <Icon name="edit" size={15} className={styles.btnIcon} /> Изменить ник
                  </Button>
                  {user?.hasCustomAvatar && (
                    <Button
                      variant="ghost"
                      className={styles.compact}
                      loading={avatarBusy === 'removing'}
                      disabled={avatarBusy !== null}
                      onClick={removeAvatar}
                    >
                      Удалить фото
                    </Button>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {picked && !editingName && (
        <p className={`text-body-sm text-secondary ${styles.hint}`}>
          Так будет выглядеть ваше фото.
        </p>
      )}
      {notice && (
        <p
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`text-body-sm ${styles.hint} ${notice.kind === 'error' ? styles.error : styles.success}`}
        >
          {notice.text}
        </p>
      )}

      <input
        ref={fileInput}
        type="file"
        accept={AVATAR_ACCEPT}
        className={styles.hiddenInput}
        aria-label="Выбрать файл с фото"
        onChange={onFileChosen}
      />
    </Card>
  );
}
