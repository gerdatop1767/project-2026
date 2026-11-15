import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import { TheoryCatalog } from '../../screens/Theory/TheoryCatalog.js';
import { Library } from '../../screens/Library/Library.js';
import { LearningCenterMobile } from '../../screens/LearningCenter/LearningCenterMobile.js';

/**
 * Back navigation in the learning centre through real browser history
 * (pushState / history.back / popstate), the way a phone uses it: the
 * pinned «←» pill, the system Back button, refresh and direct links.
 */
function Routed() {
  const { overlay, tab, navigate, back } = useNavigation();
  if (overlay?.screen === 'learningCenter') return <LearningCenterMobile />;
  if (overlay?.screen === 'theory')
    return <TheoryCatalog section={overlay.section} taskNumber={overlay.taskNumber} />;
  if (overlay?.screen === 'library')
    return <Library section={overlay.section} itemId={overlay.itemId} subject={overlay.subject} />;
  if (overlay?.screen === 'subjectCatalog')
    // «Практика»: the real mobile catalog closes itself with `back()`.
    return (
      <div>
        <h1>Практика</h1>
        <button type="button" onClick={back}>
          Назад из практики
        </button>
      </div>
    );
  return (
    <div>
      <p>tab {tab}</p>
      <button type="button" onClick={() => navigate({ screen: 'learningCenter' })}>
        Открыть учебный центр
      </button>
    </div>
  );
}

function renderAt(path: string, state: unknown = null) {
  window.history.replaceState(state, '', path);
  return render(
    <NavigationProvider>
      <Routed />
    </NavigationProvider>,
  );
}

const pill = () => screen.getByTestId('learning-back');
const at = (path: string) => waitFor(() => expect(location.pathname + location.search).toBe(path));
const centreHeading = () => screen.findByRole('heading', { level: 1, name: 'Учебный центр' });

async function openCentreFromHome() {
  const user = userEvent.setup();
  renderAt('/');
  await user.click(screen.getByRole('button', { name: 'Открыть учебный центр' }));
  await centreHeading();
  return user;
}

describe('learning centre: Back goes to the real previous screen', () => {
  it('центр → практика → назад → центр → назад → главная, without a loop', async () => {
    const user = await openCentreFromHome();
    const start = history.length;
    await user.click(screen.getByRole('link', { name: /Практика/ }));
    await screen.findByRole('heading', { name: 'Практика' });
    await user.click(screen.getByRole('button', { name: 'Назад из практики' }));
    await centreHeading();
    await at('/learning');
    await user.click(pill()); // «← Назад» on the centre
    await screen.findByText('tab home');
    await at('/');
    expect(history.length).toBe(start + 1); // only the one push to «Практика»
  });

  it('the old loop: центр → материалы → «← Учебный центр» → «Назад» lands on the main screen', async () => {
    const user = await openCentreFromHome();
    await user.click(screen.getByRole('link', { name: /Полезные материалы/ }));
    await at('/materials');
    expect(pill()).toHaveTextContent('Учебный центр');
    const before = history.length;
    await user.click(pill());
    await centreHeading();
    await at('/learning');
    expect(history.length).toBe(before); // went back, no second «/learning» entry
    await user.click(pill());
    await screen.findByText('tab home');
    await at('/');
    // Back again from the main screen does not bounce into the learning centre.
    expect(screen.queryByRole('heading', { name: 'Полезные материалы' })).toBeNull();
  });

  it('центр → теория → №9 → назад → теория → назад → центр (labels name the real target)', async () => {
    const user = await openCentreFromHome();
    await user.click(screen.getByRole('link', { name: /Теория/ }));
    await at('/theory');
    await user.click(await screen.findByRole('link', { name: /№\s*9/ }));
    await at('/theory/russian/9');
    expect(pill()).toHaveTextContent('Теория · русский язык');
    await user.click(pill());
    await at('/theory');
    expect(pill()).toHaveTextContent('Учебный центр');
    await user.click(pill());
    await centreHeading();
    await user.click(pill());
    await at('/');
  });

  it('центр → материалы → материал → назад → назад, and the system Back several times in a row', async () => {
    const user = await openCentreFromHome();
    await user.click(screen.getByRole('link', { name: /Полезные материалы/ }));
    await at('/materials');
    await user.click(screen.getByText('Таблица производных и правила дифференцирования'));
    await at('/materials/math-derivatives');
    expect(pill()).toHaveTextContent('Полезные материалы');
    await user.click(pill());
    await at('/materials');
    await user.click(screen.getByText('Таблица производных и правила дифференцирования'));
    await at('/materials/math-derivatives');
    // System Back ×3: material → list → centre → main screen.
    history.back();
    await at('/materials');
    history.back();
    await at('/learning');
    await centreHeading();
    history.back();
    await at('/');
    await screen.findByText('tab home');
  });

  it('a desktop breadcrumb to the page behind goes Back instead of stacking a copy', async () => {
    const user = await openCentreFromHome();
    await user.click(screen.getByRole('link', { name: /Полезные материалы/ }));
    await user.click(screen.getByText('Таблица производных и правила дифференцирования'));
    await at('/materials/math-derivatives');
    const before = history.length;
    const crumbs = screen.getByRole('navigation', { name: 'Навигация по учебному центру' });
    await user.click(
      [...crumbs.querySelectorAll('ol a')].find((a) => a.textContent === 'Полезные материалы')!,
    );
    await at('/materials');
    expect(history.length).toBe(before);
  });

  it('a direct link to a nested page: Back leads to the centre, then to the main screen', async () => {
    const user = userEvent.setup();
    renderAt('/materials/math-derivatives');
    expect(pill()).toHaveTextContent('Учебный центр');
    await user.click(pill());
    await centreHeading();
    await at('/learning');
    await user.click(pill());
    await at('/');
  });

  it('after a refresh the history still knows the previous screen', async () => {
    const user = await openCentreFromHome();
    await user.click(screen.getByRole('link', { name: /Стратегии/ }));
    await at('/strategies');
    const state = history.state as unknown;
    // Reload: the page starts over at the same URL with the same history entry.
    screen.getByTestId('learning-back');
    document.body.innerHTML = '';
    renderAt('/strategies', state);
    expect(pill()).toHaveTextContent('Учебный центр');
    await user.click(pill());
    await at('/learning');
  });
});
