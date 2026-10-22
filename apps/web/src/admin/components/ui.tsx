import { useState, type ReactNode } from 'react';
import { clsx } from '../../lib/clsx.js';
import { Modal } from '../../ui/Modal/Modal.js';
import { errorText } from '../adminApi.js';
import { changeText, num, NO_DATA } from '../format.js';
import type { QueryState } from '../useAdminQuery.js';
import s from '../admin.module.css';

export function Card({
  title,
  note,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  note?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx(s.card, className)}>
      {(title || actions) && (
        <div className={s.cardHead}>
          <div>
            {title && <h2 className={s.cardTitle}>{title}</h2>}
            {note && <p className={s.cardNote}>{note}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export interface Compare {
  current: number;
  previous: number;
  changePercent: number | null;
}

/** A stat tile. `value: null` renders «нет данных», never 0. */
export function Kpi({
  label,
  value,
  compare,
  hint,
  format = num,
}: {
  label: string;
  value: number | null | undefined;
  compare?: Compare;
  hint?: string;
  format?: (v: number | null | undefined) => string;
}) {
  const change = compare?.changePercent ?? null;
  const unknown = value === null || value === undefined;
  return (
    <div className={s.kpi}>
      <span className={s.kpiLabel}>{label}</span>
      <span className={clsx(s.kpiValue, unknown && s.kpiValueMuted)}>{format(value)}</span>
      {compare && (
        <span className={s.kpiChange}>
          <span
            className={clsx(
              change !== null && change > 0 && s.up,
              change !== null && change < 0 && s.down,
            )}
          >
            {changeText(change)}
          </span>
          {change !== null && <> · было {num(compare.previous)}</>}
        </span>
      )}
      {hint && <span className={s.kpiChange}>{hint}</span>}
    </div>
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info';
  children: ReactNode;
}) {
  return (
    <span
      className={clsx(
        s.badge,
        tone === 'good' && s.badgeGood,
        tone === 'warn' && s.badgeWarn,
        tone === 'bad' && s.badgeBad,
        tone === 'info' && s.badgeInfo,
      )}
    >
      {children}
    </span>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <p className={s.note} role="note">
      <span aria-hidden="true">ℹ︎</span>
      <span>{children}</span>
    </p>
  );
}

/** Where guest/event numbers come from — shown wherever they appear. */
export function GuestDataNote({
  coverage,
  since,
}: {
  coverage: 'none' | 'partial' | 'full';
  since: string | null;
}) {
  if (coverage === 'full') return null;
  return (
    <Note>
      {coverage === 'none'
        ? 'Гостевые визиты и события за этот период не записывались — сбор начался позже. Такие показатели помечены «нет данных».'
        : `Гостевые визиты и события собираются с ${since ? new Date(since.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')).toLocaleDateString('ru-RU') : '—'}: за более раннюю часть периода их нет. Данные зарегистрированных пользователей — за всю историю.`}
    </Note>
  );
}

export function Skeleton({ height = 96 }: { height?: number }) {
  return <div className={s.skeleton} style={{ height }} aria-hidden="true" />;
}

/**
 * Loading / error / ready for one query. While a refresh runs, the old
 * data stays visible (no flashing); an error with old data shows both.
 */
export function QueryView<T>({
  query,
  children,
  skeleton = 240,
  isEmpty,
  empty = 'Пока нет данных.',
}: {
  query: QueryState<T> & { reload: () => void };
  children: (data: T) => ReactNode;
  skeleton?: number;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
}) {
  if (query.data === null) {
    if (query.status === 'error') return <ErrorState error={query.error} onRetry={query.reload} />;
    return (
      <div role="status" aria-label="Загрузка">
        <Skeleton height={skeleton} />
      </div>
    );
  }
  return (
    <div aria-busy={query.status === 'loading'}>
      {query.status === 'error' && (
        <ErrorState error={query.error} onRetry={query.reload} compact />
      )}
      {isEmpty?.(query.data) ? <div className={s.state}>{empty}</div> : children(query.data)}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  compact,
}: {
  error: unknown;
  onRetry?: () => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? s.note : s.state} role="alert">
      <span>{errorText(error)}</span>
      {onRetry && (
        <button type="button" className={s.button} onClick={onRetry}>
          Повторить
        </button>
      )}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className={s.segmented} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={clsx(s.segment, o.value === value && s.segmentActive)}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export interface Column<R> {
  key: string;
  label: string;
  numeric?: boolean;
  /** Server sort key; the header becomes a button. */
  sort?: string;
  render?: (row: R) => ReactNode;
}

export function DataTable<R extends Record<string, unknown>>({
  columns,
  rows,
  rowKey,
  caption,
  sort,
  dir,
  onSort,
}: {
  columns: Column<R>[];
  rows: R[];
  rowKey: (row: R) => string;
  caption: string;
  sort?: string;
  dir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
}) {
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <caption className={s.srOnly}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={c.numeric ? s.num : undefined}
                scope="col"
                aria-sort={
                  c.sort && c.sort === sort
                    ? dir === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : undefined
                }
              >
                {c.sort && onSort ? (
                  <button type="button" className={s.sortButton} onClick={() => onSort(c.sort!)}>
                    {c.label}
                    <span aria-hidden="true">
                      {c.sort === sort ? (dir === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key} className={c.numeric ? s.num : undefined}>
                  {c.render ? c.render(row) : formatCell(row[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(value: unknown): ReactNode {
  if (value === null || value === undefined) return <span className={s.muted}>—</span>;
  if (typeof value === 'number') return num(value);
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav className={s.pager} aria-label="Страницы">
      <span>
        {total === 0
          ? 'Ничего не найдено'
          : `${num((page - 1) * pageSize + 1)}–${num(Math.min(total, page * pageSize))} из ${num(total)}`}
      </span>
      <span className={s.toolbar}>
        <button
          type="button"
          className={s.button}
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          ← Назад
        </button>
        <span>
          {page} / {pages}
        </span>
        <button
          type="button"
          className={s.button}
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Дальше →
        </button>
      </span>
    </nav>
  );
}

/**
 * Confirmation for actions that change what users see or sign someone
 * out. The server additionally requires `confirm: true`.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} title={title}>
      <div className={s.grid}>
        <div className={s.small}>{children}</div>
        {error !== null && <ErrorState error={error} compact />}
        <div className={s.toolbar}>
          <button
            type="button"
            className={clsx(s.button, danger ? s.buttonDanger : s.buttonPrimary)}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm();
                onClose();
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Подождите…' : confirmLabel}
          </button>
          <button type="button" className={s.button} disabled={busy} onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function ValueOrNoData({ value }: { value: ReactNode | null | undefined }) {
  return (
    <>
      {value === null || value === undefined ? <span className={s.muted}>{NO_DATA}</span> : value}
    </>
  );
}
