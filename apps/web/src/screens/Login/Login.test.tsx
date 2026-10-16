import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavigationProvider } from '../../lib/navigation.js';
import { Login } from './Login.js';
import { ApiError } from '../../lib/api.js';
import * as api from '../../lib/api.js';
import type * as ApiModule from '../../lib/api.js';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../../lib/api.js');
  return {
    ...actual,
    getCurrentUser: vi.fn(() => Promise.resolve({ user: null })),
    requestMagicLink: vi.fn(),
    verifyMagicLink: vi.fn(),
    vkLoginUrl: vi.fn(() => 'https://api.test/api/v1/auth/vk/start'),
  };
});

function renderLogin(path = '/login') {
  window.history.pushState(null, '', path);
  return render(
    <NavigationProvider>
      <Login />
    </NavigationProvider>,
  );
}

describe('Login — tabs + layout', () => {
  it('starts on "Создать аккаунт" and shows the email form, VK button and consent text', () => {
    renderLogin();
    expect(screen.getByRole('tab', { name: 'Создать аккаунт' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByText('Продолжить через ВКонтакте')).toBeInTheDocument();
    expect(screen.getByText(/условиями использования/)).toBeInTheDocument();
  });

  it('switches to "Войти" on click and back', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('tab', { name: 'Войти' }));
    expect(screen.getByRole('tab', { name: 'Войти' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Создать аккаунт' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    await user.click(screen.getByRole('tab', { name: 'Создать аккаунт' }));
    expect(screen.getByRole('tab', { name: 'Создать аккаунт' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});

describe('Login — email validation', () => {
  it('rejects an invalid email without calling the API', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Продолжить' }));
    expect(screen.getByText('Введите корректный email')).toBeInTheDocument();
    expect(api.requestMagicLink).not.toHaveBeenCalled();
  });
});

describe('Login — magic-link request', () => {
  it('sends the trimmed email and shows the "check your email" state on success', async () => {
    vi.mocked(api.requestMagicLink).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText('Email'), '  student@example.com  ');
    await user.click(screen.getByRole('button', { name: 'Продолжить' }));
    await waitFor(() => expect(screen.getByText('Проверьте почту')).toBeInTheDocument());
    expect(api.requestMagicLink).toHaveBeenCalledWith('student@example.com');
    expect(screen.getByText(/student@example\.com/)).toBeInTheDocument();
  });

  it('never claims success on a 503 (email not configured) — shows an honest error instead', async () => {
    vi.mocked(api.requestMagicLink).mockRejectedValue(
      new ApiError(503, { error: 'email_not_configured' }),
    );
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText('Email'), 'student@example.com');
    await user.click(screen.getByRole('button', { name: 'Продолжить' }));
    await waitFor(() =>
      expect(screen.getByText(/Отправка писем сейчас недоступна/)).toBeInTheDocument(),
    );
    expect(screen.queryByText('Проверьте почту')).not.toBeInTheDocument();
  });

  it('guards against a double submit while the request is in flight', async () => {
    let resolveRequest: (() => void) | undefined;
    vi.mocked(api.requestMagicLink).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = () => resolve({ ok: true });
        }),
    );
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText('Email'), 'student@example.com');
    const submit = screen.getByRole('button', { name: 'Продолжить' });
    await user.click(submit);
    await user.click(submit);
    await user.click(submit);
    expect(api.requestMagicLink).toHaveBeenCalledTimes(1);
    resolveRequest?.();
  });
});

describe('Login — magic-link verification (?token=...)', () => {
  it('shows a loading state, then success, when the token verifies', async () => {
    vi.mocked(api.verifyMagicLink).mockResolvedValue({
      user: { id: 'u1', email: 'student@example.com' },
    });
    renderLogin('/login?token=good-token');
    expect(screen.getByText('Входим…')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Готово!')).toBeInTheDocument());
    expect(api.verifyMagicLink).toHaveBeenCalledWith('good-token');
  });

  it('shows an honest error state when the token is invalid/expired, never a fake success', async () => {
    vi.mocked(api.verifyMagicLink).mockRejectedValue(
      new ApiError(400, { error: 'invalid_or_expired_token' }),
    );
    renderLogin('/login?token=bad-token');
    await waitFor(() => expect(screen.getByText('Ссылка недействительна')).toBeInTheDocument());
    expect(screen.queryByText('Готово!')).not.toBeInTheDocument();
  });
});
