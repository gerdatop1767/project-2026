import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IdentitiesResponse } from '@zybrilka/shared';
import * as api from '../../../lib/api.js';
import { makeAuthUser, TestAuthProvider } from '../../../lib/authTestUtils.js';
import * as miniApp from '../../../lib/telegramMiniApp.js';
import { SignInMethodsSection } from './SignInMethodsSection.js';
import { useIdentities } from './useIdentities.js';

vi.mock('../../../lib/api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  getIdentities: vi.fn(),
  unlinkIdentity: vi.fn(),
  linkTelegram: vi.fn(),
  createTelegramLink: vi.fn(),
  cancelTelegramLink: vi.fn(),
  confirmTelegramLink: vi.fn(),
}));
vi.mock('../../../lib/telegramMiniApp.js', () => ({
  getTelegramInitData: vi.fn(() => null),
}));

const at = '2026-03-05T10:00:00.000Z';
const identities = (
  providers: ('email' | 'vk' | 'telegram' | 'yandex')[],
  extra: Partial<IdentitiesResponse> = {},
): IdentitiesResponse => ({
  identities: providers.map((provider) => ({ provider, linkedAt: at })),
  available: { vk: true, telegram: true, yandex: true },
  // As the server decides it: a legacy email row is not a way in.
  canUnlink: providers.filter((provider) => provider !== 'email').length > 1,
  ...extra,
});

function Harness({ navigateTo }: { navigateTo: (url: string) => void }) {
  const identities = useIdentities();
  return <SignInMethodsSection identities={identities} navigateTo={navigateTo} />;
}

function renderSection(navigateTo = vi.fn(), { needsSignInMethod = false } = {}) {
  const updateUser = vi.fn();
  const refresh = vi.fn(async () => {});
  render(
    <TestAuthProvider
      user={makeAuthUser()}
      updateUser={updateUser}
      refresh={refresh}
      needsSignInMethod={needsSignInMethod}
    >
      <Harness navigateTo={navigateTo} />
    </TestAuthProvider>,
  );
  return { navigateTo, updateUser, refresh };
}

beforeEach(() => window.history.replaceState(null, '', '/profile'));
afterEach(() => vi.resetAllMocks());

