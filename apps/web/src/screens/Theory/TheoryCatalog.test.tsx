import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import { pathForRoute, routeFromPath } from '../../lib/routes.js';
import { TheoryCatalog } from './TheoryCatalog.js';

function Routed() {
  const { overlay } = useNavigation();
  if (overlay?.screen !== 'theory') return <p>other screen</p>;
  return <TheoryCatalog section={overlay.section} taskNumber={overlay.taskNumber} />;
}

function renderAt(path: string) {
  window.history.replaceState(null, '', path);
  return render(
    <NavigationProvider>
      <Routed />
    </NavigationProvider>,
  );
}

describe('Теория / Полезные материалы', () => {
  it('routes round-trip, the task number included', () => {
    expect(pathForRoute({ screen: 'theory', section: 'rules', taskNumber: 9 })).toBe('/theory?n=9');
    expect(pathForRoute({ screen: 'theory', section: 'materials' })).toBe('/materials');
    expect(routeFromPath('/materials?n=4')).toEqual({
      screen: 'theory',
      section: 'materials',
      taskNumber: 4,
    });
    expect(routeFromPath('/theory?n=abc')).toEqual({ screen: 'theory', section: 'rules' });
  });

  it('lists tasks by part of the exam and opens one — the number goes to the URL', async () => {
    const user = userEvent.setup();
    renderAt('/theory');
    const nav = screen.getByRole('navigation', { name: 'Задания' });
    expect(within(nav).getByRole('heading', { name: 'Орфография' })).toBeInTheDocument();
    expect(
      within(nav).getByRole('button', {
        name: '№1. Пропущенное слово в тексте — пока нет материала',
      }),
    );
    await user.click(within(nav).getByRole('button', { name: /^№9\. Гласные в корне/ }));
    expect(window.location.pathname + window.location.search).toBe('/theory?n=9');
    expect(screen.getByRole('heading', { name: 'Гласные в корне', level: 2 })).toBeInTheDocument();
    expect(await screen.findByText(/Чередующиеся корни/)).toBeInTheDocument();
  });

  it('search by number and by title; nothing found says so', async () => {
    const user = userEvent.setup();
    renderAt('/theory');
    const input = screen.getByRole('searchbox', { name: 'Поиск по правилам' });
    await user.type(input, '№15');
    const nav = screen.getByRole('navigation', { name: 'Задания' });
    expect(within(nav).getAllByRole('button')).toHaveLength(1);
    expect(within(nav).getByRole('button', { name: /^№15\. Н и НН/ })).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, '42');
    expect(screen.getByText(/Ничего не нашлось/)).toBeInTheDocument();
  });

  it('«Полезные материалы» shows the reference list and practice, not the конспект', async () => {
    renderAt('/materials?n=4');
    expect(
      screen.getByRole('heading', { name: 'Полезные материалы', level: 1 }),
    ).toBeInTheDocument();
    const tabs = screen.getByRole('tablist', { name: 'Материалы к заданию' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual(['Справочник', 'Практика']);
    expect(await screen.findByText(/ещё не сверен построчно/)).toBeInTheDocument();
  });

  it('switching the section keeps the chosen task', async () => {
    const user = userEvent.setup();
    renderAt('/theory?n=5');
    await user.click(screen.getByRole('tab', { name: 'Полезные материалы' }));
    expect(window.location.pathname + window.location.search).toBe('/materials?n=5');
    expect(screen.getByRole('heading', { name: 'Паронимы', level: 2 })).toBeInTheDocument();
  });
});
