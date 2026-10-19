import { useId, useState } from 'react';
import { subjects as allSubjects, type Subject } from '../../data/subjects.js';
import { clsx } from '../../lib/clsx.js';
import { useIsDesktop } from '../../lib/useIsDesktop.js';
import { useTaskCountsBySubject } from '../../lib/useTaskCounts.js';
import { BottomSheet } from '../BottomSheet/BottomSheet.js';
import { Icon } from '../Icon/Icon.js';
import { Modal } from '../Modal/Modal.js';
import { SubjectIcon } from '../SubjectIcon/SubjectIcon.js';
import styles from './SubjectPicker.module.css';

/** "1 задание", "3 задания", "12 заданий". */
function tasksLabel(count: number): string {
  const n10 = count % 10;
  const n100 = count % 100;
  const word =
    n10 === 1 && n100 !== 11
      ? 'задание'
      : n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)
        ? 'задания'
        : 'заданий';
  return `${count.toLocaleString('ru-RU')} ${word}`;
}

interface SubjectOptionListBaseProps {
  /** Which subjects to offer (default: all, in their usual order). */
  subjects?: readonly Subject[];
  /** Accessible name of the group, e.g. "Предмет". */
  'aria-label': string;
  className?: string;
}

export type SubjectOptionListProps = SubjectOptionListBaseProps &
  (
    | { multiple?: false; value: string | null; onSelect: (id: string) => void }
    | { multiple: true; value: readonly string[]; onSelect: (id: string) => void }
  );

/**
 * The app's one way to pick a subject: a vertical list of large cards —
 * the subject's own approved artwork on the left (SubjectIcon, the same
 * pictures used everywhere else), its name and its real number of
 * published tasks, and a clear selection mark on the right (a radio dot,
 * or a check for multi-select).
 *
 * Selection is shown the instant the card is pressed — it is plain props,
 * never waiting for a request or an animation. Each card is a real button
 * with `role="radio"`/`"checkbox"`, so it works from the keyboard and reads
 * correctly to screen readers.
 */
export function SubjectOptionList(props: SubjectOptionListProps) {
  const { subjects = allSubjects, className } = props;
  const counts = useTaskCountsBySubject();
  const isSelected = (id: string) =>
    props.multiple ? props.value.includes(id) : props.value === id;

  return (
    <div
      className={clsx(styles.list, className)}
      role={props.multiple ? 'group' : 'radiogroup'}
      aria-label={props['aria-label']}
    >
      {subjects.map((subject) => {
        const selected = isSelected(subject.id);
        const count = counts ? (counts[subject.id] ?? 0) : null;
        return (
          <button
            key={subject.id}
            type="button"
            role={props.multiple ? 'checkbox' : 'radio'}
            aria-checked={selected}
            className={styles.option}
            data-selected={selected || undefined}
            data-subject-interactive
            onClick={() => props.onSelect(subject.id)}
          >
            <span className={styles.art}>
              <SubjectIcon subjectId={subject.id} selected={selected} />
            </span>
            <span className={styles.text}>
              <span className={styles.name}>{subject.name}</span>
              <span className={styles.caption}>
                {count === null ? '···' : count > 0 ? tasksLabel(count) : 'Задания скоро появятся'}
              </span>
            </span>
            <span
              className={clsx(styles.mark, props.multiple && styles.markSquare)}
              aria-hidden="true"
            >
              {props.multiple && <Icon name="check" size={14} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export interface SubjectPickerDialogProps {
  open: boolean;
  onClose: () => void;
  value: string | null;
  /** Called with the picked subject; the dialog closes right after. */
  onSelect: (id: string) => void;
  title?: string;
  subtitle?: string;
  subjects?: readonly Subject[];
}

/**
 * The subject list in a sheet (mobile, Telegram) or a centred dialog
 * (desktop). Picking a subject selects it and closes at once; the list
 * scrolls inside the panel when it is taller than the screen.
 */
export function SubjectPickerDialog({
  open,
  onClose,
  value,
  onSelect,
  title = 'Предмет',
  subtitle = 'Выбери предмет, по которому будешь решать задания',
  subjects,
}: SubjectPickerDialogProps) {
  const isDesktop = useIsDesktop();
  const body = (
    <div className={styles.dialogBody}>
      {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      <SubjectOptionList
        aria-label={title}
        subjects={subjects}
        value={value}
        onSelect={(id) => {
          onSelect(id);
          onClose();
        }}
      />
    </div>
  );
  return isDesktop ? (
    <Modal open={open} onClose={onClose} title={title} wide>
      {body}
    </Modal>
  ) : (
    <BottomSheet open={open} onClose={onClose} title={title}>
      {body}
    </BottomSheet>
  );
}

export interface SubjectSelectProps {
  value: string;
  onChange: (id: string) => void;
  /** Small caption above the field (e.g. "Предмет"). */
  label?: string;
  subjects?: readonly Subject[];
  className?: string;
}

/**
 * A form field for the subject: shows the chosen subject (artwork + name)
 * and opens the shared subject list. Replaces the plain text dropdowns
 * that used to pick a subject in Тренировка, По номерам, Статистика and
 * Мои ошибки.
 */
export function SubjectSelect({
  value,
  onChange,
  label,
  subjects = allSubjects,
  className,
}: SubjectSelectProps) {
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const selected = subjects.find((s) => s.id === value) ?? null;

  return (
    <div className={clsx(styles.field, className)}>
      {label && (
        <span id={labelId} className={clsx('text-label', styles.label)}>
          {label}
        </span>
      )}
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={label ? `${labelId} ${labelId}-value` : undefined}
        onClick={() => setOpen(true)}
      >
        {selected && (
          <span className={styles.triggerArt}>
            <SubjectIcon subjectId={selected.id} />
          </span>
        )}
        <span id={`${labelId}-value`} className={styles.triggerText}>
          {selected ? selected.name : 'Выберите предмет'}
        </span>
        <Icon name="chevronDown" size={18} className={styles.chevron} />
      </button>
      <SubjectPickerDialog
        open={open}
        onClose={() => setOpen(false)}
        value={value}
        onSelect={onChange}
        title={label ?? 'Предмет'}
        subjects={subjects}
      />
    </div>
  );
}