describe('SignInMethodsSection', () => {
  it('lists linked methods and offers the ones that can be added', async () => {
    vi.mocked(api.getIdentities).mockResolvedValue(identities(['email']));
    renderSection();
    expect(await screen.findByText('ВКонтакте')).toBeInTheDocument();
    expect(screen.getByText('Яндекс ID')).toBeInTheDocument();
    // E-mail is not a sign-in method any more: not listed.
    expect(screen.queryByText('Почта и пароль')).not.toBeInTheDocument();
    // Outside Telegram (Safari): linked through the bot, right here.
    expect(screen.getByRole('button', { name: 'Привязать Telegram' })).toBeInTheDocument();
    // Single method: nothing can be disconnected.
    expect(screen.queryByRole('button', { name: /Отключить/ })).not.toBeInTheDocument();
  });

  it('hides providers that are not configured on the server', async () => {
    vi.mocked(api.getIdentities).mockResolvedValue(
      identities(['email'], { available: { vk: false, telegram: false, yandex: false } }),
    );
    renderSection();
    await waitFor(() => expect(api.getIdentities).toHaveBeenCalled());
    expect(screen.queryByText('ВКонтакте')).not.toBeInTheDocument();
    expect(screen.queryByText('Telegram')).not.toBeInTheDocument();
    expect(screen.queryByText('Яндекс ID')).not.toBeInTheDocument();
  });

  it('«Подключить» for Yandex starts the server-side link flow with a full-page redirect', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getIdentities).mockResolvedValue(identities(['email']));
    const { navigateTo } = renderSection();
    const row = (await screen.findByText('Яндекс ID')).closest('li')!;
    await user.click(row.querySelector('button')!);
    expect(navigateTo).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/auth/yandex/start?link=1'),
    );
  });

  it('explains the result of connecting Yandex (no automatic merge)', async () => {
    window.history.replaceState(null, '', '/profile?link=taken&provider=yandex');
    vi.mocked(api.getIdentities).mockResolvedValue(identities(['email']));
    renderSection();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Мы не объединяем профили автоматически',
    );
    expect(window.location.search).toBe('');
  });

  it('«Подключить» for VK starts the server-side link flow with a full-page redirect', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getIdentities).mockResolvedValue(identities(['email']));
    const { navigateTo } = renderSection();
    const row = (await screen.findByText('ВКонтакте')).closest('li')!;
    await user.click(row.querySelector('button')!);
    expect(navigateTo).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/auth/vk/start?link=1'),
    );
  });

  it('shows the outcome of the VK redirect once and cleans the URL', async () => {
    window.history.replaceState(null, '', '/profile?link=taken&provider=vk');
    vi.mocked(api.getIdentities).mockResolvedValue(identities(['email']));
    renderSection();
    expect(await screen.findByRole('alert')).toHaveTextContent('уже связан с другим профилем');
    expect(window.location.search).toBe('');
  });

  it.each([
    ['ok', 'status', 'ВКонтакте подключён'],
    ['already', 'status', 'уже подключён'],
    ['provider_used', 'alert', 'другой аккаунт ВКонтакте'],
    ['session_changed', 'alert', 'сменили аккаунт'],
    ['error', 'alert', 'Не удалось подключить'],
    ['nonsense', 'alert', 'Не удалось подключить'],
  ])('VK result %s', async (result, role, text) => {
    window.history.replaceState(null, '', `/profile?link=${result}&provider=vk`);
    vi.mocked(api.getIdentities).mockResolvedValue(identities(['email', 'vk']));
    renderSection();
    expect((await screen.findAllByRole(role))[0]).toHaveTextContent(text);
  });

  it('disconnecting asks for confirmation, then updates the list', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getIdentities).mockResolvedValue(identities(['vk', 'yandex']));
    vi.mocked(api.unlinkIdentity).mockResolvedValue(identities(['yandex']));
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Отключить ВКонтакте' }));
    expect(api.unlinkIdentity).not.toHaveBeenCalled();
    const dialog = screen.getByRole('alertdialog');
    await user.click(dialog.querySelector('button')!); // «Отключить»
    expect(api.unlinkIdentity).toHaveBeenCalledWith('vk');
    expect(await screen.findByText('ВКонтакте отключён.')).toBeInTheDocument();
  });

  it('cancelling the confirmation changes nothing', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getIdentities).mockResolvedValue(identities(['vk', 'yandex']));
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Отключить ВКонтакте' }));
    await user.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(api.unlinkIdentity).not.toHaveBeenCalled();
  });

  it('explains why the last method cannot be removed (server guard)', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getIdentities).mockResolvedValue(identities(['vk', 'yandex']));
    vi.mocked(api.unlinkIdentity).mockRejectedValue(
      new api.ApiError(409, { error: 'last_identity' }),
    );
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Отключить ВКонтакте' }));
    await user.click(screen.getByRole('alertdialog').querySelector('button')!);
    expect(await screen.findByText(/единственный способ входа/)).toBeInTheDocument();
  });

  it('email + Yandex: Yandex cannot be disconnected — a legacy email row is not a way in', async () => {
    vi.mocked(api.getIdentities).mockResolvedValue(identities(['email', 'yandex']));
    renderSection();
    const row = (await screen.findByText('Яндекс ID')).closest('li')!;
    expect(row).toHaveTextContent('Подключено');
    expect(screen.queryByRole('button', { name: /Отключить/ })).not.toBeInTheDocument();
  });

  it('warns an account with no working sign-in method, and only that one', async () => {
    vi.mocked(api.getIdentities).mockResolvedValue(identities(['email']));
    renderSection(vi.fn(), { needsSignInMethod: true });
    expect(
      await screen.findByRole('region', { name: 'Подключите VK ID или Яндекс ID' }),
    ).toBeInTheDocument();
    // Already in Профиль: the rows below are the way to connect.
    expect(screen.queryByRole('button', { name: 'Подключить в профиле' })).not.toBeInTheDocument();
  });

  it('no warning for an account that has a working method', async () => {
    vi.mocked(api.getIdentities).mockResolvedValue(identities(['email', 'vk']));
    renderSection();
    await screen.findByText('ВКонтакте');
    expect(
      screen.queryByRole('region', { name: 'Подключите VK ID или Яндекс ID' }),
    ).not.toBeInTheDocument();
  });

  it('load failure offers a retry', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getIdentities).mockRejectedValueOnce(new Error('offline'));
    renderSection();
    expect(await screen.findByText('Не удалось загрузить способы входа.')).toBeInTheDocument();
    vi.mocked(api.getIdentities).mockResolvedValue(identities(['email']));
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('ВКонтакте')).toBeInTheDocument();
  });

  describe('inside the Telegram Mini App', () => {
    beforeEach(() => vi.mocked(miniApp.getTelegramInitData).mockReturnValue('query_id=A&hash=h'));

    it('links Telegram by sending the signed launch data', async () => {
      const user = userEvent.setup();
      vi.mocked(api.getIdentities).mockResolvedValue(identities(['email']));
      vi.mocked(api.linkTelegram).mockResolvedValue({ status: 'linked', user: makeAuthUser() });
      const { updateUser, refresh } = renderSection();
      const row = (await screen.findByText('Telegram')).closest('li')!;
      await user.click(row.querySelector('button')!);
      expect(api.linkTelegram).toHaveBeenCalledWith('query_id=A&hash=h');
      expect(await screen.findByText(/Telegram подключён/)).toBeInTheDocument();
      expect(updateUser).toHaveBeenCalled();
      // Re-reads /auth/me so a «no working method» warning goes away.
      expect(refresh).toHaveBeenCalled();
    });

    it('explains a Telegram account that belongs to another profile', async () => {
      const user = userEvent.setup();
      vi.mocked(api.getIdentities).mockResolvedValue(identities(['email']));
      vi.mocked(api.linkTelegram).mockRejectedValue(
        new api.ApiError(409, { error: 'identity_taken', provider: 'telegram' }),
      );
      renderSection();
      const row = (await screen.findByText('Telegram')).closest('li')!;
      await user.click(row.querySelector('button')!);
      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent('не объединяем профили автоматически'),
      );
    });

    it('explains expired launch data', async () => {
      const user = userEvent.setup();
      vi.mocked(api.getIdentities).mockResolvedValue(identities(['email']));
      vi.mocked(api.linkTelegram).mockRejectedValue(
        new api.ApiError(400, { error: 'telegram_data_expired' }),
      );
      renderSection();
      const row = (await screen.findByText('Telegram')).closest('li')!;
      await user.click(row.querySelector('button')!);
      expect(await screen.findByRole('alert')).toHaveTextContent('устарели');
    });
  });
});

