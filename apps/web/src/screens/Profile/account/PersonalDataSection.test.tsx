import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuthUser } from '@zybrilka/shared';
import * as api from '../../../lib/api.js';
import { makeAuthUser, TestAuthProvider } from '../../../lib/authTestUtils.js';
import { PersonalDataSection } from './PersonalDataSection.js';

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
      <p data-testid="current-name">{user.displayName}</p>
      <p data-testid="current-avatar">{user.avatarUrl ?? 'none'}</p>
    </TestAuthProvider>
  );
}

const prepare = vi.fn(
  async (_file: File) => new Blob([new Uint8Array(10)], { type: 'image/jpeg' }),
);

function renderSection(user = makeAuthUser()) {
  return render(
    <Host initial={user}>
      <PersonalDataSection prepare={prepare} />
    </Host>,
  );
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.resetAllMocks());

describe('PersonalDataSection — name', () => {
  it('shows the provider name as the placeholder and starts with nothing to save', () => {
    renderSection();
    const input = screen.getByLabelText('Имя в Зубрилке');
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('placeholder', 'Иван Петров');
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });

  it('saves a new name, shows a success state and refreshes the user instantly', async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateProfileName).mockResolvedValue({
      user: makeAuthUser({ customName: 'Вася', displayName: 'Вася' }),
    });
    renderSection();
    await user.type(screen.getByLabelText('Имя в Зубрилке'), '  Вася  ');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(api.updateProfileName).toHaveBeenCalledWith('Вася'); // normalized before sending
    expect(await screen.findByText('Имя сохранено.')).toBeInTheDocument();
    expect(screen.getByTestId('current-name')).toHaveTextContent('Вася');
  });

  it('blocks invalid names client-side with a clear message and never calls the API', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.type(screen.getByLabelText('Имя в Зубрилке'), 'a<b');
    expect(screen.getByText('Нельзя использовать символы < и >.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    await user.clear(screen.getByLabelText('Имя в Зубрилке'));
    await user.type(screen.getByLabelText('Имя в Зубрилке'), 'я'.repeat(41));
    expect(screen.getByText('Не больше 40 символов.')).toBeInTheDocument();
    expect(api.updateProfileName).not.toHaveBeenCalled();
  });

  it('shows an error and keeps the old name when the request fails', async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateProfileName).mockRejectedValue(new Error('offline'));
    renderSection(makeAuthUser({ customName: 'Старое', displayName: 'Старое' }));
    const input = screen.getByLabelText('Имя в Зубрилке');
    await user.clear(input);
    await user.type(input, 'Новое');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось сохранить имя');
    expect(screen.getByTestId('current-name')).toHaveTextContent('Старое');
  });

  it('reports a server-side name problem', async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateProfileName).mockRejectedValue(
      new api.ApiError(400, { error: 'invalid_name', problem: 'too_long' }),
    );
    renderSection();
    await user.type(screen.getByLabelText('Имя в Зубрилке'), 'Имя');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не больше 40 символов.');
  });

  it('cancel discards the edit', async () => {
    const user = userEvent.setup();
    renderSection();
    const input = screen.getByLabelText('Имя в Зубрилке');
    await user.type(input, 'Черновик');
    await user.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(input).toHaveValue('');
  });

  it('can go back to the provider name', async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateProfileName).mockResolvedValue({
      user: makeAuthUser({ customName: null }),
    });
    renderSection(makeAuthUser({ customName: 'Ник', displayName: 'Ник' }));
    await user.click(screen.getByRole('button', { name: 'Вернуть имя из соцсети' }));
    expect(api.updateProfileName).toHaveBeenCalledWith(null);
    await waitFor(() =>
      expect(screen.getByTestId('current-name')).toHaveTextContent('Иван Петров'),
    );
  });
});

describe('PersonalDataSection — avatar', () => {
  const pick = async (user: ReturnType<typeof userEvent.setup>, type = 'image/png') => {
    const input = screen.getByLabelText('Выбрать файл с фото');
    await user.upload(input, new File([new Uint8Array(10)], 'me.png', { type }));
  };

  it('previews the chosen photo and only uploads after «Сохранить фото»', async () => {
    const user = userEvent.setup();
    vi.mocked(api.uploadAvatar).mockResolvedValue({
      user: makeAuthUser({ avatarUrl: '/api/v1/me/avatars/user?v=abc', hasCustomAvatar: true }),
    });
    const { container } = renderSection();
    await pick(user);
    expect(await screen.findByText('Так будет выглядеть ваше фото.')).toBeInTheDocument();
    expect(container.querySelector('img[src="blob:preview"]')).toBeInTheDocument();
    expect(api.uploadAvatar).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Сохранить фото' }));
    expect(api.uploadAvatar).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Фото обновлено.')).toBeInTheDocument();
    expect(screen.getByTestId('current-avatar')).toHaveTextContent('/api/v1/me/avatars/user?v=abc');
    expect(screen.getByRole('button', { name: /Заменить фото/ })).toBeInTheDocument();
  });

  it('cancel drops the preview without any request', async () => {
    const user = userEvent.setup();
    renderSection();
    await pick(user);
    await user.click(await screen.findByRole('button', { name: 'Отмена' }));
    expect(screen.queryByText('Так будет выглядеть ваше фото.')).not.toBeInTheDocument();
    expect(api.uploadAvatar).not.toHaveBeenCalled();
  });

  it('shows why a file was refused and keeps the current photo', async () => {
    const user = userEvent.setup();
    const { AvatarFileError } = await import('./avatarImage.js');
    prepare.mockRejectedValueOnce(new AvatarFileError('too_small'));
    renderSection();
    await pick(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('слишком маленькое');
    expect(screen.queryByRole('button', { name: 'Сохранить фото' })).not.toBeInTheDocument();
  });

  it('server rejection (e.g. wrong image type) is explained, preview stays for a retry', async () => {
    const user = userEvent.setup();
    vi.mocked(api.uploadAvatar).mockRejectedValue(
      new api.ApiError(400, { error: 'invalid_image', problem: 'unsupported_type' }),
    );
    renderSection();
    await pick(user);
    await user.click(await screen.findByRole('button', { name: 'Сохранить фото' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Сервер не принял');
    expect(screen.getByRole('button', { name: 'Сохранить фото' })).toBeEnabled();
  });

  it('network failure is reported', async () => {
    const user = userEvent.setup();
    vi.mocked(api.uploadAvatar).mockRejectedValue(new TypeError('Failed to fetch'));
    renderSection();
    await pick(user);
    await user.click(await screen.findByRole('button', { name: 'Сохранить фото' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить фото');
  });

  it("removes the user's own photo and shows the provider one again", async () => {
    const user = userEvent.setup();
    vi.mocked(api.deleteAvatar).mockResolvedValue({
      user: makeAuthUser({ avatarUrl: 'https://sun9.userapi.com/p.jpg', hasCustomAvatar: false }),
    });
    renderSection(
      makeAuthUser({ avatarUrl: '/api/v1/me/avatars/user?v=a', hasCustomAvatar: true }),
    );
    await user.click(screen.getByRole('button', { name: 'Удалить своё фото' }));
    expect(await screen.findByText('Своё фото удалено.')).toBeInTheDocument();
    expect(screen.getByTestId('current-avatar')).toHaveTextContent('sun9.userapi.com');
  });

  it('offers no «delete» when the photo comes from the provider', () => {
    renderSection(makeAuthUser({ avatarUrl: 'https://sun9.userapi.com/p.jpg' }));
    expect(screen.queryByRole('button', { name: 'Удалить своё фото' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Выбрать фото/ })).toBeInTheDocument();
  });
});
