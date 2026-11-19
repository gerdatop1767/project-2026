import { SEO_AGENT_LABELS, type SeoSettings } from '@zybrilka/shared';
import { useState } from 'react';
import { adminApi, errorText } from '../../adminApi.js';
import { HBars } from '../../components/charts.js';
import { PageHead } from '../../components/Shell.js';
import { Card, ConfirmDialog, DataTable, Kpi, Note, QueryView } from '../../components/ui.js';
import { num } from '../../format.js';
import { useAdminQuery } from '../../useAdminQuery.js';
import { InfoTile, SeoTabs, TaskStatus, taskKindText, usd } from './common.js';
import s from '../../admin.module.css';

interface Task {
  id: string;
  kind: string;
  agent: string;
  status: string;
  error: string | null;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  runAfter: string;
}
interface AgentData {
  settings: SeoSettings;
  anthropicConfigured: boolean;
  status: {
    usage: {
      dayCost: number;
      weekCost: number;
      monthCost: number;
      dayCalls: number;
      monthCalls: number;
      monthIn: number;
      monthOut: number;
    };
    tasks: {
      queued: number;
      running: number;
      doneToday: number;
      failedToday: number;
      lastStarted: string | null;
      nextRun: string | null;
    };
    made: { articles: number; posts: number; topics: number; keywords: number };
    heartbeat: {
      value: { at: string; enabled: boolean; stopped: boolean; ai: boolean };
      at: string;
    } | null;
    /** Seconds since the worker's last heartbeat (server clock). */
    heartbeatAgeSeconds: number | null;
  };
  recentTasks: Task[];
}
interface LogItem {
  id: string;
  at: string;
  agent: string;
  level: string;
  action: string;
  message: string;
}

const SUBJECTS: [string, string][] = [
  ['math', 'Математика'],
  ['russian', 'Русский язык'],
];
const dt = (v: string | null) =>
  v ? new Date(v).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—';

