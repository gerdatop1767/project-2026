import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import { libraryItems } from '../../data/library/library.js';
import { Library } from './Library.js';

function Routed() {
  const { overlay } = useNavigation();
  if (overlay?.screen === 'theory') return <p>theory {overlay.taskNumber}</p>;
  if (overlay?.screen !== 'library') return <p>other screen</p>;
  return <Library section={overlay.section} itemId={overlay.itemId} subject={overlay.subject} />;
}

function renderAt(path: string) {
  window.history.replaceState(null, '', path);
  return render(
    <NavigationProvider>
      <Routed />
    </NavigationProvider>,
  );
}

const cardTitles = () =>
  screen
    .getAllByRole('listitem')
    .map((li) => li.querySelector('button')?.textContent ?? '')
    .filter(Boolean);

describe('Библиотека: полезные материалы и стратегии', () => {
  it('«Полезные материалы» lists every material as a card, grouped by subject', () => {
    renderAt('/materials');
    expect(
      screen.getByRole('heading', { name: 'Полезные материалы', level: 1 }),
    ).toBeInTheDocument();
    const materials = libraryItems.filter((x) => x.section === 'materials');
    expect(cardTitles()).toHaveLength(materials.length);
    expect(screen.getByRole('heading', { name: /Математика/, level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Русский язык/, level: 2 })).toBeInTheDocument();
  });

  it('the subject filter narrows the cards and lives in the URL', async () => {
    const user = userEvent.setup();
    renderAt('/materials');
    await user.click(screen.getByRole('tab', { name: 'Русский язык' }));
    expect(window.location.search).toBe('?s=russian');
    const russian = libraryItems.filter(
      (x) => x.section === 'materials' && x.subject === 'russian',
    );
    expect(cardTitles()).toHaveLength(russian.length);
    expect(screen.queryByText('Таблица производных и правила дифференцирования')).toBeNull();
  });

  it('opens a material: its page, the text and links to the theory of its tasks', async () => {
    const user = userEvent.setup();
    renderAt('/materials');
    await user.click(screen.getByText('Таблица производных и правила дифференцирования'));
    expect(window.location.search).toBe('?id=math-derivatives');
    expect(
      screen.getByRole('heading', {
        name: 'Таблица производных и правила дифференцирования',
        level: 2,
      }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Правила дифференцирования')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '№12' }));
    expect(screen.getByText('theory 12')).toBeInTheDocument();
  });

  it('a reused FIPI list opens from its library card', async () => {
    renderAt('/materials?id=ru-stress-list');
    expect(
      screen.getByRole('heading', { name: 'Орфоэпический список ФИПИ', level: 2 }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/аэропОрты|Имена существительные/)).toBeInTheDocument();
  });

  it('«Стратегии» has its own tab and its cards; the search shows «Ничего не найдено»', async () => {
    const user = userEvent.setup();
    renderAt('/materials');
    await user.click(screen.getByRole('tab', { name: 'Стратегии' }));
    expect(window.location.pathname).toBe('/strategies');
    expect(screen.getByRole('heading', { name: 'Стратегии', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Распределение времени: профильная математика')).toBeInTheDocument();
    const box = screen.getByRole('searchbox', { name: 'Поиск по стратегиям' });
    await user.type(box, 'сочинение');
    const results = await screen.findByRole('region', { name: 'Результаты поиска' });
    expect(results).toHaveTextContent('Как писать сочинение по русскому языку');
    // Only strategies here: the essay reference material is not among the results.
    expect(results).not.toHaveTextContent('Сочинение: план, связки');
    await user.clear(box);
    await user.type(box, 'квазизвездолёт');
    expect(await screen.findByText(/ничего не найдено/)).toBeInTheDocument();
  });

  it('an unknown item falls back to the list instead of an empty page', () => {
    renderAt('/materials?id=no-such-item');
    expect(
      screen.getByRole('heading', { name: 'Полезные материалы', level: 1 }),
    ).toBeInTheDocument();
  });
});
