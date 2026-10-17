import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MistakeCardDesktop } from './MistakeCardDesktop.js';
import { MistakeCardMobile } from './MistakeCardMobile.js';
import { mistakes } from '../../data/sampleMistakes.js';

const sample = mistakes[0]!;

describe('MistakeCardDesktop', () => {
  it('calls onReview when "Разобрать" is tapped', async () => {
    const user = userEvent.setup();
    const onReview = vi.fn();
    render(
      <MistakeCardDesktop
        mistake={sample}
        selected={false}
        onToggleSelect={() => {}}
        onReview={onReview}
        onToggleFavorite={() => {}}
        favorited={false}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Разобрать/ }));
    expect(onReview).toHaveBeenCalledOnce();
  });

  it('has no three-dots "Ещё" button or dropdown menu (removed)', () => {
    const { container } = render(
      <MistakeCardDesktop
        mistake={sample}
        selected={false}
        onToggleSelect={() => {}}
        onReview={() => {}}
        onToggleFavorite={() => {}}
        favorited={false}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Ещё' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    // lucide's MoreVertical renders three <circle>s inside one <svg>.
    expect(
      container.querySelector('svg.lucide-ellipsis-vertical, svg.lucide-more-vertical'),
    ).toBeNull();
  });

  it('toggles selection', async () => {
    const user = userEvent.setup();
    const onToggleSelect = vi.fn();
    render(
      <MistakeCardDesktop
        mistake={sample}
        selected={false}
        onToggleSelect={onToggleSelect}
        onReview={() => {}}
        onToggleFavorite={() => {}}
        favorited={false}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Выбрать ошибку' }));
    expect(onToggleSelect).toHaveBeenCalledOnce();
  });
});

describe('MistakeCardMobile', () => {
  it('calls onOpen when the body is tapped', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <MistakeCardMobile
        mistake={sample}
        selected={false}
        onToggleSelect={() => {}}
        onRetry={() => {}}
        onOpen={onOpen}
      />,
    );
    await user.click(screen.getByText(sample.condition));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('calls onRetry from the retry icon without triggering onOpen', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onOpen = vi.fn();
    render(
      <MistakeCardMobile
        mistake={sample}
        selected={false}
        onToggleSelect={() => {}}
        onRetry={onRetry}
        onOpen={onOpen}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: `Повторить задание ${sample.taskNumber}` }),
    );
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });
});
