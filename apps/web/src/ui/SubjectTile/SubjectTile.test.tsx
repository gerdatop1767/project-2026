import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { subjects } from '../../data/subjects.js';
import { SubjectTile } from './SubjectTile.js';
import { SUBJECT_ICON_FILES, isSubjectIconId } from '../SubjectIcon/subjectIcons.js';

describe('SubjectTile', () => {
  it.each(subjects.map((s) => [s.id, s.glyph] as const))(
    'shows the approved artwork of %s for its glyph',
    (id, glyph) => {
      const { container } = render(<SubjectTile glyph={glyph} />);
      const img = container.querySelector('img');
      expect(isSubjectIconId(id)).toBe(true);
      expect(img?.getAttribute('src')).toBe(
        `/branding/v2/subject-icons/${SUBJECT_ICON_FILES[id as keyof typeof SUBJECT_ICON_FILES]}`,
      );
    },
  );

  it('keeps its box size and marks the selected subject', () => {
    const { container } = render(<SubjectTile glyph="pi" size={48} selected />);
    const box = container.firstElementChild as HTMLElement;
    expect(box.style.width).toBe('48px');
    expect(box.style.height).toBe('48px');
    expect(container.querySelector('[data-selected]')).toBeInTheDocument();
  });
});
