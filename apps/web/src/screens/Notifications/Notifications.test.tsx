import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReminderSettingsResponse } from '@zybrilka/shared';
import { Notifications } from './Notifications.js';
import { NavigationProvider } from '../../lib/navigation.js';
import { TestAuthProvider, makeAuthUser } from '../../lib/authTestUtils.js';
import * as api from '../../lib/api.js';

vi.mock('../../lib/api.js', () => ({
  getReminders: vi.fn(),
  saveReminders: vi.fn(),
  createTelegramLink: vi.fn(),
}));

const settings = (over: Partial<ReminderSettingsResponse> = {}): ReminderSettingsResponse => ({
  enabled: false,
  time: '19:00',
  timezone: 'Europe/Moscow',
  telegram: { linked: true, botStarted: true, blocked: false },
  ...over,
});

function renderScreen(user: ReturnType<typeof makeAuthUser> | null = makeAuthUser()) {
  return render(
    <TestAuthProvider user={user}>
      <NavigationProvider>
        <Notifications />
      </NavigationProvider>
    </TestAuthProvider>,
  );
}

describe('Уведомления', () => {
  beforeEach(() => {
    vi.mocked(api.getReminders).mockReset();
    vi.mocked(api.saveReminders).mockReset();
    vi.mocked(api.createTelegramLink).mockReset();
  });

  it('switches the daily reminder on and off — saved on the server', async () => {
    vi.mocked(api.getReminders).mockResolvedValue(settings());
    vi.mocked(api.saveReminders).mockImplementation(async (body) =>
      settings({ enabled: body.enabled, time: body.time, timezone: body.timezone }),
    );
    const user = userEvent.setup();
    renderScreen();
    const toggle = await screen.findByRole('switch', { name: 'Ежедневное напоминание' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Выключено')).toBeInTheDocument();
    await user.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect(api.saveReminders).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true, time: '19:00' }),
    );
    expect(screen.getByText('Включено')).toBeInTheDocument();
    expect(screen.getByText('Сохранено')).toBeInTheDocument();
    await user.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
  });

  it('a new time is saved with the timezone', async () => {
    vi.mocked(api.getReminders).mockResolvedValue(settings({ enabled: true }));
    vi.mocked(api.saveReminders).mockImplementation(async (body) => settings(body));
    renderScreen();
    const time = await screen.findByLabelText('Время');
    fireEvent.change(time, { target: { value: '07:00' } });
    fireEvent.change(time, { target: { value: '07:30' } });
    expect(api.saveReminders).not.toHaveBeenCalled(); // not while typing
    fireEvent.blur(time);
    await waitFor(() =>
      expect(api.saveReminders).toHaveBeenLastCalledWith({
        enabled: true,
        time: '07:30',
        timezone: 'Europe/Moscow',
      }),
    );
    expect(api.saveReminders).toHaveBeenCalledTimes(1);
  });

  it('explains how to link Telegram and opens the bot with a one-time link', async () => {
    vi.mocked(api.getReminders).mockResolvedValue(
      settings({ telegram: { linked: false, botStarted: false, blocked: false } }),
    );
    vi.mocked(api.createTelegramLink).mockResolvedValue({
      token: 'abcdefghijklmnopqrstuvwxyz012345',
      expiresAt: new Date().toISOString(),
    });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const user = userEvent.setup();
    renderScreen();
    expect(await screen.findByText(/Привяжи свой Telegram/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Привязать Telegram' }));
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        'https://t.me/zybrilka_bot?start=link_abcdefghijklmnopqrstuvwxyz012345',
        '_blank',
        'noopener',
      ),
    );
    expect(screen.getByRole('link', { name: 'Открыть бота' })).toBeInTheDocument();
    open.mockRestore();
  });

  it('says honestly when the bot is not started or blocked', async () => {
    vi.mocked(api.getReminders).mockResolvedValue(
      settings({ telegram: { linked: true, botStarted: false, blocked: false } }),
    );
    const first = renderScreen();
    expect(await screen.findByText(/бот ещё не запущен/)).toBeInTheDocument();
    first.unmount();
    vi.mocked(api.getReminders).mockResolvedValue(
      settings({ telegram: { linked: true, botStarted: true, blocked: true } }),
    );
    renderScreen();
    expect(await screen.findByText(/заблокирован/)).toBeInTheDocument();
  });

  it('a guest is asked to sign in and nothing is requested', () => {
    renderScreen(null);
    expect(screen.getByRole('button', { name: 'Войти' })).toBeInTheDocument();
    expect(api.getReminders).not.toHaveBeenCalled();
  });
});
