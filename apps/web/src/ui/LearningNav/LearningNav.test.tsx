import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import { TheoryCatalog } from '../../screens/Theory/TheoryCatalog.js';
import { Library } from '../../screens/Library/Library.js';
import { LearningCenterMobile } from '../../screens/LearningCenter/LearningCenterMobile.js';

function Routed() {
  const { overlay } = useNavigation();
  if (overlay?.screen === 'learningCenter') return <LearningCenterMobile />;
  if (overlay?.screen === 'theory')
    return (
      <TheoryCatalog
        section={overlay.section}
        taskNumber={overlay.taskNumber}
        subject={overlay.subject}
        edition={overlay.edition}
        topic={overlay.topic}
      />
    );
  if (overlay?.screen === 'library')
    return <Library section={overlay.section} itemId={overlay.itemId} subject={overlay.subject} />;
  return <p>tab screen</p>;
}

function renderAt(path: string) {
  window.history.replaceState(null, '', path);
  return render(
    <NavigationProvider>
      <Routed />
    </NavigationProvider>,
  );
}

/** Every learning-centre page, nested ones included (docs/LIBRARY.md, docs/THEORY.md). */
const innerPages = [
  '/theory',
  '/theory?n=9',
  '/theory?n=27',
  '/theory?s=math',
  '/theory?s=math&n=13',
  '/materials',
  '/materials?s=russian',
  '/materials?id=math-derivatives',
  '/strategies',
  '/strategies?s=general',
];

describe('learning-centre navigation', () => {
  it.each(innerPages)(
    '%s has a visible «Учебный центр» exit that leads to the centre',
    async (path) => {
      const { unmount } = renderAt(path);
      const exit = screen.getByTestId('learning-back');
      expect(exit).toHaveTextContent('Учебный центр');
      await userEvent.click(exit);
      expect(screen.getByRole('heading', { level: 1, name: 'Учебный центр' })).toBeInTheDocument();
      expect(window.location.pathname).toBe('/learning');
      unmount();
    },
  );

  it('an inner page shows the trail «Учебный центр › раздел › страница»', () => {
    renderAt('/theory?n=9');
    const nav = screen.getByRole('navigation', { name: 'Навигация по учебному центру' });
    const steps = [...nav.querySelectorAll('li')].map((li) => li.textContent);
    expect(steps).toEqual([
      'Учебный центр',
      'Теория · русский язык',
      expect.stringMatching(/^№9\./),
    ]);
    expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent(/^№9\./);
  });

  it('a material page shows the trail «Учебный центр › Полезные материалы › материал»', () => {
    renderAt('/materials?id=math-derivatives');
    const nav = screen.getByRole('navigation', { name: 'Навигация по учебному центру' });
    const steps = [...nav.querySelectorAll('li')].map((li) => li.textContent);
    expect(steps).toHaveLength(3);
    expect(steps.slice(0, 2)).toEqual(['Учебный центр', 'Полезные материалы']);
    expect(screen.getByRole('heading', { level: 1, name: steps[2]! })).toBeInTheDocument();
  });

  it('the centre itself offers «Назад», which leaves the centre (not a sign-out)', async () => {
    renderAt('/learning');
    const exit = screen.getByTestId('learning-back');
    expect(exit).toHaveTextContent('Назад');
    await userEvent.click(exit);
    expect(screen.getByText('tab screen')).toBeInTheDocument();
  });
});
