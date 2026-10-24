import {
  PeriodCaption,
  PeriodPicker,
  usePeriodQuery,
  type PeriodInfo,
} from '../components/PeriodPicker.js';
import { PageHead } from '../components/Shell.js';
import {
  Badge,
  Card,
  DataTable,
  Note,
  QueryView,
  Segmented,
  type Column,
} from '../components/ui.js';
import { adminApi, toSearch } from '../adminApi.js';
import { num, pct, subjectNames, taskStatusText } from '../format.js';
import { AdminLink, useAdminRouter } from '../router.js';
import { useAdminQuery } from '../useAdminQuery.js';
import s from '../admin.module.css';

// Response shape: apps/api/src/modules/admin/reports/quality.ts
type QualitySignal =
  | 'low_accuracy'
  | 'accuracy_drop'
  | 'complaints'
  | 'abandonment'
  | 'missing_explanation'
  | 'missing_topic'
  | 'choice_without_options'
  | 'published_needs_review';

type QualityItem = {
  id: string;
  subjectId: string;
  taskNumber: number;
  status: string;
  preview: string;
  attempts: number;
  accuracy: number | null;
  previousAccuracy: number | null;
  openComplaints: number;
  signals: { type: QualitySignal; detail: string }[];
};

interface QualityResponse {
  period: PeriodInfo;
  thresholds: {
    minSample: number;
    lowAccuracy: number;
    accuracyDrop: number;
    complaints: number;
    abandonment: number;
  };
  counts: Partial<Record<QualitySignal, number>>;
  items: QualityItem[];
  totalFlagged: number;
}

const signalText: Record<QualitySignal, string> = {
  low_accuracy: 'Очень низкая точность',
  accuracy_drop: 'Резкое падение точности',
  complaints: 'Жалобы',
  abandonment: 'Открывают и не отвечают',
  missing_explanation: 'Нет разбора',
  missing_topic: 'Нет темы',
  choice_without_options: 'Нет вариантов ответа',
  published_needs_review: 'Нужна проверка',
};

const signalOrder = Object.keys(signalText) as QualitySignal[];
const behavioural = new Set<QualitySignal>([
  'low_accuracy',
  'accuracy_drop',
  'complaints',
  'abandonment',
]);

const isSignal = (v: string | null): v is QualitySignal =>
  v !== null && (signalOrder as string[]).includes(v);

export function QualityPage() {
  const { location, setParams } = useAdminRouter();
  const q = usePeriodQuery();
  const query = useAdminQuery<QualityResponse>('/quality', q);
  const raw = location.params.get('signal');
  const signal: QualitySignal | 'all' = isSignal(raw) ? raw : 'all';
  const periodLink = toSearch({ period: q.period, from: q.from, to: q.to });

  const columns: Column<QualityItem>[] = [
    {
      key: 'id',
      label: 'Задание',
      render: (r) => (
        <AdminLink
          className={`${s.link} ${s.mono}`}
          to={`/admin/content/tasks/${r.id}${periodLink}`}
          title={r.preview}
        >
          {r.id.slice(0, 8)}
        </AdminLink>
      ),
    },
    { key: 'subjectId', label: 'Предмет', render: (r) => subjectNames[r.subjectId] ?? r.subjectId },
    { key: 'taskNumber', label: '№', numeric: true },
    {
      key: 'status',
      label: 'Статус',
      render: (r) => (
        <Badge tone={r.status === 'needs_review' ? 'warn' : 'good'}>
          {taskStatusText[r.status] ?? r.status}
        </Badge>
      ),
    },
    { key: 'attempts', label: 'Ответов', numeric: true },
    {
      key: 'accuracy',
      label: 'Точность: сейчас / раньше',
      numeric: true,
      render: (r) => `${pct(r.accuracy)} / ${pct(r.previousAccuracy)}`,
    },
    { key: 'openComplaints', label: 'Открытых жалоб', numeric: true },
    {
      key: 'signals',
      label: 'Сигналы',
      render: (r) => (
        <ul
          className={s.small}
          style={{
            margin: 0,
            paddingLeft: '1rem',
            minWidth: 'min(16rem, 100%)',
            textAlign: 'left',
          }}
        >
          {r.signals.map((sg) => (
            <li key={sg.type}>
              <Badge tone={behavioural.has(sg.type) ? 'warn' : 'info'}>{signalText[sg.type]}</Badge>{' '}
              {sg.detail}
            </li>
          ))}
        </ul>
      ),
    },
  ];

  return (
    <>
      <PageHead
        title="Качество обучения"
        subtitle={query.data && <PeriodCaption period={query.data.period} />}
        actions={
          <>
            <PeriodPicker />
            <a className={s.button} href={adminApi.exportUrl('quality', q)} download>
              CSV
            </a>
          </>
        }
      />
      <Note>
        Сигнал — повод проверить задание, а не вывод, что оно ошибочно. Сложное задание не считается
        ошибкой.
      </Note>
      <QueryView query={query} skeleton={420}>
        {(d) => {
          const t = d.thresholds;
          const items =
            signal === 'all'
              ? d.items
              : d.items.filter((i) => i.signals.some((x) => x.type === signal));
          return (
            <div className={s.grid}>
              <Card
                title="Пороги"
                note="Проверяются опубликованные задания и задания со статусом «нужна проверка»"
                actions={
                  <AdminLink className={s.link} to="/admin/manage">
                    Изменить →
                  </AdminLink>
                }
              >
                <dl className={s.dl}>
                  <dt>Минимальная выборка</dt>
                  <dd>{num(t.minSample)} ответов (и открытий — для «не отвечают»)</dd>
                  <dt>Очень низкая точность</dt>
                  <dd>ниже {pct(t.lowAccuracy)}</dd>
                  <dt>Падение точности</dt>
                  <dd>на {pct(t.accuracyDrop)} и больше к прошлому периоду</dd>
                  <dt>Жалобы</dt>
                  <dd>от {num(t.complaints)} открытых</dd>
                  <dt>Открывают и не отвечают</dt>
                  <dd>от {pct(t.abandonment)} открытий без ответа</dd>
                </dl>
              </Card>
              <Card
                title="Задания, требующие внимания"
                note={`Всего отмечено: ${num(d.totalFlagged)}${d.totalFlagged > d.items.length ? ` · показаны первые ${num(d.items.length)}` : ''}`}
              >
                <div className={s.filters}>
                  <Segmented
                    label="Тип сигнала"
                    value={signal}
                    onChange={(v) => setParams({ signal: v === 'all' ? null : v })}
                    options={[
                      { value: 'all', label: `Все · ${num(d.items.length)}` },
                      ...signalOrder.map((k) => ({
                        value: k,
                        label: `${signalText[k]} · ${num(d.counts[k] ?? 0)}`,
                      })),
                    ]}
                  />
                </div>
                {items.length === 0 ? (
                  <div className={s.state}>Задач, требующих внимания, нет</div>
                ) : (
                  <DataTable
                    caption="Задания с сигналами качества"
                    columns={columns}
                    rows={items}
                    rowKey={(r) => r.id}
                  />
                )}
              </Card>
            </div>
          );
        }}
      </QueryView>
    </>
  );
}
