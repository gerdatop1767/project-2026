import { onLinkClick } from '../../lib/linkClick.js';
import { previousAppPath, useNavigation, type Route } from '../../lib/navigation.js';
import { pathForRoute } from '../../lib/routes.js';
import { Icon } from '../Icon/Icon.js';
import styles from './LearningNav.module.css';

export interface LearningCrumb {
  label: string;
  /** Where the crumb leads; the last crumb (the current page) has none. */
  route?: Route;
}

export const LEARNING_CENTER_CRUMB: LearningCrumb = {
  label: 'Учебный центр',
  route: { screen: 'learningCenter' },
};

/**
 * Navigation shared by every learning-centre page (центр, теория,
 * материалы, стратегии and their inner pages).
 *
 * Phone: a compact pill that stays at the top while reading — these
 * screens are full-screen takeovers without the bottom bar, so this is the
 * visible way out. It is a real Back: it returns to the screen the student
 * actually came from (and so does the system Back on Android/iOS). Opened
 * by a direct link or a refresh with nothing of ours behind it, it goes to
 * the learning centre instead. Its label names where it leads: the crumb
 * that is the previous page, «Назад» for any other previous page, or
 * «Учебный центр». On the centre itself «← Назад» closes it.
 *
 * Desktop: a breadcrumb trail «Учебный центр › Теория › №5» with every step
 * clickable. A crumb that is the previous page goes Back rather than
 * stacking a second copy of it.
 *
 * Never a sign-out: it only moves between pages.
 */
export function LearningNav({ trail }: { trail: readonly LearningCrumb[] }) {
  const { back, leave, backTo } = useNavigation();
  const atCenter = trail.length <= 1;
  const parent = atCenter ? null : (trail[0] ?? LEARNING_CENTER_CRUMB);
  const prev = atCenter ? null : previousAppPath();
  const pillLabel = !parent
    ? 'Назад'
    : prev === null
      ? parent.label
      : (trail.find((c) => c.route && pathForRoute(c.route) === prev)?.label ?? 'Назад');

  return (
    <nav className={styles.nav} aria-label="Навигация по учебному центру">
      {parent?.route ? (
        <a
          href={pathForRoute(parent.route) ?? undefined}
          className={styles.pill}
          onClick={(e) => onLinkClick(e, () => leave(parent.route!))}
          data-testid="learning-back"
        >
          <Icon name="back" size={16} />
          <span>{pillLabel}</span>
        </a>
      ) : (
        <button type="button" className={styles.pill} onClick={back} data-testid="learning-back">
          <Icon name="back" size={16} />
          <span>Назад</span>
        </button>
      )}
      {!atCenter && (
        <ol className={styles.crumbs}>
          {trail.map((crumb, i) => {
            const last = i === trail.length - 1;
            return (
              <li key={`${i}-${crumb.label}`}>
                {crumb.route && !last ? (
                  <a
                    href={pathForRoute(crumb.route) ?? undefined}
                    className={styles.crumbLink}
                    onClick={(e) => onLinkClick(e, () => backTo(crumb.route!))}
                  >
                    {i === 0 && <Icon name="back" size={14} />}
                    {crumb.label}
                  </a>
                ) : (
                  <span className={styles.current} aria-current={last ? 'page' : undefined}>
                    {crumb.label}
                  </span>
                )}
                {!last && <Icon name="chevronRight" size={14} className={styles.sep} />}
              </li>
            );
          })}
        </ol>
      )}
    </nav>
  );
}
