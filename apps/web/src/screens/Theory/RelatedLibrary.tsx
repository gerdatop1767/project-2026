import { libraryItems, type LibrarySubject } from '../../data/library/library.js';
import { useNavigation } from '../../lib/navigation.js';
import { Icon } from '../../ui/Icon/Icon.js';
import styles from './RelatedLibrary.module.css';

/**
 * «Ещё по заданию №N»: library materials and strategies that list this
 * task number. Links only — the texts stay where they are, nothing is
 * copied into the theory.
 */
export function RelatedLibrary({
  subject,
  taskNumber,
}: {
  subject: Exclude<LibrarySubject, 'general'>;
  taskNumber: number;
}) {
  const { navigate } = useNavigation();
  const related = libraryItems.filter(
    (x) => x.subject === subject && x.tasks?.includes(taskNumber),
  );
  if (related.length === 0) return null;
  return (
    <section className={styles.related} aria-labelledby={`related-${subject}-${taskNumber}`}>
      <h3 id={`related-${subject}-${taskNumber}`} className={styles.title}>
        Ещё по заданию №{taskNumber}
      </h3>
      <ul className={styles.list}>
        {related.map((item) => (
          <li key={item.id}>
            <a
              className={styles.link}
              href={`/${item.section}?id=${encodeURIComponent(item.id)}`}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                navigate({ screen: 'library', section: item.section, itemId: item.id });
              }}
            >
              <span className={styles.kind}>
                {item.section === 'strategies' ? 'Стратегия' : 'Материал'}
              </span>
              <span className={styles.name}>{item.title}</span>
              <Icon name="arrowRight" size={16} className={styles.arrow} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
