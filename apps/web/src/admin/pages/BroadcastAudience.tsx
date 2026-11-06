import { useEffect, useState } from 'react';
import {
  BROADCAST_BUTTON_TEXT_MAX,
  BROADCAST_STAGE_PRESETS,
  broadcastStages,
  DEFAULT_BROADCAST_BUTTON_TEXT,
  type BroadcastAudienceInput,
  type BroadcastAudiencePreview,
  type BroadcastAudienceUser,
  type BroadcastStage,
} from '@zybrilka/shared';
import { subjects } from '../../data/subjects.js';
import { adminApi } from '../adminApi.js';
import { Card, DataTable, ErrorState, Note, Segmented } from '../components/ui.js';
import { dateTime, num } from '../format.js';
import s from '../admin.module.css';

export type AudiencePreview = BroadcastAudiencePreview & { excluded: BroadcastAudienceUser[] };

export interface AudienceSettings {
  audience: BroadcastAudienceInput | null;
  trackClicks: boolean;
  buttonText: string | null;
}

type NumberKey =
  | 'accountAgeMinDays'
  | 'accountAgeMaxDays'
  | 'inactiveMinDays'
  | 'activeWithinDays'
  | 'activityWindowDays'
  | 'activeDaysMin'
  | 'activeDaysMax'
  | 'solvedMin'
  | 'solvedMax';

const numberFields: { key: NumberKey; label: string }[] = [
  { key: 'accountAgeMinDays', label: 'Аккаунту дней: от' },
  { key: 'accountAgeMaxDays', label: 'Аккаунту дней: до' },
  { key: 'inactiveMinDays', label: 'Без активности дней: от' },
  { key: 'activeWithinDays', label: 'Был активен за последние, дней' },
  { key: 'activityWindowDays', label: 'Окно активности, дней' },
  { key: 'activeDaysMin', label: 'Активных дней в окне: от' },
  { key: 'activeDaysMax', label: 'Активных дней в окне: до' },
  { key: 'solvedMin', label: 'Решено заданий: от' },
  { key: 'solvedMax', label: 'Решено заданий: до' },
];

export const stageLabel = (stage: string | null | undefined) =>
  stage && stage in BROADCAST_STAGE_PRESETS
    ? BROADCAST_STAGE_PRESETS[stage as BroadcastStage].label
    : null;

/**
 * «Кому отправить» (docs/TELEGRAM_BOT.md §Рассылки по аудитории): everyone
 * who started the bot, or «Возврат пользователей» — a ready stage (3/7/20
 * days after registration) and/or filters. The count and the list come
 * from the server with the same SQL the worker sends with; users can be
 * taken out one by one. Saved only with «Сохранить аудиторию».
 */
/** A mapped copy, so it fits DataTable's row constraint. */
type Row = Pick<BroadcastAudienceUser, keyof BroadcastAudienceUser>;

