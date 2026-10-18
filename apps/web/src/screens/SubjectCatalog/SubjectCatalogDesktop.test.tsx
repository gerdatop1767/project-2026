import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SubjectCatalogDesktop } from './SubjectCatalogDesktop.js';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import { pathForRoute } from '../../lib/routes.js';
import { subjects } from '../../data/subjects.js';
import * as api from '../../lib/api.js';
import { subjectIconSrc, type SubjectIconId } from '../../ui/SubjectIcon/subjectIcons.js';

vi.mock('../../lib/api.js', () => ({
  getTaskCountsBySubject: vi.fn(() => Promise.resolve({ items: [] })),
}));

function OverlayMarker() {
  const { overlay } = useNavigation();
  return <p data-testid="overlay">{JSON.stringify(overlay)}</p>;
}

function renderCatalog() {
  return render(
    <NavigationProvider>
      <SubjectCatalogDesktop />
      <OverlayMarker />
    </NavigationProvider>,
  );
}

describe('SubjectCatalogDesktop', () => {
  it('renders all 9 subject cards with their real illustration', () => {
    renderCatalog();
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(9);
    for (const subject of subjects) {
      expect(
        document.querySelector(`img[src="${subjectIconSrc(subject.id as SubjectIconId)}"]`),
      ).toBeInTheDocument();
    }
  });

  it('renders the three summary illustrations', () => {
    renderCatalog();
    for (const file of ['subjects.png', 'tasks.png', 'full-statistics.png']) {
      expect(document.querySelector(`img[src="/branding/v2/summary/${file}"]`)).toBeInTheDocument();
    }
  });

  it('shows real published-task counts per subject, not the static demo numbers', async () => {
    vi.mocked(api.getTaskCountsBySubject).mockResolvedValue({
      items: [
        { subjectId: 'math', count: 7 },
        { subjectId: 'russian', count: 3 },
      ],
    });
    renderCatalog();
    await waitFor(() => expect(screen.getByText('7 заданий')).toBeInTheDocument());
    expect(screen.getByText('3 заданий')).toBeInTheDocument();
    // A subject absent from the response has 0 published tasks — never
    // a fabricated fallback number (e.g. the old static 1240/980/etc).
    expect(screen.getAllByText('0 заданий').length).toBeGreaterThan(0);
  });

  it('opening a subject navigates to its correctly-slugged route', async () => {
    const user = userEvent.setup();
    renderCatalog();
    await user.click(screen.getByText('Обществознание'));
    const overlay = JSON.parse(screen.getByTestId('overlay').textContent!);
    expect(overlay.screen).toBe('subject');
    expect(overlay.subjectId).toBe('social');
    expect(pathForRoute(overlay)).toBe('/subjects/social-studies');
  });
});
