import { useId, useState } from 'react';
import { groupTopics } from '../../data/topicGroups.js';
import { clsx } from '../../lib/clsx.js';
import { Icon } from '../Icon/Icon.js';
import { Collapse, staggerClassName } from '../motion/motion.js';
import styles from './TopicPicker.module.css';

export interface PickerTopic {
  topicId: string;
  topicName: string;
  topicSlug?: string | null;
  total: number;
  completed: number;
}

export interface TopicPickerProps {
  subjectId: string;
  topics: readonly PickerTopic[];
  selectedId: string | null;
  /** Called with the topic id, or null when the selected topic is tapped again. */
  onSelect: (topicId: string | null) => void;
  /** Signed in: show «решено N из M» per topic. */
  showProgress: boolean;
}

/** Russian plural for «тема»: 1 тема, 2 темы, 5 тем. */
export function themesLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} тема`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} темы`;
  return `${n} тем`;
}

/**
 * «Тема» on the training screen: the subject's real topics grouped into a
 * few collapsible sections (see data/topicGroups.ts) with a search field.
 * Sections start closed (except the one holding the current choice, or
 * the only one); tapping a section header opens/closes it, tapping a topic
 * selects it and tapping it again clears the choice. While searching,
 * every section with a match opens and shows only the matches.
 */
export function TopicPicker({
  subjectId,
  topics,
  selectedId,
  onSelect,
  showProgress,
}: TopicPickerProps) {
  const searchId = useId();
  const [query, setQuery] = useState('');
  const groups = groupTopics(subjectId, topics);
  const selectedGroup = groups.find((g) => g.topics.some((t) => t.topicId === selectedId));
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(
    () => new Set(selectedGroup ? [selectedGroup.group.id] : []),
  );
  const needle = query.trim().toLocaleLowerCase('ru');
  const searching = needle.length > 0;
  const visible = groups
    .map((g) => ({
      ...g,
      shown: searching
        ? g.topics.filter((t) => t.topicName.toLocaleLowerCase('ru').includes(needle))
        : g.topics,
    }))
    .filter((g) => g.shown.length > 0);
  const selected = topics.find((t) => t.topicId === selectedId) ?? null;

  function toggleGroup(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className={styles.picker}>
      <div className={styles.toolbar}>
        <label className={styles.search} htmlFor={searchId}>
          <Icon name="search" size={18} />
          <span className={styles.srOnly}>Поиск темы</span>
          <input
            id={searchId}
            type="search"
            className={styles.searchInput}
            placeholder="Поиск темы…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </label>
        {selected && (
          <button
            type="button"
            className={styles.selectedPill}
            onClick={() => onSelect(null)}
            aria-label={`Снять выбор темы «${selected.topicName}»`}
          >
            <Icon name="check" size={16} />
            <span className={styles.selectedName}>{selected.topicName}</span>
            <Icon name="close" size={14} />
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <p className={styles.empty} role="status">
          По запросу «{query.trim()}» тем не нашлось.
        </p>
      ) : (
        // Remounted per subject/source (keyed by the caller), so the new
        // sections arrive together in one short, capped stagger.
        <div className={clsx(styles.groups, staggerClassName)}>
          {visible.map(({ group, topics: all, shown }) => {
            const open = searching || groups.length === 1 || openIds.has(group.id);
            const panelId = `${searchId}-${group.id}`;
            const hasSelected = all.some((t) => t.topicId === selectedId);
            return (
              <section
                key={group.id}
                className={clsx(styles.group, open && styles.groupOpen)}
                data-has-selected={hasSelected || undefined}
              >
                {groups.length > 1 || searching ? (
                  <button
                    type="button"
                    className={styles.groupHeader}
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => !searching && toggleGroup(group.id)}
                  >
                    <span className={styles.groupIcon} aria-hidden="true">
                      <Icon name={group.icon} size={18} />
                    </span>
                    <span className={styles.groupTitle}>{group.title}</span>
                    <span className={styles.groupCount}>
                      {searching ? `${shown.length} из ${all.length}` : themesLabel(all.length)}
                    </span>
                    <span className={styles.chevron} aria-hidden="true">
                      <Icon name="chevronDown" size={18} />
                    </span>
                  </button>
                ) : null}
                <Collapse open={open}>
                  <ul className={styles.topicList} id={panelId}>
                    {shown.map((topic) => {
                      const isSelected = topic.topicId === selectedId;
                      return (
                        <li key={topic.topicId}>
                          <button
                            type="button"
                            className={clsx(styles.topic, isSelected && styles.topicSelected)}
                            aria-pressed={isSelected}
                            aria-label={topic.topicName}
                            aria-describedby={`${panelId}-${topic.topicId}`}
                            tabIndex={open ? 0 : -1}
                            onClick={() => onSelect(isSelected ? null : topic.topicId)}
                          >
                            <span className={styles.topicMark} aria-hidden="true">
                              {isSelected && <Icon name="check" size={14} />}
                            </span>
                            <span className={styles.topicName}>{topic.topicName}</span>
                            <span id={`${panelId}-${topic.topicId}`} className={styles.topicMeta}>
                              {showProgress
                                ? `${topic.completed}/${topic.total}`
                                : `${topic.total} зад.`}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </Collapse>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
