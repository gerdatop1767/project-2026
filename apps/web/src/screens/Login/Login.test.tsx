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

describe('Login — unified layout (no separate signup/login tabs)', () => {
  it('shows one fixed headline, the VK ID button, the email form and consent text', () => {
    renderLogin();
    expect(screen.getByText('Войти или создать аккаунт')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByText('Продолжить через VK ID')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Продолжить с почтой' })).toBeInTheDocument();
    expect(screen.getByText(/условиями использования/)).toBeInTheDocument();
    // No tab control at all — one unified flow for new and returning users.
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });
});

describe('Login — email validation', () => {
  it('rejects an invalid email without calling the API', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Продолжить с почтой' }));
    expect(screen.getByText('Введите корректный email')).toBeInTheDocument();
    expect(api.requestMagicLink).not.toHaveBeenCalled();
  });
});

describe('Login — magic-link request', () => {
  it('sends the trimmed email and shows the "check your email" state, explicitly naming it a link (never a code)', async () => {
    vi.mocked(api.requestMagicLink).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText('Email'), '  student@example.com  ');
    await user.click(screen.getByRole('button', { name: 'Продолжить с почтой' }));
    await waitFor(() => expect(screen.getByText('Проверьте почту')).toBeInTheDocument());
    expect(api.requestMagicLink).toHaveBeenCalledWith('student@example.com');
    expect(screen.getByText(/student@example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/ссылкой для входа/)).toBeInTheDocument();
    expect(screen.getByText(/это ссылка, не код/)).toBeInTheDocument();
  });

  it('never claims success on a 503 (email not configured) — shows an honest error instead', async () => {
    vi.mocked(api.requestMagicLink).mockRejectedValue(
      new ApiError(503, { error: 'email_not_configured' }),
    );
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText('Email'), 'student@example.com');
    await user.click(screen.getByRole('button', { name: 'Продолжить с почтой' }));
    await waitFor(() =>
      expect(screen.getByText(/Отправка писем сейчас недоступна/)).toBeInTheDocument(),
    );
    expect(screen.queryByText('Проверьте почту')).not.toBeInTheDocument();
  });

  it('shows a clear rate-limit message on a 429, never a generic/fake error', async () => {
    vi.mocked(api.requestMagicLink).mockRejectedValue(new ApiError(429, { error: 'rate_limited' }));
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText('Email'), 'student@example.com');
    await user.click(screen.getByRole('button', { name: 'Продолжить с почтой' }));
    await waitFor(() => expect(screen.getByText(/Слишком много попыток/)).toBeInTheDocument());
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
    const submit = screen.getByRole('button', { name: 'Продолжить с почтой' });
    await user.click(submit);
    await user.click(submit);
    await user.click(submit);
    expect(api.requestMagicLink).toHaveBeenCalledTimes(1);
    resolveRequest?.();
  });
});

describe('Login — magic-link verification (?token=...)', () => {
  it('shows a loading state, then success, then auto-redirects into the trainer using the real server session', async () => {
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
