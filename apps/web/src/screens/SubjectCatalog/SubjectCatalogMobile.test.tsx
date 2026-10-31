import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SubjectCatalogMobile } from './SubjectCatalogMobile.js';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import { subjects } from '../../data/subjects.js';
import * as api from '../../lib/api.js';
import { subjectIconSrc, type SubjectIconId } from '../../ui/SubjectIcon/subjectIcons.js';

vi.mock('../../lib/api.js', () => ({
  getTaskCountsBySubject: vi.fn(() => Promise.resolve({ items: [] })),
}));

function OverlayMarker() {
  const { overlay } = useNavigation();
  return <p data-testid="overlay">{overlay?.screen ?? 'none'}</p>;
}

function renderCatalog() {
  return render(
    <NavigationProvider>
      <SubjectCatalogMobile />
      <OverlayMarker />
    </NavigationProvider>,
  );
}

describe('SubjectCatalogMobile', () => {
  it('shows every subject with a real illustration, not a flat glyph', () => {
    renderCatalog();
    for (const subject of subjects) {
      expect(screen.getByText(subject.shortName)).toBeInTheDocument();
      expect(
        document.querySelector(`img[src="${subjectIconSrc(subject.id as SubjectIconId)}"]`),
      ).toBeInTheDocument();
    }
  });

  it('shows the three summary stats', () => {
    renderCatalog();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('предметов')).toBeInTheDocument();
    expect(screen.getByText('Полная')).toBeInTheDocument();
  });

  it('shows real published-task counts per subject, not the static demo numbers', async () => {
    vi.mocked(api.getTaskCountsBySubject).mockResolvedValue({
      items: [
        { subjectId: 'math', count: 7, countAllSources: 7 },
        { subjectId: 'russian', count: 3, countAllSources: 3 },
      ],
    });
    renderCatalog();
    await waitFor(() => expect(screen.getByText('7 заданий')).toBeInTheDocument());
    expect(screen.getByText('3 заданий')).toBeInTheDocument();
    expect(screen.getAllByText('0 заданий').length).toBeGreaterThan(0);
  });

  it('navigates to a subject when tapped', async () => {
    const user = userEvent.setup();
    renderCatalog();
    await user.click(screen.getByRole('button', { name: /Математика/ }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('subject');
  });
});