describe('SignInMethodsSection — linking Telegram through the bot (Safari, any browser)', () => {
  const TOKEN = 'tok_abcdefghijklmnopqrstuvwxyz012345';

  it('makes a one-time bot link opened by the student’s own tap, never put in the page address', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getIdentities).mockResolvedValue(identities(['vk']));
    vi.mocked(api.createTelegramLink).mockResolvedValue({
      token: TOKEN,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
    const log = vi.spyOn(console, 'log');
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Привязать Telegram' }));
    const link = await screen.findByRole('link', { name: 'Открыть @zybrilka_bot' });
    expect(link).toHaveAttribute('href', `https://t.me/zybrilka_bot?start=link_${TOKEN}`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(window.location.href).not.toContain(TOKEN);
    expect(log.mock.calls.flat().join(' ')).not.toContain(TOKEN);
  });

  it('«Отмена» kills the link on the server and goes back to the start', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getIdentities).mockResolvedValue(identities(['vk']));
    vi.mocked(api.createTelegramLink).mockResolvedValue({
      token: TOKEN,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
    vi.mocked(api.cancelTelegramLink).mockResolvedValue(undefined);
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Привязать Telegram' }));
    await user.click(await screen.findByRole('button', { name: 'Отмена' }));
    expect(api.cancelTelegramLink).toHaveBeenCalled();
    expect(await screen.findByText(/ссылка больше не работает/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Открыть @zybrilka_bot' })).not.toBeInTheDocument();
  });

  it('an expired link offers a new one instead of a dead button', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getIdentities).mockResolvedValue(identities(['vk']));
    vi.mocked(api.createTelegramLink).mockResolvedValue({
      token: TOKEN,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Привязать Telegram' }));
    expect(await screen.findByText(/Ссылка устарела/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Получить новую ссылку' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Открыть @zybrilka_bot' })).not.toBeInTheDocument();
  });

  it('shows WHICH Telegram confirmed in the bot; «Подтвердить» links it to this account', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getIdentities)
      .mockResolvedValueOnce(identities(['vk'], { telegramPendingLink: { name: 'Вера (@vera)' } }))
      .mockResolvedValue(identities(['vk', 'telegram']));
    vi.mocked(api.confirmTelegramLink).mockResolvedValue({ status: 'linked' } as never);
    const { refresh } = renderSection();
    expect(await screen.findByText('Вера (@vera)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Подтвердить' }));
    expect(api.confirmTelegramLink).toHaveBeenCalledWith(true);
    expect(await screen.findByText(/Telegram подключён/)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.getAllByText(/Подключено/).length).toBe(2));
  });

  it('«Это не я» refuses it; a Telegram owned by another account is reported, not moved', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getIdentities).mockResolvedValue(
      identities(['vk'], { telegramPendingLink: { name: 'Чужой' } }),
    );
    vi.mocked(api.confirmTelegramLink).mockResolvedValueOnce({ status: 'rejected' } as never);
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Это не я' }));
    expect(api.confirmTelegramLink).toHaveBeenCalledWith(false);
    expect(await screen.findByText(/Запрос отклонён/)).toBeInTheDocument();

    vi.mocked(api.confirmTelegramLink).mockResolvedValueOnce({ status: 'taken' } as never);
    await user.click(screen.getByRole('button', { name: 'Подтвердить' }));
    expect(await screen.findByText(/уже связан с другим профилем/)).toBeInTheDocument();
  });

  it('inside the Mini App the signed launch data is still used, not the bot link', async () => {
    vi.mocked(miniApp.getTelegramInitData).mockReturnValue('query_id=1&hash=x');
    vi.mocked(api.getIdentities).mockResolvedValue(identities(['vk']));
    renderSection();
    // VK is linked: Яндекс and Telegram (by launch data) offer «Подключить».
    expect(await screen.findAllByRole('button', { name: 'Подключить' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Привязать Telegram' })).not.toBeInTheDocument();
  });
});
