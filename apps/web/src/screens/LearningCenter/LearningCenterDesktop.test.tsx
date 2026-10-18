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
    const sectionImages: Record<string, string> = {
      Теория: 'theory.png',
      Практика: 'practice.png',
      Стратегии: 'strategy.png',
      'Полезные материалы': 'useful-materials.png',
    };
    for (const [title, file] of Object.entries(sectionImages)) {
      expect(screen.getByText(title)).toBeInTheDocument();
      expect(
        document.querySelector(`img[src="/branding/v2/learning/${file}"]`),
      ).toBeInTheDocument();
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
