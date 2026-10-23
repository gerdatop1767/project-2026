import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuthUser, IdentitiesResponse } from '@zybrilka/shared';
import * as api from '../../../lib/api.js';
import { makeAuthUser, TestAuthProvider } from '../../../lib/authTestUtils.js';
import { ProfileIdentityCard } from './ProfileIdentityCard.js';
import type { IdentitiesState } from './useIdentities.js';

vi.mock('../../../lib/api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  updateProfileName: vi.fn(),
  uploadAvatar: vi.fn(),
  deleteAvatar: vi.fn(),
}));

/** Holds the user like AuthProvider does, so "instant refresh" is observable. */
function Host({ initial, children }: { initial: AuthUser; children: ReactNode }) {
  const [user, setUser] = useState(initial);
  return (
    <TestAuthProvider user={user} updateUser={setUser}>
      {children}
      <p data-testid="current-name">{`name=${user.displayName}`}</p>
      <p data-testid="current-avatar">{`avatar=${user.avatarUrl ?? 'none'}`}</p>
    </TestAuthProvider>
  );
}

const prepare = vi.fn(
  async (_file: File) => new Blob([new Uint8Array(10)], { type: 'image/jpeg' }),
);

const identityList = (providers: ('email' | 'vk' | 'telegram')[]): IdentitiesState => ({
  data: {
    identities: providers.map((provider) => ({ provider, linkedAt: '2026-03-05T10:00:00.000Z' })),
    available: { vk: true, telegram: true, yandex: true },
    canUnlink: providers.length > 1,
  } satisfies IdentitiesResponse,
  failed: false,
  reload: () => {},
  replace: () => {},
});

function renderCard(user = makeAuthUser(), identities = identityList(['vk'])) {
  return render(
    <Host initial={user}>
      <ProfileIdentityCard identities={identities} prepare={prepare} />
    </Host>,
  );
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.resetAllMocks());

describe('ProfileIdentityCard — composition', () => {
  it('shows name, how you sign in and BOTH edit buttons in the one top card', () => {
    renderCard();
    expect(screen.getByText('Иван Петров')).toBeInTheDocument();
    expect(screen.getByText('Вход: VK ID')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Изменить аватар/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Изменить ник/ })).toBeInTheDocument();
  });

  it('renders the picture exactly once (no repeated avatar anywhere in the card)', () => {
    const { container } = renderCard(makeAuthUser({ avatarUrl: 'https://sun9.userapi.com/p.jpg' }));
    expect(container.querySelectorAll('img')).toHaveLength(1);
  });

  it('names every linked method, using the e-mail address for the e-mail login', () => {
    renderCard(makeAuthUser({ email: 'ivan@example.com' }), identityList(['email', 'telegram']));
    expect(screen.getByText('Вход: ivan@example.com, Telegram')).toBeInTheDocument();
  });

  it('falls back to the e-mail (or nothing) while the methods are still loading', () => {
    const loading: IdentitiesState = { ...identityList([]), data: null };
    renderCard(makeAuthUser({ email: 'ivan@example.com' }), loading);
    expect(screen.getByText('ivan@example.com')).toBeInTheDocument();
  });

  it('shows an honest placeholder when there is no name at all', () => {
    renderCard(makeAuthUser({ firstName: null, lastName: null }));
    expect(screen.getByText('Имя не задано')).toBeInTheDocument();
  });
});

describe('ProfileIdentityCard — nickname', () => {
  const openEditor = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: /Изменить ник/ }));
    return screen.getByLabelText('Имя в Зубрилке');
  };

  it('edits in place, with the provider name as placeholder', async () => {
    const user = userEvent.setup();
    renderCard();
    const input = await openEditor(user);
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('placeholder', 'Иван Петров');
    expect(screen.queryByRole('button', { name: /Изменить ник/ })).not.toBeInTheDocument();
  });

  it('saves a normalized nickname, shows success and refreshes the user instantly', async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateProfileName).mockResolvedValue({
      user: makeAuthUser({ customName: 'Вася', displayName: 'Вася' }),
    });
    renderCard();
    await user.type(await openEditor(user), '  Вася  ');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(api.updateProfileName).toHaveBeenCalledWith('Вася');
    expect(await screen.findByText('Имя сохранено.')).toBeInTheDocument();
    expect(screen.getByTestId('current-name')).toHaveTextContent('Вася');
    // editor closes, the button to open it is back
    expect(screen.getByRole('button', { name: /Изменить ник/ })).toBeInTheDocument();
  });

  it('blocks invalid names client-side and never calls the API', async () => {
    const user = userEvent.setup();
    renderCard();
    const input = await openEditor(user);
    await user.type(input, 'a<b');
    expect(screen.getByText('Нельзя использовать символы < и >.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    await user.clear(input);
    await user.type(input, 'я'.repeat(41));
    expect(screen.getByText('Не больше 40 символов.')).toBeInTheDocument();
    expect(api.updateProfileName).not.toHaveBeenCalled();
  });

  it('keeps the editor open and the old name when the request fails', async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateProfileName).mockRejectedValue(new Error('offline'));
    renderCard(makeAuthUser({ customName: 'Старое', displayName: 'Старое' }));
    const input = await openEditor(user);
    await user.clear(input);
    await user.type(input, 'Новое');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось сохранить имя');
    expect(screen.getByTestId('current-name')).toHaveTextContent('Старое');
    expect(screen.getByLabelText('Имя в Зубрилке')).toHaveValue('Новое');
  });

  it('reports a server-side name problem', async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateProfileName).mockRejectedValue(
      new api.ApiError(400, { error: 'invalid_name', problem: 'too_long' }),
    );
    renderCard();
    await user.type(await openEditor(user), 'Имя');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не больше 40 символов.');
  });

  it('cancel discards the edit and closes the editor', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.type(await openEditor(user), 'Черновик');
    await user.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByLabelText('Имя в Зубрилке')).not.toBeInTheDocument();
    expect(screen.getByText('Иван Петров')).toBeInTheDocument();
    expect(api.updateProfileName).not.toHaveBeenCalled();
  });

  it('can go back to the name from the social network', async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateProfileName).mockResolvedValue({
      user: makeAuthUser({ customName: null }),
    });
    renderCard(makeAuthUser({ customName: 'Ник', displayName: 'Ник' }));
    await openEditor(user);
    await user.click(screen.getByRole('button', { name: 'Имя из соцсети' }));
    expect(api.updateProfileName).toHaveBeenCalledWith(null);
    await waitFor(() =>
      expect(screen.getByTestId('current-name')).toHaveTextContent('Иван Петров'),
    );
  });
});

