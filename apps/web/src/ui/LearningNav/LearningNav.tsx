import { useNavigation, type Route } from '../../lib/navigation.js';
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
 * Phone: a compact pill «← Учебный центр» (on the centre itself
 * «← Назад», which closes it) that stays at the top while reading —
 * these screens are full-screen takeovers without the bottom bar, so
 * this is the visible way out. Desktop: a breadcrumb trail
 * «Учебный центр › Теория › №5» with every step clickable.
 *
 * Never a sign-out: it only moves between pages.
 */
export function LearningNav({ trail }: { trail: readonly LearningCrumb[] }) {
  const { navigate, back } = useNavigation();
  const atCenter = trail.length <= 1;
  const parent = atCenter ? null : (trail[0] ?? LEARNING_CENTER_CRUMB);

  return (
    <nav className={styles.nav} aria-label="Навигация по учебному центру">
      <button
        type="button"
        className={styles.pill}
        onClick={() => (parent?.route ? navigate(parent.route) : back())}
        data-testid="learning-back"
      >
        <Icon name="back" size={16} />
        <span>{parent ? parent.label : 'Назад'}</span>
      </button>
      {!atCenter && (
        <ol className={styles.crumbs}>
          {trail.map((crumb, i) => {
            const last = i === trail.length - 1;
            return (
              <li key={`${i}-${crumb.label}`}>
                {crumb.route && !last ? (
                  <button
                    type="button"
                    className={styles.crumbLink}
                    onClick={() => navigate(crumb.route!)}
                  >
                    {i === 0 && <Icon name="back" size={14} />}
                    {crumb.label}
                  </button>
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