export function AudienceEditor({
  broadcastId,
  initial,
  onSaved,
}: {
  broadcastId: string;
  initial: AudienceSettings;
  onSaved: () => void;
}) {
  const [targeted, setTargeted] = useState(initial.audience !== null);
  const [a, setA] = useState<BroadcastAudienceInput>(initial.audience ?? {});
  const [trackClicks, setTrackClicks] = useState(initial.trackClicks);
  const [buttonText, setButtonText] = useState(initial.buttonText ?? '');
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const audience = targeted ? a : null;
  const key = JSON.stringify(audience);

  // Re-count shortly after the filters stop changing.
  useEffect(() => {
    if (!audience) return;
    let live = true;
    const timer = setTimeout(() => {
      adminApi
        .post<AudiencePreview>('/broadcasts/audience/preview', { audience, broadcastId })
        .then((p) => live && (setPreview(p), setError(null)))
        .catch((e) => live && setError(e));
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, broadcastId]);

  const set = (patch: Partial<BroadcastAudienceInput>) => {
    setSaved(false);
    setA((prev) => ({ ...prev, ...patch }));
  };
  const setNumber = (k: NumberKey, value: string) =>
    set({ [k]: value === '' ? undefined : Math.max(0, Math.floor(Number(value))) });
  const pickStage = (stage: BroadcastStage | null) => {
    if (!stage) return set({ stage: null });
    const p = BROADCAST_STAGE_PRESETS[stage];
    set({ stage, accountAgeMinDays: p.accountAgeMinDays, accountAgeMaxDays: p.accountAgeMaxDays });
  };
  const excludeIds = a.excludeUserIds ?? [];
  const toggleExclude = (id: string, out: boolean) =>
    set({ excludeUserIds: out ? [...excludeIds, id] : excludeIds.filter((x) => x !== id) });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.patch(`/broadcasts/${broadcastId}`, {
        audience,
        trackClicks,
        buttonText: buttonText.trim() || null,
      });
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const userColumns = (out: boolean) => [
    {
      key: 'name',
      label: 'Пользователь',
      render: (u: Row) => u.name ?? `без имени · ${u.id.slice(0, 8)}`,
    },
    {
      key: 'registeredAt',
      label: 'Регистрация',
      render: (u: Row) => dateTime(u.registeredAt),
    },
    {
      key: 'lastActiveAt',
      label: 'Последняя активность',
      render: (u: Row) => (u.lastActiveAt ? dateTime(u.lastActiveAt) : '—'),
    },
    { key: 'solved', label: 'Решено', numeric: true },
    {
      key: 'action',
      label: '',
      render: (u: Row) => (
        <button type="button" className={s.button} onClick={() => toggleExclude(u.id, !out)}>
          {out ? 'Вернуть' : 'Исключить'}
        </button>
      ),
    },
  ];

  return (
    <Card title="Кому отправить" note="Сохраняется кнопкой «Сохранить аудиторию»">
      <div className={s.grid}>
        <Segmented
          label="Аудитория"
          value={targeted ? 'targeted' : 'all'}
          options={[
            { value: 'all', label: 'Всем подписчикам бота' },
            { value: 'targeted', label: 'Возврат пользователей' },
          ]}
          onChange={(v) => {
            setSaved(false);
            setTargeted(v === 'targeted');
          }}
        />
        {targeted && (
          <>
            <fieldset className={s.filters}>
              <legend className={s.small}>Готовые категории</legend>
              {broadcastStages.map((stage) => (
                <button
                  key={stage}
                  type="button"
                  className={`${s.button} ${a.stage === stage ? s.buttonPrimary : ''}`}
                  aria-pressed={a.stage === stage}
                  onClick={() => pickStage(a.stage === stage ? null : stage)}
                >
                  {BROADCAST_STAGE_PRESETS[stage].label}
                </button>
              ))}
            </fieldset>
            {a.stage && (
              <label className={s.switchLabel}>
                <input
                  type="checkbox"
                  checked={a.allowRepeat ?? false}
                  onChange={(e) => set({ allowRepeat: e.target.checked })}
                />
                Отправить и тем, кто уже получал этап «{stageLabel(a.stage)}» (повтор)
              </label>
            )}
            <fieldset className={s.filters}>
              <legend className={s.small}>Фильтры (все условия вместе)</legend>
              <label className={s.field}>
                Регистрация с
                <input
                  className={s.input}
                  type="date"
                  value={a.registeredFrom ?? ''}
                  onChange={(e) => set({ registeredFrom: e.target.value || undefined })}
                />
              </label>
              <label className={s.field}>
                Регистрация по
                <input
                  className={s.input}
                  type="date"
                  value={a.registeredTo ?? ''}
                  onChange={(e) => set({ registeredTo: e.target.value || undefined })}
                />
              </label>
              {numberFields.map((f) => (
                <label key={f.key} className={s.field}>
                  {f.label}
                  <input
                    className={s.input}
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={a[f.key] ?? ''}
                    placeholder={f.key === 'activityWindowDays' ? '7' : undefined}
                    onChange={(e) => setNumber(f.key, e.target.value)}
                  />
                </label>
              ))}
              <label className={s.field}>
                Мини-игры
                <select
                  className={s.select}
                  value={a.miniGames ?? 'any'}
                  onChange={(e) =>
                    set({ miniGames: e.target.value as 'any' | 'played' | 'not_played' })
                  }
                >
                  <option value="any">не важно</option>
                  <option value="played">играли</option>
                  <option value="not_played">не играли</option>
                </select>
              </label>
            </fieldset>
            <fieldset className={s.filters}>
              <legend className={s.small}>Выбранные предметы (хотя бы один)</legend>
              {subjects.map((subject) => {
                const on = (a.subjects ?? []).includes(subject.id);
                return (
                  <label key={subject.id} className={s.switchLabel}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        set({
                          subjects: on
                            ? (a.subjects ?? []).filter((x) => x !== subject.id)
                            : [...(a.subjects ?? []), subject.id],
                        })
                      }
                    />
                    {subject.shortName}
                  </label>
                );
              })}
            </fieldset>
            <p className={s.small}>
              Активность — ответ на задание или в мини-игре, вход в аккаунт или событие статистики
              (только с согласием на cookie). Простой визит без этого не виден.
            </p>
          </>
        )}

        <label className={s.switchLabel}>
          <input
            type="checkbox"
            checked={trackClicks}
            onChange={(e) => {
              setSaved(false);
              setTrackClicks(e.target.checked);
            }}
          />
          Кнопка со ссылкой на сайт под сообщением (считаются переходы)
        </label>
        {trackClicks && (
          <label className={s.field}>
            Текст кнопки
            <input
              className={s.input}
              value={buttonText}
              maxLength={BROADCAST_BUTTON_TEXT_MAX}
              placeholder={DEFAULT_BROADCAST_BUTTON_TEXT}
              onChange={(e) => {
                setSaved(false);
                setButtonText(e.target.value);
              }}
            />
          </label>
        )}

        {audience && preview && (
          <div className={s.grid} aria-live="polite">
            <p>
              Получат сейчас: <strong>{num(preview.count)}</strong>
            </p>
            <ul className={s.small}>
              <li>
                без привязанного Telegram или бот заблокирован: {num(preview.leftOut.noBotChat)}
              </li>
              <li>отключили уведомления: {num(preview.leftOut.notificationsOff)}</li>
              <li>уже получали этот этап: {num(preview.leftOut.stageAlreadySent)}</li>
              <li>исключены вручную: {num(preview.leftOut.excludedByHand)}</li>
            </ul>
            {preview.sample.length > 0 && (
              <DataTable<Row>
                caption="Получатели"
                rowKey={(u) => u.id}
                rows={showAll ? [...preview.sample] : preview.sample.slice(0, 20)}
                columns={userColumns(false)}
              />
            )}
            {!showAll && preview.sample.length > 20 && (
              <button type="button" className={s.button} onClick={() => setShowAll(true)}>
                Показать всех в списке ({num(preview.sample.length)})
              </button>
            )}
            {preview.count > preview.sample.length && (
              <p className={s.small}>
                В списке первые {num(preview.sample.length)} из {num(preview.count)} — исключить
                можно из них; отправка уйдёт всем {num(preview.count)}.
              </p>
            )}
            {preview.excluded.length > 0 && (
              <DataTable<Row>
                caption="Исключены вручную"
                rowKey={(u) => u.id}
                rows={preview.excluded}
                columns={userColumns(true)}
              />
            )}
          </div>
        )}
        {error !== null && <ErrorState error={error} compact />}
        <div className={s.toolbar}>
          <button
            type="button"
            className={`${s.button} ${s.buttonPrimary}`}
            disabled={busy}
            onClick={() => void save()}
          >
            Сохранить аудиторию
          </button>
          {saved && (
            <span role="status" className={s.small}>
              Сохранено
            </span>
          )}
        </div>
        {targeted && (
          <Note>
            Пишем только тем, у кого Telegram привязан к аккаунту и бот не заблокирован. Один и тот
            же этап повторно не уходит без отметки «повтор».
          </Note>
        )}
      </div>
    </Card>
  );
}

export interface Reaction {
  delivered: number;
  deliveredToUsers: number;
  clicked: number;
  returned: number;
  returned1d: number;
  activeAfter: number;
  answersAfter: number;
  solvedAfter: number;
  conversionPercent: number | null;
}
