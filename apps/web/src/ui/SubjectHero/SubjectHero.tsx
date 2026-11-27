import { clsx } from '../../lib/clsx.js';
import { Icon } from '../Icon/Icon.js';
import type { IconName } from '../Icon/icons.js';
import { SubjectIcon } from '../SubjectIcon/SubjectIcon.js';
import styles from './SubjectHero.module.css';

export interface SubjectHeroStat {
  icon: IconName;
  /** Already formatted (`42`, `87%`), or the loading/guest placeholder. */
  value: string;
  label: string;
}

export interface SubjectHeroProps {
  subjectId: string;
  name: string;
  tagline: string;
  /** Subject colour — tints the card's glow. */
  accent: string;
  stats: readonly SubjectHeroStat[];
  /** `compact`: phones — icon beside the title, stats in one row below.
   * `wide`: desktop — icon, title and stats on one line. */
  layout: 'compact' | 'wide';
  /** The page already has an h1 (mobile header): the name is then a p. */
  headingLevel?: 'h1' | 'p';
}

/**
 * The subject page's top card: icon, name, one-line purpose and the two
 * personal numbers. Kept short on purpose — it orients, the modes below
 * are the work.
 */
export function SubjectHero({
  subjectId,
  name,
  tagline,
  accent,
  stats,
  layout,
  headingLevel = 'h1',
}: SubjectHeroProps) {
  const Title = headingLevel;
  return (
    <section
      className={clsx(styles.hero, layout === 'wide' ? styles.wide : styles.compact)}
      style={{ ['--subject-accent' as string]: accent }}
      aria-label={name}
    >
      <span className={styles.art}>
        <SubjectIcon subjectId={subjectId} selected parallax={layout === 'wide'} />
      </span>
      <div className={styles.text}>
        <Title className={styles.name}>{name}</Title>
        <p className={styles.tagline}>{tagline}</p>
      </div>
      <dl className={styles.stats}>
        {stats.map((stat) => (
          <div key={stat.label} className={styles.stat}>
            <dt className={styles.statLabel}>
              <Icon name={stat.icon} size={14} />
              {stat.label}
            </dt>
            <dd className={styles.statValue}>{stat.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