describe('ProfileIdentityCard — avatar', () => {
  const pick = async (user: ReturnType<typeof userEvent.setup>, type = 'image/png') => {
    await user.upload(
      screen.getByLabelText('Выбрать файл с фото'),
      new File([new Uint8Array(10)], 'me.png', { type }),
    );
  };

  it('previews the chosen photo in the avatar and uploads only after «Сохранить фото»', async () => {
    const user = userEvent.setup();
    vi.mocked(api.uploadAvatar).mockResolvedValue({
      user: makeAuthUser({ avatarUrl: '/api/v1/me/avatars/user?v=abc', hasCustomAvatar: true }),
    });
    const { container } = renderCard();
    await pick(user);
    expect(await screen.findByText('Так будет выглядеть ваше фото.')).toBeInTheDocument();
    expect(container.querySelector('img[src="blob:preview"]')).toBeInTheDocument();
    expect(api.uploadAvatar).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Сохранить фото' }));
    expect(api.uploadAvatar).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Фото обновлено.')).toBeInTheDocument();
    expect(screen.getByTestId('current-avatar')).toHaveTextContent('/api/v1/me/avatars/user?v=abc');
    expect(screen.getByRole('button', { name: 'Удалить фото' })).toBeInTheDocument();
  });

  it('the avatar itself is also a way to change it', async () => {
    const user = userEvent.setup();
    const { container } = renderCard();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    await user.click(screen.getByRole('button', { name: 'Выбрать новое фото профиля' }));
    expect(click).toHaveBeenCalled();
  });

  it('cancel drops the preview without any request', async () => {
    const user = userEvent.setup();
    renderCard();
    await pick(user);
    await user.click(await screen.findByRole('button', { name: 'Отмена' }));
    expect(screen.queryByText('Так будет выглядеть ваше фото.')).not.toBeInTheDocument();
    expect(api.uploadAvatar).not.toHaveBeenCalled();
  });

  it('shows why a file was refused and keeps the current photo', async () => {
    const user = userEvent.setup();
    const { AvatarFileError } = await import('./avatarImage.js');
    prepare.mockRejectedValueOnce(new AvatarFileError('too_small'));
    renderCard();
    await pick(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('слишком маленькое');
    expect(screen.queryByRole('button', { name: 'Сохранить фото' })).not.toBeInTheDocument();
  });

  it('server rejection is explained and the preview stays for a retry', async () => {
    const user = userEvent.setup();
    vi.mocked(api.uploadAvatar).mockRejectedValue(
      new api.ApiError(400, { error: 'invalid_image', problem: 'unsupported_type' }),
    );
    renderCard();
    await pick(user);
    await user.click(await screen.findByRole('button', { name: 'Сохранить фото' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Сервер не принял');
    expect(screen.getByRole('button', { name: 'Сохранить фото' })).toBeEnabled();
  });

  it('network failure is reported', async () => {
    const user = userEvent.setup();
    vi.mocked(api.uploadAvatar).mockRejectedValue(new TypeError('Failed to fetch'));
    renderCard();
    await pick(user);
    await user.click(await screen.findByRole('button', { name: 'Сохранить фото' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить фото');
  });

  it("removes the user's own photo and shows the provider one again", async () => {
    const user = userEvent.setup();
    vi.mocked(api.deleteAvatar).mockResolvedValue({
      user: makeAuthUser({ avatarUrl: 'https://sun9.userapi.com/p.jpg', hasCustomAvatar: false }),
    });
    renderCard(makeAuthUser({ avatarUrl: '/api/v1/me/avatars/user?v=a', hasCustomAvatar: true }));
    await user.click(screen.getByRole('button', { name: 'Удалить фото' }));
    expect(await screen.findByText('Своё фото удалено.')).toBeInTheDocument();
    expect(screen.getByTestId('current-avatar')).toHaveTextContent('sun9.userapi.com');
  });

  it('offers no «Удалить фото» when the photo comes from the provider', () => {
    renderCard(makeAuthUser({ avatarUrl: 'https://sun9.userapi.com/p.jpg' }));
    expect(screen.queryByRole('button', { name: 'Удалить фото' })).not.toBeInTheDocument();
  });
});
