import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeAuthUser, TestAuthProvider } from '../../lib/authTestUtils.js';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import { SignInMethodWarning } from './SignInMethodWarning.js';

function Where() {
  const { overlay } = useNavigation();
  return <p data-testid="where">{overlay?.screen ?? 'tab'}</p>;
}

function renderWarning(needsSignInMethod: boolean, onProfile = false) {
  return render(
    <TestAuthProvider user={makeAuthUser()} needsSignInMethod={needsSignInMethod}>
      <NavigationProvider>
        <SignInMethodWarning onProfile={onProfile} />
        <Where />
      </NavigationProvider>
    </TestAuthProvider>,
  );
}

describe('SignInMethodWarning', () => {
  it('asks an account with no working sign-in method to connect VK or Yandex', async () => {
    renderWarning(true);
    const region = screen.getByRole('region', { name: 'Подключите VK ID или Яндекс ID' });
    expect(region).toHaveTextContent('Вход по почте отключён');
    expect(region).toHaveTextContent('Прогресс и статистика сохранятся');
    await userEvent.click(screen.getByRole('button', { name: 'Подключить в профиле' }));
    expect(screen.getByTestId('where')).toHaveTextContent('profile');
  });

  it('is not shown to an account that already has a working method', () => {
    renderWarning(false);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('inside Профиль it has no button to go to Профиль', () => {
    renderWarning(true, true);
    expect(screen.getByRole('region')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
