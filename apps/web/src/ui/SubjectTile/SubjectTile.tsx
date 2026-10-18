import { clsx } from '../../lib/clsx.js';
import type { SubjectGlyph } from '../../data/subjects.js';
import { SubjectIcon } from '../SubjectIcon/SubjectIcon.js';
import type { SubjectIconId } from '../SubjectIcon/subjectIcons.js';
import styles from './SubjectTile.module.css';

export interface SubjectTileProps {
  glyph: SubjectGlyph;
  size?: number;
  /** Persistent glow + thin outline for the currently chosen subject. */
  selected?: boolean;
  className?: string;
}

/** Every subject glyph names exactly one subject. */
const glyphSubject: Record<SubjectGlyph, SubjectIconId> = {
  pi: 'math',
  aa: 'russian',
  globe: 'english',
  users: 'social',
  code: 'informatics',
  atom: 'physics',
  flask: 'chemistry',
  leaf: 'biology',
  landmark: 'history',
};

/**
 * The fixed-size subject badge used in headers and lists: the approved
 * subject artwork (see SubjectIcon) in a square box of `size` px.
 */
export function SubjectTile({ glyph, size = 44, selected, className }: SubjectTileProps) {
  return (
    <span className={clsx(styles.tile, className)} style={{ width: size, height: size }}>
      <SubjectIcon subjectId={glyphSubject[glyph]} selected={selected} />
    </span>
  );
}