function SettingsForm({ initial, onSaved }: { initial: SeoSettings; onSaved: () => void }) {
  const [form, setForm] = useState<SeoSettings>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmAuto, setConfirmAuto] = useState(false);
  const set = <K extends keyof SeoSettings>(k: K, v: SeoSettings[K]) => {
    setSaved(false);
    setForm((f) => ({ ...f, [k]: v }));
  };
  const toggle = <T extends string>(list: T[], v: T) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  const save = async (confirm = false) => {
    setError(null);
    const patch: Partial<SeoSettings> = { ...form };
    delete patch.priorityWeights;
    delete patch.emergencyStop;
    try {
      await adminApi.put('/seo/settings', { settings: patch, confirm });
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const numberField = (k: keyof SeoSettings, label: string, step = 1) => (
    <label className={s.field}>
      {label}
      <input
        className={s.input}
        type="number"
        step={step}
        min={0}
        value={String(form[k])}
        onChange={(e) => set(k, Number(e.target.value) as never)}
      />
    </label>
  );
  return (
    <Card title="Настройки агента">
      <div className={s.grid}>
        <label className={s.switchRow}>
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => set('enabled', e.target.checked)}
          />
          <span className={s.switchLabel}>Агент включён (ежедневный цикл по расписанию)</span>
        </label>
        <label className={s.switchRow}>
          <input
            type="checkbox"
            checked={form.publishingPaused}
            onChange={(e) => set('publishingPaused', e.target.checked)}
          />
          <span className={s.switchLabel}>
            Пауза публикаций (агент пишет, но ничего не публикует)
          </span>
        </label>
        <label className={s.field}>
          Режим работы
          <select
            className={s.select}
            value={form.mode}
            onChange={(e) => set('mode', e.target.value as SeoSettings['mode'])}
          >
            <option value="manual">Ручной — идеи и черновики, без публикации</option>
            <option value="semi">Полуавтоматический — публикация после одобрения</option>
            <option value="auto">Автономный — публикует сам (с лимитами)</option>
          </select>
        </label>
        <div className={s.cols3}>
          {numberField('articlesPerDay', 'Статей в день')}
          <label className={s.field}>
            Время дневного цикла (МСК)
            <input
              className={s.input}
              type="time"
              value={form.dailyRunTime}
              onChange={(e) => set('dailyRunTime', e.target.value)}
            />
          </label>
          <label className={s.field}>
            Время публикации (МСК)
            <input
              className={s.input}
              type="time"
              value={form.publishTime}
              onChange={(e) => set('publishTime', e.target.value)}
            />
          </label>
          {numberField('maxExternalPostsPerDay', 'Внешних публикаций в сутки, макс.')}
          {numberField('maxImagesPerArticle', 'Изображений в статье, макс.')}
          {numberField('minTopicPriority', 'Мин. SEO-приоритет темы (0–100)')}
          {numberField('monthlyBudgetUsd', 'Бюджет AI в месяц, $', 1)}
          {numberField('dailyBudgetUsd', 'Бюджет AI в день, $', 0.5)}
          {numberField('maxSearchesPerResearch', 'Веб-поисков на исследование, макс.')}
        </div>
        <fieldset className={s.field}>
          <legend>Приоритетные предметы</legend>
          {SUBJECTS.map(([id, label]) => (
            <label key={id} className={s.switchRow}>
              <input
                type="checkbox"
                checked={form.prioritySubjects.includes(id)}
                onChange={() => set('prioritySubjects', toggle(form.prioritySubjects, id))}
              />
              <span className={s.switchLabel}>{label}</span>
            </label>
          ))}
          <span className={s.small}>
            Другие предметы появятся, когда на платформе будут их задания.
          </span>
        </fieldset>
        <fieldset className={s.field}>
          <legend>Поисковые системы</legend>
          {(['yandex', 'google'] as const).map((e) => (
            <label key={e} className={s.switchRow}>
              <input
                type="checkbox"
                checked={form.searchEngines.includes(e)}
                onChange={() => set('searchEngines', toggle(form.searchEngines, e))}
              />
              <span className={s.switchLabel}>{e === 'yandex' ? 'Яндекс' : 'Google'}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className={s.field}>
          <legend>Языки публикаций</legend>
          {(['ru', 'en'] as const).map((l) => (
            <label key={l} className={s.switchRow}>
              <input
                type="checkbox"
                checked={form.languages.includes(l)}
                onChange={() => set('languages', toggle(form.languages, l))}
              />
              <span className={s.switchLabel}>
                {l === 'ru' ? 'Русский' : 'Английский (Reddit и др.)'}
              </span>
            </label>
          ))}
        </fieldset>
        <div className={s.cols2}>
          <label className={s.field}>
            Сильная модель (статьи, факт-чек, стратегия)
            <input
              className={s.input}
              value={form.strongModel}
              onChange={(e) => set('strongModel', e.target.value)}
            />
          </label>
          <label className={s.field}>
            Дешёвая модель (классификация, структура)
            <input
              className={s.input}
              value={form.cheapModel}
              onChange={(e) => set('cheapModel', e.target.value)}
            />
          </label>
        </div>
        <p className={s.small}>
          Веса SEO-приоритета агент пересчитывает сам по реальным результатам статей:{' '}
          {Object.entries(form.priorityWeights)
            .map(([k, v]) => `${k} ${v}`)
            .join(' · ')}
        </p>
        {error && <p className={s.down}>{error}</p>}
        <div className={s.toolbar}>
          <button
            type="button"
            className={`${s.button} ${s.buttonPrimary}`}
            onClick={() =>
              form.mode === 'auto' && initial.mode !== 'auto' ? setConfirmAuto(true) : void save()
            }
          >
            Сохранить
          </button>
          {saved && <span className={s.up}>Сохранено</span>}
        </div>
      </div>
      <ConfirmDialog
        open={confirmAuto}
        title="Включить автономный режим?"
        confirmLabel="Включить"
        onClose={() => setConfirmAuto(false)}
        onConfirm={() => save(true)}
      >
        Агент будет сам публиковать статьи на zybrilka.ru/blog и посты в подключённых каналах —
        только прошедшие факт-чек и проверку качества, в пределах бюджета и лимитов.
      </ConfirmDialog>
    </Card>
  );
}

export function SeoAgentPage() {
  const query = useAdminQuery<AgentData>('/seo/agent');
  const usage = useAdminQuery<{
    byAgent: { agent: string; model: string; cost: number; calls: number; webSearches: number }[];
  }>('/seo/usage', { days: 30 });
  const [logAgent, setLogAgent] = useState('');
  const [logLevel, setLogLevel] = useState('');
  const log = useAdminQuery<{ items: LogItem[] }>('/seo/log', {
    agent: logAgent || undefined,
    level: logLevel || undefined,
    pageSize: 50,
  });
  const [stopOpen, setStopOpen] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async (kind: string) => {
    setMsg(null);
    try {
      await adminApi.post('/seo/agent/run', { kind });
      setMsg('Задача поставлена в очередь — worker возьмёт её в течение минуты.');
      query.reload();
    } catch (e) {
      setMsg(errorText(e));
    }
  };
  const taskAction = async (id: string, action: 'retry' | 'cancel') => {
    try {
      await adminApi.post(`/seo/tasks/${id}/${action}`, {});
      query.reload();
    } catch (e) {
      setMsg(errorText(e));
    }
  };
  return (
    <>
      <PageHead
        title="AI Agent"
        subtitle={<p className={s.subtitle}>Управление автономным SEO-агентом</p>}
        actions={
          <>
            <button type="button" className={s.button} onClick={() => run('daily')}>
              Запустить цикл сейчас
            </button>
            <button
              type="button"
              className={`${s.button} ${s.buttonDanger}`}
              onClick={() => setStopOpen(true)}
            >
              Остановить всё
            </button>
          </>
        }
      />
      <SeoTabs />
      {msg && <Note>{msg}</Note>}
      <QueryView query={query} skeleton={420}>
        {(d) => {
          const hb = d.status.heartbeat;
          const alive =
            hb !== null &&
            d.status.heartbeatAgeSeconds !== null &&
            d.status.heartbeatAgeSeconds < 180;
          const state = d.settings.emergencyStop
            ? 'Аварийно остановлен'
            : !d.settings.enabled
              ? 'Выключен'
              : !alive
                ? 'Worker не отвечает'
                : 'Работает';
          return (
            <>
              {d.settings.emergencyStop && (
                <Note>
                  Агент остановлен аварийной кнопкой: ничего не планируется, не берётся из очереди и
                  не отправляется в AI.{' '}
                  <button type="button" className={s.button} onClick={() => setResumeOpen(true)}>
                    Снять остановку
                  </button>
                </Note>
              )}
              {!d.anthropicConfigured && (
                <Note>
                  Claude API не подключён: задайте ANTHROPIC_API_KEY в окружении worker. Задачи,
                  которым нужен AI, ждут в статусе «остановлена».
                </Note>
              )}
              <div className={s.kpis}>
                <InfoTile
                  label="Статус"
                  value={state}
                  hint={`режим: ${{ manual: 'ручной', semi: 'полуавтоматический', auto: 'автономный' }[d.settings.mode]}${d.settings.publishingPaused ? ' · публикации на паузе' : ''}`}
                />
                <InfoTile label="Последний запуск задачи" value={dt(d.status.tasks.lastStarted)} />
                <InfoTile
                  label="Следующий запуск"
                  value={
                    d.status.tasks.queued
                      ? dt(d.status.tasks.nextRun)
                      : `${d.settings.dailyRunTime} МСК`
                  }
                  hint={d.status.tasks.queued ? 'задача в очереди' : 'дневной цикл'}
                />
                <Kpi
                  label="Выполнено за 24 ч"
                  value={d.status.tasks.doneToday}
                  hint={`в очереди ${d.status.tasks.queued}, выполняется ${d.status.tasks.running}`}
                />
                <Kpi label="Ошибок за 24 ч" value={d.status.tasks.failedToday} />
                <Kpi
                  label="Расход сегодня"
                  value={d.status.usage.dayCost}
                  format={usd}
                  hint={`лимит ${usd(d.settings.dailyBudgetUsd)}`}
                />
                <Kpi label="Расход за 7 дней" value={d.status.usage.weekCost} format={usd} />
                <Kpi
                  label="Расход за месяц"
                  value={d.status.usage.monthCost}
                  format={usd}
                  hint={`бюджет ${usd(d.settings.monthlyBudgetUsd)}`}
                />
                <Kpi
                  label="AI-запросов за месяц"
                  value={d.status.usage.monthCalls}
                  hint={`сегодня ${num(d.status.usage.dayCalls)}`}
                />
                <Kpi
                  label="Токенов за месяц"
                  value={d.status.usage.monthIn + d.status.usage.monthOut}
                  hint={`вход ${num(d.status.usage.monthIn)} · выход ${num(d.status.usage.monthOut)}`}
                />
                <Kpi
                  label="Создано материалов"
                  value={d.status.made.articles + d.status.made.posts}
                  hint={`статей ${d.status.made.articles} · постов ${d.status.made.posts} · тем ${d.status.made.topics} · запросов ${d.status.made.keywords}`}
                />
              </div>
              <div className={s.toolbar}>
                {(['research', 'sync_metrics', 'technical_audit', 'weekly'] as const).map((k) => (
                  <button key={k} type="button" className={s.button} onClick={() => run(k)}>
                    {
                      {
                        research: 'Исследование тем',
                        sync_metrics: 'Синхронизировать метрики',
                        technical_audit: 'Технический аудит',
                        weekly: 'Недельная стратегия',
                      }[k]
                    }
                  </button>
                ))}
              </div>
              <SettingsForm
                key={JSON.stringify(d.settings)}
                initial={d.settings}
                onSaved={query.reload}
              />
              <Card title="Последние задачи">
                <DataTable<Task & Record<string, unknown>>
                  caption="Задачи агента"
                  rows={d.recentTasks as (Task & Record<string, unknown>)[]}
                  rowKey={(t) => t.id}
                  columns={[
                    { key: 'kind', label: 'Задача', render: (t) => taskKindText[t.kind] ?? t.kind },
                    {
                      key: 'status',
                      label: 'Статус',
                      render: (t) => <TaskStatus status={t.status} />,
                    },
                    {
                      key: 'attempts',
                      label: 'Попытки',
                      numeric: true,
                      render: (t) => `${t.attempts}/${t.maxAttempts}`,
                    },
                    { key: 'createdAt', label: 'Создана', render: (t) => dt(t.createdAt) },
                    {
                      key: 'error',
                      label: 'Ошибка',
                      render: (t) => <span className={s.small}>{t.error ?? ''}</span>,
                    },
                    {
                      key: 'act',
                      label: '',
                      render: (t) =>
                        ['failed', 'blocked', 'cancelled'].includes(t.status) ? (
                          <button
                            type="button"
                            className={s.button}
                            onClick={() => taskAction(t.id, 'retry')}
                          >
                            Повторить
                          </button>
                        ) : t.status === 'queued' ? (
                          <button
                            type="button"
                            className={s.button}
                            onClick={() => taskAction(t.id, 'cancel')}
                          >
                            Отменить
                          </button>
                        ) : null,
                    },
                  ]}
                />
              </Card>
            </>
          );
        }}
      </QueryView>
      <div className={s.cols2}>
        <Card title="Расходы по агентам за 30 дней">
          <QueryView
            query={usage}
            skeleton={160}
            isEmpty={(u) => u.byAgent.length === 0}
            empty="AI ещё не вызывался."
          >
            {(u) => (
              <HBars
                items={u.byAgent.map((a) => ({
                  label: `${SEO_AGENT_LABELS[a.agent as keyof typeof SEO_AGENT_LABELS] ?? a.agent} · ${a.model}`,
                  value: Math.round(a.cost * 1000) / 1000,
                  detail: `${usd(a.cost)} · ${a.calls} вызовов · ${a.webSearches} поисков`,
                }))}
              />
            )}
          </QueryView>
        </Card>
        <Card
          title="Журнал действий"
          actions={
            <div className={s.toolbar}>
              <select
                className={s.select}
                aria-label="Агент"
                value={logAgent}
                onChange={(e) => setLogAgent(e.target.value)}
              >
                <option value="">Все агенты</option>
                {Object.entries(SEO_AGENT_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <select
                className={s.select}
                aria-label="Уровень"
                value={logLevel}
                onChange={(e) => setLogLevel(e.target.value)}
              >
                <option value="">Все</option>
                <option value="warn">Предупреждения</option>
                <option value="error">Ошибки</option>
              </select>
            </div>
          }
        >
          <QueryView
            query={log}
            skeleton={200}
            isEmpty={(l) => l.items.length === 0}
            empty="Действий пока нет."
          >
            {(l) => (
              <ul className={s.grid} style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {l.items.map((i) => (
                  <li key={i.id} className={s.small}>
                    <span className={s.muted}>
                      {dt(i.at)} ·{' '}
                      {SEO_AGENT_LABELS[i.agent as keyof typeof SEO_AGENT_LABELS] ?? i.agent}
                    </span>
                    <br />
                    <span className={i.level === 'error' ? s.down : undefined}>{i.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </QueryView>
        </Card>
      </div>
      <ConfirmDialog
        open={stopOpen}
        danger
        title="Остановить все процессы агента?"
        confirmLabel="Остановить всё"
        onClose={() => setStopOpen(false)}
        onConfirm={async () => {
          await adminApi.post('/seo/agent/stop', {});
          query.reload();
        }}
      >
        Очередь будет очищена, новые задачи не будут создаваться, вызовы AI запрещены. Уже
        опубликованное останется на сайте.
      </ConfirmDialog>
      <ConfirmDialog
        open={resumeOpen}
        title="Снять аварийную остановку?"
        confirmLabel="Возобновить"
        onClose={() => setResumeOpen(false)}
        onConfirm={async () => {
          await adminApi.put('/seo/settings', {
            settings: { emergencyStop: false },
            confirm: true,
          });
          query.reload();
        }}
      >
        Агент продолжит работу по расписанию и настройкам.
      </ConfirmDialog>
    </>
  );
}
