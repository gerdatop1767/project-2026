import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LearningCenterDesktop } from './LearningCenterDesktop.js';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import { subjects } from '../../data/subjects.js';
import { subjectIconSrc, type SubjectIconId } from '../../ui/SubjectIcon/subjectIcons.js';

function OverlayMarker() {
  const { overlay } = useNavigation();
  return <p data-testid="overlay">{overlay?.screen ?? 'none'}</p>;
}

function renderLearningCenter() {
  return render(
    <NavigationProvider>
      <LearningCenterDesktop />
      <OverlayMarker />
    </NavigationProvider>,
  );
}

describe('LearningCenterDesktop', () => {
  it('renders the four section cards with their real illustrations and an arrow each', () => {
    renderLearningCenter();
    const sectionIcons: Record<string, string> = {
      Теория: 'theory',
      Практика: 'practice',
      Стратегии: 'strategy',
      'Полезные материалы': 'materials',
    };
    for (const [title, icon] of Object.entries(sectionIcons)) {
      expect(screen.getByText(title)).toBeInTheDocument();
      // The section's own animated line icon, decorative (the title names it).
      const iconEl = document.querySelector(`[data-icon="${icon}"]`);
      expect(iconEl).toBeInTheDocument();
      expect(iconEl).toHaveAttribute('aria-hidden', 'true');
      expect(screen.getByRole('button', { name: title })).toBeInTheDocument();
    }
  });

  it('renders all 9 subjects using the shared subject illustrations', () => {
    renderLearningCenter();
    for (const subject of subjects) {
      expect(
        document.querySelector(`img[src="${subjectIconSrc(subject.id as SubjectIconId)}"]`),
      ).toBeInTheDocument();
    }
  });

  it('opens the subject catalog when a subject row is clicked', async () => {
    const user = userEvent.setup();
    renderLearningCenter();
    await user.click(screen.getByText('Математика'));
    expect(screen.getByTestId('overlay')).toHaveTextContent('subject');
  });
});
