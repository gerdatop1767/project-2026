import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  confirmTelegramLink: vi.fn(),
  getProgressNotificationPreferences: vi.fn(async () => ({
    progressEnabled: true,
    planRemindersEnabled: true,
    frequency: 'normal',
    explicit: false,
  })),
  saveProgressNotificationPreferences: vi.fn(async (p: object) => ({ ...p, explicit: true })),
}));

const settings = (over: Partial<ReminderSettingsResponse> = {}): ReminderSettingsResponse => ({
  enabled: false,
  time: '19:00',
  timezone: 'Europe/Moscow',
  telegram: { linked: true, botStarted: true, blocked: false, pendingLink: null },
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
    vi.mocked(api.confirmTelegramLink).mockReset();
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
      settings({
        telegram: { linked: false, botStarted: false, blocked: false, pendingLink: null },
      }),
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

  it('links only after the owner confirms the Telegram that claimed the link', async () => {
    const pending = settings({
      telegram: { linked: false, botStarted: true, blocked: false, pendingLink: { name: 'Вера' } },
    });
    vi.mocked(api.getReminders).mockResolvedValue(pending);
    vi.mocked(api.confirmTelegramLink).mockResolvedValueOnce({
      status: 'rejected',
      settings: settings({
        telegram: { linked: false, botStarted: true, blocked: false, pendingLink: null },
      }),
    });
    const user = userEvent.setup();
    const first = renderScreen();
    expect(await screen.findByText(/хочет привязаться к этому аккаунту/)).toHaveTextContent('Вера');
    await user.click(screen.getByRole('button', { name: 'Это не я' }));
    expect(api.confirmTelegramLink).toHaveBeenLastCalledWith(false);
    expect(await screen.findByText(/ничего не привязано/)).toBeInTheDocument();
    first.unmount();

    vi.mocked(api.confirmTelegramLink).mockResolvedValueOnce({
      status: 'linked',
      settings: settings(),
    });
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Подтвердить' }));
    expect(api.confirmTelegramLink).toHaveBeenLastCalledWith(true);
    expect(await screen.findByText(/Telegram привязан — напоминания/)).toBeInTheDocument();
  });

  it('says honestly when the bot is not started or blocked', async () => {
    vi.mocked(api.getReminders).mockResolvedValue(
      settings({
        telegram: { linked: true, botStarted: false, blocked: false, pendingLink: null },
      }),
    );
    const first = renderScreen();
    expect(await screen.findByText(/бот ещё не запущен/)).toBeInTheDocument();
    first.unmount();
    vi.mocked(api.getReminders).mockResolvedValue(
      settings({ telegram: { linked: true, botStarted: true, blocked: true, pendingLink: null } }),
    );
    renderScreen();
    expect(await screen.findByText(/заблокирован/)).toBeInTheDocument();
  });

  it('a guest is asked to sign in and nothing is requested', () => {
    renderScreen(null);
    expect(screen.getByRole('button', { name: 'Войти' })).toBeInTheDocument();
    expect(api.getReminders).not.toHaveBeenCalled();
  });

  it('progress notifications are switched separately from the daily reminder', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getReminders).mockResolvedValue(settings());
    renderScreen();
    const progress = await screen.findByRole('switch', { name: 'Прогресс и цели' });
    expect(progress).toHaveAttribute('aria-checked', 'true');
    await user.click(progress);
    expect(api.saveProgressNotificationPreferences).toHaveBeenLastCalledWith({
      progressEnabled: false,
      planRemindersEnabled: true,
      frequency: 'normal',
    });
    expect(progress).toHaveAttribute('aria-checked', 'false');
    const freq = screen.getByRole('radiogroup', { name: 'Частота уведомлений' });
    expect(within(freq).getByRole('radio', { name: /Обычная/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.click(within(freq).getByRole('radio', { name: 'Минимальная' }));
    expect(api.saveProgressNotificationPreferences).toHaveBeenLastCalledWith({
      progressEnabled: false,
      planRemindersEnabled: true,
      frequency: 'important',
    });
    expect(api.saveReminders).not.toHaveBeenCalled();
  });

  it('«Расширенная» is saved and explained; the chosen option is marked', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getReminders).mockResolvedValue(settings());
    renderScreen();
    const freq = await screen.findByRole('radiogroup', { name: 'Частота уведомлений' });
    expect(screen.getByText(/До 2 сообщений в день/)).toBeInTheDocument();
    await user.click(within(freq).getByRole('radio', { name: 'Расширенная' }));
    expect(api.saveProgressNotificationPreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({ frequency: 'extended' }),
    );
    expect(within(freq).getByRole('radio', { name: /Расширенная/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByText(/До 3 сообщений в день/)).toBeInTheDocument();
    expect(screen.getByText(/после 14:00/)).toBeInTheDocument();
    await user.click(within(freq).getByRole('radio', { name: 'Минимальная' }));
    expect(screen.getByText(/До 1 сообщения в день/)).toBeInTheDocument();
    expect(screen.getByText(/Без ежедневных напоминаний по плану/)).toBeInTheDocument();
  });

  it('a saved setting is shown on open; a failed save puts the old one back', async () => {
    vi.mocked(api.getProgressNotificationPreferences).mockResolvedValue({
      progressEnabled: true,
      planRemindersEnabled: false,
      frequency: 'extended',
    } as Awaited<ReturnType<typeof api.getProgressNotificationPreferences>>);
    vi.mocked(api.saveProgressNotificationPreferences).mockRejectedValueOnce(new Error('offline'));
    vi.mocked(api.getReminders).mockResolvedValue(settings({ enabled: true, time: '07:30' }));
    const user = userEvent.setup();
    renderScreen();
    const freq = await screen.findByRole('radiogroup', { name: 'Частота уведомлений' });
    expect(within(freq).getByRole('radio', { name: /Расширенная/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('switch', { name: 'Напоминания по плану' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByLabelText('Время')).toHaveValue('07:30');
    await user.click(within(freq).getByRole('radio', { name: 'Обычная' }));
    await waitFor(() =>
      expect(within(freq).getByRole('radio', { name: /Расширенная/ })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось сохранить');
  });
});
