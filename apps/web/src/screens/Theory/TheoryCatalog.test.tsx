import { describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import { pathForRoute, routeFromPath } from '../../lib/routes.js';
import { TheoryCatalog } from './TheoryCatalog.js';

function Routed() {
  const { overlay } = useNavigation();
  if (overlay?.screen !== 'theory') return <p>other screen</p>;
  return (
    <TheoryCatalog
      section={overlay.section}
      taskNumber={overlay.taskNumber}
      subject={overlay.subject}
      edition={overlay.edition}
      topic={overlay.topic}
    />
  );
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

describe('Теория — профильная математика', () => {
  it('ЕГЭ-2027 uses the 2026 numbering: №6 is equations, №12 extremum, №16 finance', () => {
    renderAt('/theory?s=math&ed=ege-2027');
    const list = screen.getByRole('navigation', { name: 'Задания' });
    expect(
      within(list).getByRole('button', { name: /№6\. Простейшие уравнения/ }),
    ).toBeInTheDocument();
    expect(
      within(list).getByRole('button', { name: /№12\. Наибольшее и наименьшее значение функции/ }),
    ).toBeInTheDocument();
    expect(
      within(list).getByRole('button', { name: /№16\. Финансовая математика/ }),
    ).toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: /№20\./ })).not.toBeInTheDocument();
    expect(screen.getByText(/та же, что в ЕГЭ-2026: изменений нет/)).toBeInTheDocument();
  });

  it('the old Ященко-2027 edition keeps its own 20 numbers and is labelled as old', async () => {
    renderAt('/theory?s=math&ed=ege-2027-project&n=6');
    expect(screen.getByText(/Нумерация старого сборника Ященко-2027/)).toBeInTheDocument();
    expect(screen.getByText('Ященко-2027 · старая редакция · задание №6')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Случайные величины' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Главное свойство таблицы')).toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Задания' })).getAllByRole('button', {
        name: /^№/,
      }),
    ).toHaveLength(20);
  });

  it('one finance text from ЕГЭ-2027/2026 №16 and from old Ященко №13', async () => {
    const { unmount } = renderAt('/theory?s=math&ed=ege-2027&n=16');
    expect(
      screen.getByText('ЕГЭ-2027 и ЕГЭ-2026 №16 · Ященко-2027, старая редакция №13'),
    ).toBeInTheDocument();
    expect(await screen.findByText(/Дифференцированные платежи/)).toBeInTheDocument();
    unmount();
    renderAt('/theory?s=math&ed=ege-2027-project&n=13');
    expect(await screen.findByText(/Дифференцированные платежи/)).toBeInTheDocument();
    expect(screen.getAllByText(/В проекте — часть 1, краткий ответ/).length).toBeGreaterThan(0);
  });

  it('random variables: no number in the current edition, reachable «по кодификатору»', async () => {
    const user = userEvent.setup();
    renderAt('/theory?s=math&ed=ege-2027');
    await user.click(screen.getByRole('button', { name: /Случайная величина/ }));
    expect(window.location.search).toBe('?s=math&ed=ege-2027&t=math.random-variables');
    expect(screen.getByText('ЕГЭ-2027 · по кодификатору')).toBeInTheDocument();
    expect(screen.getByText(/Требование 8 кодификатора/)).toBeInTheDocument();
  });

  it('every number of every edition has written theory; №18 opens the parameters text', async () => {
    for (const ed of ['ege-2027', 'ege-2027-project'] as const) {
      const { unmount } = renderAt(`/theory?s=math&ed=${ed}`);
      expect(screen.queryByText('готовится')).not.toBeInTheDocument();
      unmount();
    }
    renderAt('/theory?s=math&ed=ege-2027');
    expect(
      screen.getByLabelText('№18. Задача с параметром — теория готова', { selector: '*' }),
    ).toBeInTheDocument();
    cleanup();
    renderAt('/theory?s=math&ed=ege-2027&n=18');
    expect((await screen.findAllByText(/Графический метод в плоскости/)).length).toBeGreaterThan(0);
  });

  it('switching the edition keeps the subject; the subject tabs switch catalogs', async () => {
    const user = userEvent.setup();
    renderAt('/theory?s=math&ed=ege-2027');
    await user.click(screen.getByRole('tab', { name: 'Ященко-2027 · старая редакция' }));
    expect(window.location.search).toBe('?s=math&ed=ege-2027-project');
    await user.click(screen.getByRole('tab', { name: 'Русский язык' }));
    expect(window.location.pathname + window.location.search).toBe('/theory');
  });
});
