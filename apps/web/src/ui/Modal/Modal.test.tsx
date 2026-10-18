import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from './Modal.js';

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(
      <Modal open={false} onClose={() => {}} title="Удалить задачу?">
        Это действие нельзя отменить.
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the dialog with its title when open', () => {
    render(
      <Modal open onClose={() => {}} title="Удалить задачу?">
        Это действие нельзя отменить.
      </Modal>,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Удалить задачу?')).toBeInTheDocument();
  });

  it('calls onClose when the close button is pressed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Удалить задачу?">
        Это действие нельзя отменить.
      </Modal>,
    );
    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Удалить задачу?">
        Это действие нельзя отменить.
      </Modal>,
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('Modal closing', () => {
  it('plays its exit: stays on screen for a moment, but is already out of reach (inert, hidden from assistive tech), then unmounts', async () => {
    const { rerender } = render(
      <Modal open onClose={() => {}} title="Удалить задачу?">
        Это действие нельзя отменить.
      </Modal>,
    );
    rerender(
      <Modal open={false} onClose={() => {}} title="Удалить задачу?">
        Это действие нельзя отменить.
      </Modal>,
    );

    // Still drawn while the exit plays…
    const text = screen.getByText('Это действие нельзя отменить.');
    // …but no longer a dialog for anyone, and not clickable or focusable.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(text.closest('[inert]')).not.toBeNull();

    await waitFor(() =>
      expect(screen.queryByText('Это действие нельзя отменить.')).not.toBeInTheDocument(),
    );
  });

  it('ignores Escape while closing (onClose is not called twice)', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal open onClose={onClose} title="Удалить задачу?">
        Это действие нельзя отменить.
      </Modal>,
    );
    rerender(
      <Modal open={false} onClose={onClose} title="Удалить задачу?">
        Это действие нельзя отменить.
      </Modal>,
    );
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });
});
