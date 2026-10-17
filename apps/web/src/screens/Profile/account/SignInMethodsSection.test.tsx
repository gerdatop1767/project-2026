import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IdentitiesResponse } from '@zybrilka/shared';
import * as api from '../../../lib/api.js';
import { makeAuthUser, TestAuthProvider } from '../../../lib/authTestUtils.js';
import * as miniApp from '../../../lib/telegramMiniApp.js';
import { SignInMethodsSection } from './SignInMethodsSection.js';

vi.mock('../../../lib/api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  getIdentities: vi.fn(),
  unlinkIdentity: vi.fn(),
  linkTelegram: vi.fn(),
}));
vi.mock('../../../lib/telegramMiniApp.js', () => ({
  getTelegramInitData: vi.fn(() => null),
}));

const at = '2026-03-05T10:00:00.000Z';
const identities = (
  providers: ('email' | 'vk' | 'telegram')[],
  extra: Partial<IdentitiesResponse> = {},
): IdentitiesResponse => ({
  identities: providers.map((provider) => ({ provider, linkedAt: at })),
  available: { vk: true, telegram: true },
  canUnlink: providers.length > 1,
  ...extra,
});

function renderSection(navigateTo = vi.fn()) {
  const updateUser = vi.fn();
  render(
    <TestAuthProvider user={makeAuthUser()} updateUser={updateUser}>
      <SignInMethodsSection navigateTo={navigateTo} />
    </TestAuthProvider>,
  );
  return { navigateTo, updateUser };
}

beforeEach(() => window.history.replaceState(null, '', '/profile'));
afterEach(() => vi.resetAllMocks());

describe('SignInMethodsSection', () => {
  it('lists linked methods and offers the ones that can be added', async () => {
    vi.mocked(api.getIdentities).mockResolvedValue(identities(['email']));
    renderSection();
    expect(await screen.findByText('Почта (ссылка для входа)')).toBeInTheDocument();
    expect(screen.getByText('ВКонтакте')).toBeInTheDocument();
    expect(screen.getByText('Откройте Зубрилку в Telegram, чтобы подключить')).toBeInTheDocument();
    // Single method: nothing can be disconnected.
    expect(screen.queryByRole('button', { name: /Отключить/ })).not.toBeInTheDocument();
  });

  it('hides providers that are not configured on the server', async () => {
    vi.mocked(api.getIdentities).mockResolvedValue(
      identities(['email'], { available: { vk: false, telegram: false } }),
    );
    renderSection();
    await screen.findByText('Почта (ссылка для входа)');
    expect(screen.queryByText('ВКонтакте')).not.toBeInTheDocument();
    expect(screen.queryByText('Telegram')).not.toBeInTheDocument();
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
    vi.mocked(api.getIdentities).mockResolvedValue(identities(['email', 'vk']));
    vi.mocked(api.unlinkIdentity).mockResolvedValue(identities(['email']));
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
    vi.mocked(api.getIdentities).mockResolvedValue(identities(['email', 'vk']));
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Отключить ВКонтакте' }));
    await user.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(api.unlinkIdentity).not.toHaveBeenCalled();
  });

  it('explains why the last method cannot be removed (server guard)', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getIdentities).mockResolvedValue(identities(['email', 'vk']));
    vi.mocked(api.unlinkIdentity).mockRejectedValue(
      new api.ApiError(409, { error: 'last_identity' }),
    );
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Отключить ВКонтакте' }));
    await user.click(screen.getByRole('alertdialog').querySelector('button')!);
    expect(await screen.findByText(/единственный способ входа/)).toBeInTheDocument();
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
      const { updateUser } = renderSection();
      const row = (await screen.findByText('Telegram')).closest('li')!;
      await user.click(row.querySelector('button')!);
      expect(api.linkTelegram).toHaveBeenCalledWith('query_id=A&hash=h');
      expect(await screen.findByText(/Telegram подключён/)).toBeInTheDocument();
      expect(updateUser).toHaveBeenCalled();
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
