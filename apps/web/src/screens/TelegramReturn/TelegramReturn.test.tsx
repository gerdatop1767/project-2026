import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TelegramReturn } from './TelegramReturn.js';

function at(search: string) {
  window.history.replaceState(null, '', `/telegram-return${search}`);
  render(<TelegramReturn />);
}

describe('Telegram return page (external browser, after VK ID)', () => {
  it('success: tells the visitor to go back to Telegram and how', () => {
    at('?status=ok');
    expect(screen.getByRole('heading', { name: /вы вошли через VK ID/ })).toBeInTheDocument();
    expect(screen.getByText(/Вернитесь в Telegram/)).toBeInTheDocument();
    expect(screen.getByText(/окно Зубрилки там осталось открытым/)).toBeInTheDocument();
  });

  it.each([
    ['?status=cancelled', 'Вход отменён'],
    ['?status=error', 'Не удалось войти через VK ID'],
    ['?status=expired', 'Ссылка для входа устарела'],
    ['?status=<script>', 'Ссылка для входа устарела'],
    ['', 'Ссылка для входа устарела'],
  ])('%s → a fixed, honest message (nothing from the URL is rendered)', (search, title) => {
    at(search);
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('<script>');
  });
});

describe('Telegram return page after Yandex ID', () => {
  it('names Yandex when the sign-in was through it', () => {
    window.history.replaceState(null, '', '/telegram-return?status=ok&provider=yandex');
    render(<TelegramReturn />);
    expect(screen.getByRole('heading', { name: /вы вошли через Яндекс/ })).toBeInTheDocument();
  });

  it('an unknown provider value falls back to VK, never echoed', () => {
    window.history.replaceState(null, '', '/telegram-return?status=error&provider=%3Cb%3E');
    render(<TelegramReturn />);
    expect(
      screen.getByRole('heading', { name: 'Не удалось войти через VK ID' }),
    ).toBeInTheDocument();
  });
});
